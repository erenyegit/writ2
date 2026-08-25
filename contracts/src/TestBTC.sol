// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestBTC
/// @notice Faucet-backed underlying for the GIWA testnet deployment.
///
/// A covered call posts the underlying itself, and GIWA has no wrapped BTC. This
/// mirrors TestUSDC: a mock with an open faucet, so the demo needs no hand-outs.
///
/// 8 decimals, matching both Bitcoin's own precision and the `qty` field in
/// WritOptions, so a covered call's collateral is the position size one for one
/// and every formula carries over to a real wrapped BTC on mainnet.
contract TestBTC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1e8; // 1 BTC
    uint256 public constant FAUCET_INTERVAL = 8 hours;

    mapping(address => uint256) public lastClaimed;

    event FaucetClaimed(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Writ Test BTC", "BTC") {}

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    /// @notice Claim test BTC. Callable once per FAUCET_INTERVAL per address.
    function faucet() external {
        uint256 last = lastClaimed[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_INTERVAL) {
            revert FaucetCooldown(last + FAUCET_INTERVAL);
        }
        lastClaimed[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Seconds until this address may claim again; zero when ready.
    function faucetCooldown(address who) external view returns (uint256) {
        uint256 ready = lastClaimed[who] + FAUCET_INTERVAL;
        if (lastClaimed[who] == 0 || block.timestamp >= ready) return 0;
        return ready - block.timestamp;
    }
}
