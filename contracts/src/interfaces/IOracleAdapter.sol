// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Pluggable settlement price source for WritOptions.
/// @dev Adapters wrap a concrete oracle (Pyth today; RedStone later) behind a
/// single call. The core contract stays oracle-agnostic so the backend can be
/// swapped without redeploying positions.
interface IOracleAdapter {
    /// @notice Returns the settlement price (USD, 1e8) for a given expiry.
    /// @dev MUST revert if a trustworthy price for the window starting at
    /// `expiry` cannot be derived from `data`. May require a fee in native
    /// currency (forwarded via msg.value).
    /// @param expiry Unix timestamp of the option expiry.
    /// @param data Oracle-specific payload (e.g. abi-encoded Pyth update blobs).
    /// @return price1e8 Settlement price in USD scaled by 1e8.
    function getSettlementPrice(uint64 expiry, bytes calldata data)
        external
        payable
        returns (uint64 price1e8);
}
