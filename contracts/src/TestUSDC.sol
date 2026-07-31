// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDC
/// @notice Faucet-backed settlement token for the GIWA testnet deployment.
///
/// GIWA has no canonical stablecoin yet, so the desk settles in this token on
/// testnet. It mirrors USDC's 6 decimals so every amount, formula and UI label
/// carries over unchanged to a bridged USDC on mainnet.
///
/// Anyone can claim from the faucet once per interval, so the demo is usable
/// without asking the team for funds.
contract TestUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 2_000e6;
    uint256 public constant FAUCET_INTERVAL = 8 hours;

    mapping(address => uint256) public lastClaimed;

    event FaucetClaimed(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Writ Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Claim test USDC. Callable once per FAUCET_INTERVAL per address.
    function faucet() external {
        uint256 last = lastClaimed[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_INTERVAL) {
            revert FaucetCooldown(last + FAUCET_INTERVAL);
        }
        lastClaimed[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Seconds until `user` may claim again (0 when claimable now).
    function faucetCooldown(address user) external view returns (uint256) {
        uint256 last = lastClaimed[user];
        if (last == 0) return 0;
        uint256 ready = last + FAUCET_INTERVAL;
        return block.timestamp >= ready ? 0 : ready - block.timestamp;
    }
}
