// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPyth, PythStructs} from "../../src/interfaces/IPyth.sol";

/// @notice Test double for Pyth mirroring parsePriceFeedUpdatesUnique semantics:
/// fee enforcement, publish-time window checks, and the "unique first tick"
/// rule (prevPublishTime must be strictly before the window).
contract MockPyth is IPyth {
    uint256 public constant FEE_PER_UPDATE = 1;

    struct Update {
        bytes32 id;
        int64 price;
        uint64 conf;
        int32 expo;
        uint64 publishTime;
        uint64 prevPublishTime;
    }

    function createUpdateData(
        bytes32 id,
        int64 price,
        uint64 conf,
        int32 expo,
        uint64 publishTime,
        uint64 prevPublishTime
    ) external pure returns (bytes memory) {
        return abi.encode(Update(id, price, conf, expo, publishTime, prevPublishTime));
    }

    function getUpdateFee(bytes[] calldata updateData) external pure returns (uint256) {
        return updateData.length * FEE_PER_UPDATE;
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory feeds) {
        require(msg.value >= updateData.length * FEE_PER_UPDATE, "MockPyth: insufficient fee");
        feeds = new PythStructs.PriceFeed[](priceIds.length);

        for (uint256 i = 0; i < priceIds.length; i++) {
            bool found;
            for (uint256 j = 0; j < updateData.length; j++) {
                Update memory u = abi.decode(updateData[j], (Update));
                if (u.id != priceIds[i]) continue;
                require(
                    u.publishTime >= minPublishTime && u.publishTime <= maxPublishTime,
                    "MockPyth: publishTime outside window"
                );
                require(u.prevPublishTime < minPublishTime, "MockPyth: not first update in window");
                feeds[i] = PythStructs.PriceFeed({
                    id: u.id,
                    price: PythStructs.Price(u.price, u.conf, u.expo, u.publishTime),
                    emaPrice: PythStructs.Price(u.price, u.conf, u.expo, u.publishTime)
                });
                found = true;
                break;
            }
            require(found, "MockPyth: feed not found");
        }
    }
}
