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
/// @notice Physically settled, fully collateralized options desk on GIWA.
///
/// Two products, and in both the writer is paid upfront in USDC for committing
/// to a price they already believe in:
///
///  - Cash-secured put: lock `strike * qty` USDC. Below the strike at expiry you
///    buy `qty` of the underlying at the strike, which is the price you named.
///  - Covered call: lock `qty` of the underlying. Above the strike at expiry it
///    is sold at the strike, again the price you named.
///
/// Physical settlement is the point rather than an implementation detail. The
/// product promise is "get paid for a price you would be happy to trade at", and
/// only delivery actually keeps that promise: a cash difference leaves the writer
/// with neither the asset they wanted nor the price they set.
///
/// Because delivery is real, the counterparty must already hold what it may owe.
/// Writing an option reserves that side out of desk inventory, so a position can
/// never be opened that the desk could not honour. Two invariants hold at all
/// times, one per asset:
///
///   usdc.balanceOf(this) == deskUsdcFree + deskUsdcReserved + writerUsdcCollateral
///   btc.balanceOf(this)  == deskBtcFree  + deskBtcReserved  + writerBtcCollateral
///
/// Pricing is off-chain (Black-Scholes over a vol surface); quotes are EIP-712
/// signed by the desk's quote signer and verified here. Settlement reads the
/// expiry price from a pluggable oracle adapter (Pyth first-tick-after-expiry).
///
/// MVP trust assumptions (documented, removed in later phases):
///  - The quote signer prices fairly. It can only set premiums, never move
///    collateral or inventory beyond the trade it signed.
///  - After `fallbackDelay` past expiry the owner may settle with a manual
///    price, as an oracle-outage escape hatch.
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
        uint64 qty; // underlying, 1e8
        uint64 expiry; // unix seconds
        /// @dev USDC (1e6) for puts, underlying (1e8) for covered calls.
        uint128 collateral;
        uint128 premium; // USDC, 1e6 — always USDC
        uint64 settlementPrice; // USD, 1e8 — set at settlement
        bool assigned; // set at settlement: did the two sides swap
        PositionState state;
    }

    /// @notice A desk quote authorizing one option write, EIP-712 signed by `quoteSigner`.
    struct Quote {
        address writer;
        bool isPut;
        uint64 strike;
        uint64 qty;
        uint64 expiry;
        uint128 premium; // USDC paid to the writer on execution
        uint64 quoteDeadline; // quote is invalid after this timestamp
        uint256 nonce; // single-use
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address writer,bool isPut,uint64 strike,uint64 qty,uint64 expiry,uint128 premium,uint64 quoteDeadline,uint256 nonce)"
    );

    // ---------------------------------------------------------------- state

    IERC20 public immutable usdc;
    /// @notice The underlying that a covered call posts and a put delivers.
    IERC20 public immutable btc;
    IOracleAdapter public oracle;
    address public quoteSigner;

    uint64 public minTenor = 20 minutes;
    uint64 public maxTenor = 30 days;
    uint64 public fallbackDelay = 3 days;
    /// @dev Both products are sized by their cash leg, so one pair of caps covers
    /// them and the numbers stay comparable between them.
    uint128 public maxPositionNotional = 100_000e6;
    uint128 public maxTotalNotional = 1_000_000e6;

    /// @notice Desk USDC that can still be committed.
    uint256 public deskUsdcFree;
    /// @notice Desk USDC owed to open covered calls if they are assigned.
    uint256 public deskUsdcReserved;
    /// @notice Desk underlying that can still be committed.
    uint256 public deskBtcFree;
    /// @notice Desk underlying owed to open puts if they are assigned.
    uint256 public deskBtcReserved;

    /// @notice USDC locked as collateral across open puts.
    uint256 public writerUsdcCollateral;
    /// @notice Underlying locked as collateral across open covered calls.
    uint256 public writerBtcCollateral;

    /// @notice Cash notional across all open positions, for the protocol cap.
    uint256 public totalOpenNotional;

    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) private _positions;
    mapping(address => uint256[]) private _writerPositionIds;
    mapping(uint256 => bool) public usedNonces;

    // ---------------------------------------------------------------- events

    event DeskDeposited(address indexed from, bool isUsdc, uint256 amount);
    event DeskWithdrawn(address indexed to, bool isUsdc, uint256 amount);
    event OptionWritten(
        uint256 indexed id,
        address indexed writer,
        bool isPut,
        uint64 strike,
        uint64 qty,
        uint64 expiry,
        uint128 collateral,
        uint128 premium
    );
    event OptionSettled(
        uint256 indexed id,
        address indexed writer,
        uint64 settlementPrice,
        bool assigned,
        uint128 intrinsicUsdc,
        bool viaFallback
    );
    event QuoteSignerUpdated(address indexed signer);
    event OracleUpdated(address indexed oracle);
    event RiskParamsUpdated(
        uint64 minTenor,
        uint64 maxTenor,
        uint64 fallbackDelay,
        uint128 maxPositionNotional,
        uint128 maxTotalNotional
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
    error InsufficientDeskInventory();
    error PositionNotOpen();
    error NotYetExpired();
    error FallbackTooEarly();
    error InvalidRiskParams();

    // ---------------------------------------------------------------- setup

    constructor(address usdc_, address btc_, address oracle_, address quoteSigner_)
        EIP712("WritOptions", "1")
        Ownable(msg.sender)
    {
        if (
            usdc_ == address(0) || btc_ == address(0) || oracle_ == address(0)
                || quoteSigner_ == address(0)
        ) revert ZeroAddress();
        usdc = IERC20(usdc_);
        btc = IERC20(btc_);
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
        if (q.expiry < block.timestamp + minTenor || q.expiry > block.timestamp + maxTenor) {
            revert ExpiryOutOfRange();
        }
        if (ECDSA.recover(hashQuote(q), signature) != quoteSigner) revert InvalidQuoteSignature();

        uint128 notional = OptionMath.notionalUsdc(q.strike, q.qty);
        if (q.premium == 0 || q.premium >= notional) revert InvalidPremium();
        if (notional > maxPositionNotional) revert PositionTooLarge();
        if (totalOpenNotional + notional > maxTotalNotional) revert ProtocolCapReached();
        if (deskUsdcFree < q.premium) revert InsufficientDeskLiquidity();

        usedNonces[q.nonce] = true;
        deskUsdcFree -= q.premium;
        totalOpenNotional += notional;

        uint128 collateral = _openLegs(q, notional);

        id = nextPositionId++;
        _positions[id] = Position({
            writer: msg.sender,
            isPut: q.isPut,
            strike: q.strike,
            qty: q.qty,
            expiry: q.expiry,
            collateral: collateral,
            premium: q.premium,
            settlementPrice: 0,
            assigned: false,
            state: PositionState.Open
        });
        _writerPositionIds[msg.sender].push(id);

        usdc.safeTransfer(msg.sender, q.premium);

        emit OptionWritten(
            id, msg.sender, q.isPut, q.strike, q.qty, q.expiry, collateral, q.premium
        );
    }

    /// @dev Pull the writer's collateral in and reserve the side the desk may owe.
    /// Split out of `writeOption` to keep the stack flat.
    function _openLegs(Quote calldata q, uint128 notional) internal returns (uint128 collateral) {
        if (q.isPut) {
            // Writer posts cash; the desk may have to deliver the underlying.
            collateral = notional;
            if (deskBtcFree < q.qty) revert InsufficientDeskInventory();
            deskBtcFree -= q.qty;
            deskBtcReserved += q.qty;
            writerUsdcCollateral += collateral;
            usdc.safeTransferFrom(msg.sender, address(this), collateral);
        } else {
            // Writer posts the underlying; the desk may have to pay the strike.
            collateral = q.qty;
            if (deskUsdcFree < notional) revert InsufficientDeskInventory();
            deskUsdcFree -= notional;
            deskUsdcReserved += notional;
            writerBtcCollateral += collateral;
            btc.safeTransferFrom(msg.sender, address(this), collateral);
        }
    }

    // ---------------------------------------------------------------- settle

    /// @notice Settle an expired position against the oracle price at expiry.
    /// @dev Anyone may call. `msg.value` covers the oracle update fee.
    /// @param oracleData Oracle-specific payload (for Pyth: abi.encode(bytes[] hermesUpdates)).
    function settle(uint256 id, bytes calldata oracleData) external payable nonReentrant {
        Position storage pos = _positions[id];
        if (pos.state != PositionState.Open) revert PositionNotOpen();
        if (block.timestamp < pos.expiry) revert NotYetExpired();

        uint64 price = oracle.getSettlementPrice{value: msg.value}(pos.expiry, oracleData);
        _settle(pos, id, price, false);
    }

    /// @notice Settle many positions sharing one expiry against a single oracle
    /// update, so a whole expiry costs one fee instead of one fee per position.
    function settleMany(uint256[] calldata ids, bytes calldata oracleData)
        external
        payable
        nonReentrant
    {
        if (ids.length == 0) revert InvalidOptionParams();
        uint64 expiry = _positions[ids[0]].expiry;

        uint64 price = oracle.getSettlementPrice{value: msg.value}(expiry, oracleData);
        for (uint256 i; i < ids.length; ++i) {
            Position storage pos = _positions[ids[i]];
            // One oracle read is only valid for the expiry it was fetched at.
            if (pos.state != PositionState.Open || pos.expiry != expiry) revert PositionNotOpen();
            if (block.timestamp < pos.expiry) revert NotYetExpired();
            _settle(pos, ids[i], price, false);
        }
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

    /// @dev Four branches. Out of the money, every leg goes back where it came
    /// from. Assigned, the two sides swap in full at the strike — never a part
    /// of the collateral, which is what makes this delivery rather than a
    /// difference payment.
    function _settle(Position storage pos, uint256 id, uint64 price, bool viaFallback) internal {
        bool assigned = OptionMath.isAssigned(pos.isPut, pos.strike, price);
        uint128 notional = OptionMath.notionalUsdc(pos.strike, pos.qty);
        uint128 intrinsic = OptionMath.intrinsicUsdc(pos.isPut, pos.strike, pos.qty, price);

        pos.state = PositionState.Settled;
        pos.settlementPrice = price;
        pos.assigned = assigned;
        totalOpenNotional -= notional;

        if (pos.isPut) {
            writerUsdcCollateral -= pos.collateral;
            deskBtcReserved -= pos.qty;
            if (assigned) {
                // Writer buys at the strike: their cash goes to the desk, the
                // underlying goes to them.
                deskUsdcFree += pos.collateral;
                btc.safeTransfer(pos.writer, pos.qty);
            } else {
                deskBtcFree += pos.qty;
                usdc.safeTransfer(pos.writer, pos.collateral);
            }
        } else {
            writerBtcCollateral -= pos.collateral;
            deskUsdcReserved -= notional;
            if (assigned) {
                // Writer sells at the strike: their underlying goes to the desk,
                // the cash comes to them.
                deskBtcFree += pos.collateral;
                usdc.safeTransfer(pos.writer, notional);
            } else {
                deskUsdcFree += notional;
                btc.safeTransfer(pos.writer, pos.collateral);
            }
        }

        emit OptionSettled(id, pos.writer, price, assigned, intrinsic, viaFallback);
    }

    // ---------------------------------------------------------------- desk

    /// @notice Fund desk USDC: pays premiums and backs covered-call assignment.
    function depositDeskUsdc(uint256 amount) external {
        deskUsdcFree += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit DeskDeposited(msg.sender, true, amount);
    }

    /// @notice Fund desk underlying: backs put assignment.
    function depositDeskBtc(uint256 amount) external {
        deskBtcFree += amount;
        btc.safeTransferFrom(msg.sender, address(this), amount);
        emit DeskDeposited(msg.sender, false, amount);
    }

    /// @notice Withdraw uncommitted desk USDC. Reserves and writer collateral
    /// are not reachable: an open position's delivery is already spoken for.
    function withdrawDeskUsdc(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > deskUsdcFree) revert InsufficientDeskLiquidity();
        deskUsdcFree -= amount;
        usdc.safeTransfer(to, amount);
        emit DeskWithdrawn(to, true, amount);
    }

    /// @notice Withdraw uncommitted desk underlying.
    function withdrawDeskBtc(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > deskBtcFree) revert InsufficientDeskInventory();
        deskBtcFree -= amount;
        btc.safeTransfer(to, amount);
        emit DeskWithdrawn(to, false, amount);
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
        uint128 maxPositionNotional_,
        uint128 maxTotalNotional_
    ) external onlyOwner {
        if (
            minTenor_ == 0 || minTenor_ >= maxTenor_ || fallbackDelay_ == 0
                || maxPositionNotional_ == 0 || maxPositionNotional_ > maxTotalNotional_
        ) revert InvalidRiskParams();
        minTenor = minTenor_;
        maxTenor = maxTenor_;
        fallbackDelay = fallbackDelay_;
        maxPositionNotional = maxPositionNotional_;
        maxTotalNotional = maxTotalNotional_;
        emit RiskParamsUpdated(
            minTenor_, maxTenor_, fallbackDelay_, maxPositionNotional_, maxTotalNotional_
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

    /// @notice Collateral a writer must lock: USDC (1e6) for a put, underlying
    /// (1e8) for a covered call.
    function collateralRequired(bool isPut, uint64 strike, uint64 qty)
        external
        pure
        returns (uint128)
    {
        return isPut ? OptionMath.notionalUsdc(strike, qty) : qty;
    }

    /// @notice How many more of this option the desk can currently back.
    /// @dev The binding limit is inventory on the side the desk may have to
    /// deliver, which is what the UI should show as remaining capacity.
    function deskCapacity(bool isPut, uint64 strike, uint64 qty)
        external
        view
        returns (uint256 positions)
    {
        if (qty == 0 || strike == 0) return 0;
        return isPut ? deskBtcFree / qty : deskUsdcFree / OptionMath.notionalUsdc(strike, qty);
    }
}
