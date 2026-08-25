// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure math for physically settled, fully collateralized options.
///
/// Conventions:
///  - Prices (strike, settlement) are USD scaled by 1e8.
///  - Quantity is the underlying amount scaled by 1e8, matching BTC precision.
///  - Settlement-token amounts are scaled by 1e6 (USDC's precision).
///
/// Physical settlement means there is no partial payout to compute: at expiry
/// an option is either out of the money, and every leg goes back where it came
/// from, or it is assigned, and the two sides swap in full at the strike. So
/// the only figures needed on the transfer path are "how much cash is one side
/// of this trade" and "is it assigned".
library OptionMath {
    /// @dev product(1e16 scale) -> 1e6: / 1e8 (qty scale) then / 1e2 (USD 1e8 -> 1e6).
    uint256 internal constant PRODUCT_TO_USDC = 1e10;

    /// @notice The cash side of the trade: `strike * qty`, rounded up.
    ///
    /// This one number is a put writer's collateral and a covered call writer's
    /// proceeds, and it is quoted once so both directions agree exactly. Rounding
    /// up means the locked side always covers what the other side is owed.
    function notionalUsdc(uint64 strike, uint64 qty) internal pure returns (uint128) {
        return uint128(Math.ceilDiv(uint256(strike) * qty, PRODUCT_TO_USDC));
    }

    /// @notice Whether the option is assigned at this settlement price.
    /// @dev A put is assigned below its strike, a covered call above it. Exactly
    /// at the strike neither is: there is nothing to exchange.
    function isAssigned(bool isPut, uint64 strike, uint64 settlementPrice)
        internal
        pure
        returns (bool)
    {
        return isPut ? settlementPrice < strike : settlementPrice > strike;
    }

    /// @notice Intrinsic value the writer gives up when assigned, in USDC.
    ///
    /// Reporting only — no transfer uses it. It is what the writer would have
    /// paid under cash settlement, and so the honest way to state the cost of
    /// an assignment next to the premium that was earned for taking it.
    function intrinsicUsdc(bool isPut, uint64 strike, uint64 qty, uint64 settlementPrice)
        internal
        pure
        returns (uint128)
    {
        if (!isAssigned(isPut, strike, settlementPrice)) return 0;
        uint256 diff = isPut
            ? uint256(strike - settlementPrice)
            : uint256(settlementPrice - strike);
        return uint128(diff * qty / PRODUCT_TO_USDC);
    }
}
