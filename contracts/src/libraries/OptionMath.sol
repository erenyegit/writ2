// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure math for cash-settled, fully collateralized options.
///
/// Conventions:
///  - Prices (strike, cap, settlement) are USD scaled by 1e8.
///  - Quantity is the underlying amount scaled by 1e8 (e.g. BTC).
///  - Settlement-token amounts are scaled by 1e6 (USDC's precision).
///
/// A price(1e8) * qty(1e8) product is a 1e16-scaled USD notional; dividing by
/// 1e10 yields the 1e6 settlement amount. Collateral rounds UP, payout rounds
/// DOWN, so the invariant payout <= collateral holds for every input.
library OptionMath {
    /// @dev product(1e16 scale) -> 1e6: / 1e8 (qty scale) then / 1e2 (USD 1e8 -> 1e6).
    uint256 internal constant PRODUCT_TO_USDC = 1e10;

    /// @notice Maximum possible payout of the option, rounded up.
    /// This is exactly the amount a writer must lock as collateral.
    /// @dev Puts pay at most `strike * qty` (underlying at zero). Capped calls
    /// pay at most `(cap - strike) * qty` (underlying at or above cap).
    function collateralUsdc(bool isPut, uint64 strike, uint64 cap, uint64 qty)
        internal
        pure
        returns (uint128)
    {
        uint256 product = isPut ? uint256(strike) * qty : uint256(cap - strike) * qty;
        return uint128(Math.ceilDiv(product, PRODUCT_TO_USDC));
    }

    /// @notice Intrinsic payout at settlement, rounded down.
    /// @dev Always <= collateralUsdc for the same parameters.
    function payoutUsdc(bool isPut, uint64 strike, uint64 cap, uint64 qty, uint64 settlementPrice)
        internal
        pure
        returns (uint128)
    {
        uint256 intrinsic;
        if (isPut) {
            intrinsic = settlementPrice >= strike ? 0 : uint256(strike - settlementPrice);
        } else {
            uint256 effective = settlementPrice > cap ? cap : settlementPrice;
            intrinsic = effective <= strike ? 0 : effective - strike;
        }
        return uint128(intrinsic * qty / PRODUCT_TO_USDC);
    }
}
