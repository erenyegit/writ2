// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {IPyth, PythStructs} from "../interfaces/IPyth.sol";

/// @title PythAdapter
/// @notice Settlement price source backed by Pyth's pull oracle.
///
/// Settlement reads the *unique first* Pyth update whose publishTime falls in
/// [expiry, expiry + settlementWindow]. "Unique first" is enforced by Pyth
/// itself (the update's prevPublishTime must be before the window), so a
/// settler cannot cherry-pick a favorable tick inside the window. Historical
/// payloads are served forever by Hermes benchmarks, so settlement can be
/// triggered any time after expiry.
contract PythAdapter is IOracleAdapter, Ownable {
    IPyth public immutable pyth;
    bytes32 public immutable priceFeedId;

    /// @notice Width of the accepted publish-time window after expiry.
    uint64 public settlementWindow = 1 hours;
    /// @notice Max accepted confidence interval, in basis points of price.
    uint64 public maxConfBps = 100; // 1%

    event SettlementWindowUpdated(uint64 window);
    event MaxConfBpsUpdated(uint64 bps);

    error InvalidOraclePrice();
    error ConfidenceTooWide();
    error UnsupportedExponent();
    error InvalidParams();

    constructor(address pyth_, bytes32 priceFeedId_) Ownable(msg.sender) {
        if (pyth_ == address(0) || priceFeedId_ == bytes32(0)) revert InvalidParams();
        pyth = IPyth(pyth_);
        priceFeedId = priceFeedId_;
    }

    /// @inheritdoc IOracleAdapter
    /// @dev `data` is abi.encode(bytes[] hermesUpdateBlobs). The full msg.value
    /// is forwarded to Pyth as the update fee; callers should send the exact
    /// fee from IPyth.getUpdateFee (Pyth keeps any excess).
    function getSettlementPrice(uint64 expiry, bytes calldata data)
        external
        payable
        returns (uint64)
    {
        bytes[] memory updateData = abi.decode(data, (bytes[]));
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = priceFeedId;

        PythStructs.PriceFeed[] memory feeds = pyth.parsePriceFeedUpdatesUnique{value: msg.value}(
            updateData, ids, expiry, expiry + settlementWindow
        );
        PythStructs.Price memory p = feeds[0].price;

        if (p.price <= 0) revert InvalidOraclePrice();
        uint256 raw = uint256(uint64(p.price));
        if (uint256(p.conf) * 10_000 > raw * maxConfBps) revert ConfidenceTooWide();

        uint256 price1e8 = _scaleTo1e8(raw, p.expo);
        if (price1e8 == 0 || price1e8 > type(uint64).max) revert InvalidOraclePrice();
        return uint64(price1e8);
    }

    function _scaleTo1e8(uint256 raw, int32 expo) private pure returns (uint256) {
        int256 e = int256(expo);
        if (e > 0 || e < -18) revert UnsupportedExponent();
        if (e >= -8) return raw * 10 ** uint256(e + 8);
        return raw / 10 ** uint256(-8 - e);
    }

    function setSettlementWindow(uint64 window) external onlyOwner {
        if (window == 0) revert InvalidParams();
        settlementWindow = window;
        emit SettlementWindowUpdated(window);
    }

    function setMaxConfBps(uint64 bps) external onlyOwner {
        if (bps == 0 || bps > 10_000) revert InvalidParams();
        maxConfBps = bps;
        emit MaxConfBpsUpdated(bps);
    }
}
