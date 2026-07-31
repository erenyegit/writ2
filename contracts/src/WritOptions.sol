// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {OptionMath} from "./libraries/OptionMath.sol";

/// @title WritOptions
/// @notice Cash-settled, fully collateralized options desk on Arc.
///
/// Writers sell European options to the protocol desk and receive the premium
/// in USDC immediately. Every position is collateralized at its maximum
/// possible payout, so there are no liquidations and no pooled risk:
///
///  - Cash-secured put: collateral = strike * qty. Pays (strike - S)+ at expiry.
///  - Capped call (call spread): collateral = (cap - strike) * qty.
///    Pays min((S - strike)+, cap - strike) at expiry.
///
/// Pricing is off-chain (Black-Scholes quote engine); quotes are EIP-712 signed
/// by the desk's quote signer and verified on-chain. Settlement reads the
/// expiry price from a pluggable oracle adapter (Pyth first-tick-after-expiry).
///
/// MVP trust assumptions (documented, to be removed in later phases):
///  - The quote signer prices fairly (it can only set premiums, never touch
///    writer collateral beyond the signed trade).
///  - The owner can settle with a manual price only after `fallbackDelay` past
///    expiry, as an oracle-outage escape hatch.
contract WritOptions is EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    enum PositionState {
        None,
        Open,
        Settled
    }

    struct Position {
        address writer;
        bool isPut;
        uint64 strike; // USD, 1e8
        uint64 cap; // USD, 1e8 (calls only, 0 for puts)
        uint64 qty; // underlying, 1e8
        uint64 expiry; // unix seconds
        uint128 collateral; // USDC, 1e6
        uint128 premium; // USDC, 1e6
        uint128 payout; // USDC, 1e6 — desk side, set at settlement
        uint64 settlementPrice; // USD, 1e8 — set at settlement
        PositionState state;
    }

    /// @notice A desk quote authorizing one option write, EIP-712 signed by `quoteSigner`.
    struct Quote {
        address writer;
        bool isPut;
        uint64 strike;
        uint64 cap;
        uint64 qty;
        uint64 expiry;
        uint128 premium; // USDC paid to the writer on execution
        uint64 quoteDeadline; // quote is invalid after this timestamp
        uint256 nonce; // single-use
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address writer,bool isPut,uint64 strike,uint64 cap,uint64 qty,uint64 expiry,uint128 premium,uint64 quoteDeadline,uint256 nonce)"
    );

    // ---------------------------------------------------------------- state

    IERC20 public immutable usdc;
    IOracleAdapter public oracle;
    address public quoteSigner;

    uint64 public minTenor = 20 minutes;
    uint64 public maxTenor = 30 days;
    uint64 public fallbackDelay = 3 days;
    uint128 public maxPositionCollateral = 100_000e6; // 100k USDC
    uint128 public maxTotalCollateral = 1_000_000e6; // 1M USDC

    /// @notice USDC owned by the desk (funds premiums, receives payouts).
    uint256 public deskBalance;
    /// @notice USDC locked as collateral across all open positions.
    uint256 public totalOpenCollateral;

    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) private _positions;
    mapping(address => uint256[]) private _writerPositionIds;
    mapping(uint256 => bool) public usedNonces;

    // ---------------------------------------------------------------- events

    event DeskDeposited(address indexed from, uint256 amount);
    event DeskWithdrawn(address indexed to, uint256 amount);
    event OptionWritten(
        uint256 indexed id,
        address indexed writer,
        bool isPut,
        uint64 strike,
        uint64 cap,
        uint64 qty,
        uint64 expiry,
        uint128 collateral,
        uint128 premium
    );
    event OptionSettled(
        uint256 indexed id,
        address indexed writer,
        uint64 settlementPrice,
        uint128 payout,
        uint128 refund,
        bool viaFallback
    );
    event QuoteSignerUpdated(address indexed signer);
    event OracleUpdated(address indexed oracle);
    event RiskParamsUpdated(
        uint64 minTenor,
        uint64 maxTenor,
        uint64 fallbackDelay,
        uint128 maxPositionCollateral,
        uint128 maxTotalCollateral
    );

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error NotQuoteWriter();
    error QuoteExpired();
    error NonceAlreadyUsed();
    error InvalidOptionParams();
    error ExpiryOutOfRange();
    error InvalidQuoteSignature();
    error InvalidPremium();
    error PositionTooLarge();
    error ProtocolCapReached();
    error InsufficientDeskLiquidity();
    error PositionNotOpen();
    error NotYetExpired();
    error FallbackTooEarly();
    error InvalidRiskParams();

    // ---------------------------------------------------------------- setup

    constructor(address usdc_, address oracle_, address quoteSigner_)
        EIP712("WritOptions", "1")
        Ownable(msg.sender)
    {
        if (usdc_ == address(0) || oracle_ == address(0) || quoteSigner_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC20(usdc_);
        oracle = IOracleAdapter(oracle_);
        quoteSigner = quoteSigner_;
    }

    // ---------------------------------------------------------------- write

    /// @notice Execute a desk-signed quote: lock collateral, receive the premium instantly.
    /// @param q The quote exactly as signed by the desk quote signer.
    /// @param signature EIP-712 signature over `q` by `quoteSigner`.
    function writeOption(Quote calldata q, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        if (q.writer != msg.sender) revert NotQuoteWriter();
        if (block.timestamp > q.quoteDeadline) revert QuoteExpired();
        if (usedNonces[q.nonce]) revert NonceAlreadyUsed();
        if (q.qty == 0 || q.strike == 0) revert InvalidOptionParams();
        if (q.isPut) {
            if (q.cap != 0) revert InvalidOptionParams();
        } else {
            if (q.cap <= q.strike) revert InvalidOptionParams();
        }
        if (q.expiry < block.timestamp + minTenor || q.expiry > block.timestamp + maxTenor) {
            revert ExpiryOutOfRange();
        }
        if (ECDSA.recover(hashQuote(q), signature) != quoteSigner) revert InvalidQuoteSignature();

        uint128 collateral = OptionMath.collateralUsdc(q.isPut, q.strike, q.cap, q.qty);
        if (q.premium == 0 || q.premium >= collateral) revert InvalidPremium();
        if (collateral > maxPositionCollateral) revert PositionTooLarge();
        if (totalOpenCollateral + collateral > maxTotalCollateral) revert ProtocolCapReached();
        if (deskBalance < q.premium) revert InsufficientDeskLiquidity();

        usedNonces[q.nonce] = true;
        id = nextPositionId++;
        _positions[id] = Position({
            writer: msg.sender,
            isPut: q.isPut,
            strike: q.strike,
            cap: q.cap,
            qty: q.qty,
            expiry: q.expiry,
            collateral: collateral,
            premium: q.premium,
            payout: 0,
            settlementPrice: 0,
            state: PositionState.Open
        });
        _writerPositionIds[msg.sender].push(id);
        totalOpenCollateral += collateral;
        deskBalance -= q.premium;

        usdc.safeTransferFrom(msg.sender, address(this), collateral);
        usdc.safeTransfer(msg.sender, q.premium);

        emit OptionWritten(
            id, msg.sender, q.isPut, q.strike, q.cap, q.qty, q.expiry, collateral, q.premium
        );
    }

    // ---------------------------------------------------------------- settle

    /// @notice Settle an expired position against the oracle price at expiry.
    /// @dev Anyone may call. `msg.value` covers the oracle update fee (native
    /// USDC on Arc); send the exact fee returned by the oracle's fee query.
    /// @param oracleData Oracle-specific payload (for Pyth: abi.encode(bytes[] hermesUpdates)).
    function settle(uint256 id, bytes calldata oracleData) external payable nonReentrant {
        Position storage pos = _positions[id];
        if (pos.state != PositionState.Open) revert PositionNotOpen();
        if (block.timestamp < pos.expiry) revert NotYetExpired();

        uint64 price = oracle.getSettlementPrice{value: msg.value}(pos.expiry, oracleData);
        _settle(pos, id, price, false);
    }

    /// @notice Escape hatch: owner settles with a manual price if the oracle
    /// could not produce one, only after `fallbackDelay` past expiry.
    function settleFallback(uint256 id, uint64 price1e8) external onlyOwner nonReentrant {
        Position storage pos = _positions[id];
        if (pos.state != PositionState.Open) revert PositionNotOpen();
        if (block.timestamp < uint256(pos.expiry) + fallbackDelay) revert FallbackTooEarly();
        if (price1e8 == 0) revert InvalidOptionParams();

        _settle(pos, id, price1e8, true);
    }

    function _settle(Position storage pos, uint256 id, uint64 price, bool viaFallback) internal {
        uint128 collateral = pos.collateral;
        uint128 payout = OptionMath.payoutUsdc(pos.isPut, pos.strike, pos.cap, pos.qty, price);
        if (payout > collateral) payout = collateral; // defense in depth; unreachable by math

        pos.state = PositionState.Settled;
        pos.payout = payout;
        pos.settlementPrice = price;
        totalOpenCollateral -= collateral;
        deskBalance += payout;

        uint128 refund = collateral - payout;
        if (refund != 0) usdc.safeTransfer(pos.writer, refund);

        emit OptionSettled(id, pos.writer, price, payout, refund, viaFallback);
    }

    // ---------------------------------------------------------------- desk

    /// @notice Fund the desk's premium-paying liquidity.
    function depositDesk(uint256 amount) external {
        deskBalance += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit DeskDeposited(msg.sender, amount);
    }

    /// @notice Withdraw free desk liquidity. Never touches locked collateral.
    function withdrawDesk(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > deskBalance) revert InsufficientDeskLiquidity();
        deskBalance -= amount;
        usdc.safeTransfer(to, amount);
        emit DeskWithdrawn(to, amount);
    }

    // ---------------------------------------------------------------- admin

    function setQuoteSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        quoteSigner = signer;
        emit QuoteSignerUpdated(signer);
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = IOracleAdapter(oracle_);
        emit OracleUpdated(oracle_);
    }

    function setRiskParams(
        uint64 minTenor_,
        uint64 maxTenor_,
        uint64 fallbackDelay_,
        uint128 maxPositionCollateral_,
        uint128 maxTotalCollateral_
    ) external onlyOwner {
        if (minTenor_ == 0 || minTenor_ >= maxTenor_ || fallbackDelay_ == 0) {
            revert InvalidRiskParams();
        }
        minTenor = minTenor_;
        maxTenor = maxTenor_;
        fallbackDelay = fallbackDelay_;
        maxPositionCollateral = maxPositionCollateral_;
        maxTotalCollateral = maxTotalCollateral_;
        emit RiskParamsUpdated(
            minTenor_, maxTenor_, fallbackDelay_, maxPositionCollateral_, maxTotalCollateral_
        );
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- views

    /// @notice EIP-712 digest of a quote; sign this off-chain, verify anywhere.
    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    q.writer,
                    q.isPut,
                    q.strike,
                    q.cap,
                    q.qty,
                    q.expiry,
                    q.premium,
                    q.quoteDeadline,
                    q.nonce
                )
            )
        );
    }

    function getPosition(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function getWriterPositionIds(address writer) external view returns (uint256[] memory) {
        return _writerPositionIds[writer];
    }

    /// @notice USDC collateral a writer must lock for the given option parameters.
    function collateralRequired(bool isPut, uint64 strike, uint64 cap, uint64 qty)
        external
        pure
        returns (uint128)
    {
        return OptionMath.collateralUsdc(isPut, strike, cap, qty);
    }
}
