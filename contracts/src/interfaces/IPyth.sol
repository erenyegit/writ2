// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal vendored subset of the Pyth price feed structs used by Writ.
library PythStructs {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint64 publishTime;
    }

    struct PriceFeed {
        bytes32 id;
        Price price;
        Price emaPrice;
    }
}

/// @notice Minimal vendored subset of the IPyth interface used by Writ.
/// @dev GIWA Sepolia deployment: 0x2880aB155794e7179c9eE2e38200202908C17B43
interface IPyth {
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 feeAmount);

    /// @notice Parses `updateData` and returns, for each requested price id, the unique
    /// first price update whose publishTime is in [minPublishTime, maxPublishTime].
    /// Reverts if such an update cannot be verified from the payload.
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory priceFeeds);
}
