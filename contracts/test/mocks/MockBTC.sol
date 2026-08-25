// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for the underlying: 8 decimals, matching BTC and the `qty`
/// field, so a covered call's collateral is the position size one for one.
contract MockBTC is ERC20 {
    constructor() ERC20("Mock BTC", "BTC") {}

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
