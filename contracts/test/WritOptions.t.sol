// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {WritOptions} from "../src/WritOptions.sol";
import {PythAdapter} from "../src/adapters/PythAdapter.sol";
import {OptionMath} from "../src/libraries/OptionMath.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

contract WritOptionsTest is Test {
    bytes32 constant FEED_ID =
        0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    uint256 constant QUOTER_PK = 0xA11CE;

    MockUSDC usdc;
    MockPyth pyth;
    PythAdapter adapter;
    WritOptions core;

    address quoter;
    address writer = makeAddr("writer");
    uint256 nonceCounter = 1;

    function setUp() public {
        quoter = vm.addr(QUOTER_PK);
        usdc = new MockUSDC();
        pyth = new MockPyth();
        adapter = new PythAdapter(address(pyth), FEED_ID);
        core = new WritOptions(address(usdc), address(adapter), quoter);

        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(core), type(uint256).max);
        core.depositDesk(200_000e6);

        usdc.mint(writer, 500_000e6);
        vm.prank(writer);
        usdc.approve(address(core), type(uint256).max);

        vm.deal(address(this), 10 ether);
        vm.deal(writer, 10 ether);
    }

    // ------------------------------------------------------------- helpers

    /// Put: strike $65,000, qty 0.1 BTC -> collateral 6,500 USDC, premium 120 USDC.
    function _putQuote() internal returns (WritOptions.Quote memory q) {
        q = WritOptions.Quote({
            writer: writer,
            isPut: true,
            strike: 65_000e8,
            cap: 0,
            qty: 1e7,
            expiry: uint64(block.timestamp + 1 days),
            premium: 120e6,
            quoteDeadline: uint64(block.timestamp + 60),
            nonce: nonceCounter++
        });
    }

    /// Capped call: strike $65,000, cap $75,000, qty 0.1 BTC -> collateral 1,000 USDC.
    function _callQuote() internal returns (WritOptions.Quote memory q) {
        q = _putQuote();
        q.isPut = false;
        q.cap = 75_000e8;
        q.premium = 60e6;
    }

    function _sign(WritOptions.Quote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(QUOTER_PK, core.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _write(WritOptions.Quote memory q) internal returns (uint256 id) {
        bytes memory sig = _sign(q);
        vm.prank(writer);
        id = core.writeOption(q, sig);
    }

    function _oracleData(int64 price, uint64 publishTime, uint64 prevPublishTime, int32 expo)
        internal
        view
        returns (bytes memory)
    {
        uint64 conf = uint64(uint256(int256(price)) / 10_000); // 1 bp, well within limits
        bytes[] memory updates = new bytes[](1);
        updates[0] = pyth.createUpdateData(FEED_ID, price, conf, expo, publishTime, prevPublishTime);
        return abi.encode(updates);
    }

    function _settleAt(uint256 id, uint64 expiry, int64 price) internal {
        vm.warp(expiry + 5);
        core.settle{value: 1}(id, _oracleData(price, expiry + 2, expiry - 10, -8));
    }

    function _assertSolvent() internal view {
        assertEq(
            usdc.balanceOf(address(core)),
            core.deskBalance() + core.totalOpenCollateral(),
            "solvency invariant broken"
        );
    }

    // ------------------------------------------------------------- deploy

    function test_Constructor_RevertZeroAddress() public {
        vm.expectRevert(WritOptions.ZeroAddress.selector);
        new WritOptions(address(0), address(adapter), quoter);
        vm.expectRevert(WritOptions.ZeroAddress.selector);
        new WritOptions(address(usdc), address(0), quoter);
        vm.expectRevert(WritOptions.ZeroAddress.selector);
        new WritOptions(address(usdc), address(adapter), address(0));
    }

    // ------------------------------------------------------------- write

    function test_WritePut_HappyPath() public {
        uint256 writerBefore = usdc.balanceOf(writer);
        WritOptions.Quote memory q = _putQuote();

        uint256 id = _write(q);

        WritOptions.Position memory pos = core.getPosition(id);
        assertEq(pos.writer, writer);
        assertTrue(pos.isPut);
        assertEq(pos.collateral, 6_500e6);
        assertEq(pos.premium, 120e6);
        assertEq(uint8(pos.state), uint8(WritOptions.PositionState.Open));

        // writer paid collateral, received premium instantly
        assertEq(usdc.balanceOf(writer), writerBefore - 6_500e6 + 120e6);
        assertEq(core.totalOpenCollateral(), 6_500e6);
        assertEq(core.deskBalance(), 200_000e6 - 120e6);
        assertEq(core.getWriterPositionIds(writer).length, 1);
        assertEq(core.getWriterPositionIds(writer)[0], id);
        _assertSolvent();
    }

    function test_WriteCall_HappyPath() public {
        uint256 id = _write(_callQuote());
        WritOptions.Position memory pos = core.getPosition(id);
        assertEq(pos.collateral, 1_000e6); // (75k - 65k) * 0.1
        assertEq(pos.premium, 60e6);
        _assertSolvent();
    }

    function test_Write_RevertWhen_SenderNotWriter() public {
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.expectRevert(WritOptions.NotQuoteWriter.selector);
        core.writeOption(q, sig); // called by test contract, not `writer`
    }

    function test_Write_RevertWhen_QuoteDeadlinePassed() public {
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.warp(block.timestamp + 61);
        vm.prank(writer);
        vm.expectRevert(WritOptions.QuoteExpired.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_NonceReused() public {
        WritOptions.Quote memory q = _putQuote();
        _write(q);
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.NonceAlreadyUsed.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_SignatureTampered() public {
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        q.premium = 6_000e6; // inflate premium after signing
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidQuoteSignature.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_SignerNotQuoter() public {
        WritOptions.Quote memory q = _putQuote();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, core.hashQuote(q));
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidQuoteSignature.selector);
        core.writeOption(q, abi.encodePacked(r, s, v));
    }

    function test_Write_RevertWhen_ExpiryTooSoon() public {
        WritOptions.Quote memory q = _putQuote();
        q.expiry = uint64(block.timestamp + 10 minutes);
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.ExpiryOutOfRange.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_ExpiryTooFar() public {
        WritOptions.Quote memory q = _putQuote();
        q.expiry = uint64(block.timestamp + 31 days);
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.ExpiryOutOfRange.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_PutHasCap() public {
        WritOptions.Quote memory q = _putQuote();
        q.cap = 1;
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidOptionParams.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_CallCapNotAboveStrike() public {
        WritOptions.Quote memory q = _callQuote();
        q.cap = q.strike;
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidOptionParams.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_PremiumGteCollateral() public {
        WritOptions.Quote memory q = _putQuote();
        q.premium = 6_500e6; // == collateral
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidPremium.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_PremiumZero() public {
        WritOptions.Quote memory q = _putQuote();
        q.premium = 0;
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidPremium.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_DeskUnderfunded() public {
        core.withdrawDesk(address(this), 200_000e6 - 1e6); // leave 1 USDC
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InsufficientDeskLiquidity.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_Paused() public {
        core.pause();
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_PositionTooLarge() public {
        core.setRiskParams(20 minutes, 30 days, 3 days, 1_000e6, 1_000_000e6);
        WritOptions.Quote memory q = _putQuote(); // needs 6,500 USDC
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.PositionTooLarge.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_ProtocolCapReached() public {
        core.setRiskParams(20 minutes, 30 days, 3 days, 100_000e6, 10_000e6);
        _write(_putQuote()); // 6,500 locked, cap 10,000
        WritOptions.Quote memory q2 = _putQuote();
        bytes memory sig = _sign(q2);
        vm.prank(writer);
        vm.expectRevert(WritOptions.ProtocolCapReached.selector);
        core.writeOption(q2, sig);
    }

    // ------------------------------------------------------------- settle

    function test_SettlePut_ITM() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        uint256 writerBefore = usdc.balanceOf(writer);
        uint256 deskBefore = core.deskBalance();

        _settleAt(id, q.expiry, 60_000e8); // $5,000 ITM on 0.1 BTC = 500 USDC

        WritOptions.Position memory pos = core.getPosition(id);
        assertEq(uint8(pos.state), uint8(WritOptions.PositionState.Settled));
        assertEq(pos.payout, 500e6);
        assertEq(pos.settlementPrice, 60_000e8);
        assertEq(usdc.balanceOf(writer), writerBefore + 6_000e6); // collateral - payout
        assertEq(core.deskBalance(), deskBefore + 500e6);
        assertEq(core.totalOpenCollateral(), 0);
        _assertSolvent();
    }

    function test_SettlePut_OTM_FullRefund() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        uint256 writerBefore = usdc.balanceOf(writer);

        _settleAt(id, q.expiry, 70_000e8);

        assertEq(core.getPosition(id).payout, 0);
        assertEq(usdc.balanceOf(writer), writerBefore + 6_500e6);
        _assertSolvent();
    }

    function test_SettlePut_ATM_NoPayout() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        _settleAt(id, q.expiry, 65_000e8);
        assertEq(core.getPosition(id).payout, 0);
        _assertSolvent();
    }

    function test_SettleCall_CappedAtCap() public {
        WritOptions.Quote memory q = _callQuote();
        uint256 id = _write(q);
        uint256 writerBefore = usdc.balanceOf(writer);

        _settleAt(id, q.expiry, 80_000e8); // above cap -> full 1,000 USDC payout

        assertEq(core.getPosition(id).payout, 1_000e6);
        assertEq(usdc.balanceOf(writer), writerBefore); // no refund
        _assertSolvent();
    }

    function test_SettleCall_BelowCap() public {
        WritOptions.Quote memory q = _callQuote();
        uint256 id = _write(q);
        _settleAt(id, q.expiry, 70_000e8); // $5,000 over strike on 0.1 BTC
        assertEq(core.getPosition(id).payout, 500e6);
        _assertSolvent();
    }

    function test_Settle_RevertWhen_BeforeExpiry() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        bytes memory data = _oracleData(60_000e8, q.expiry + 2, q.expiry - 10, -8);
        vm.expectRevert(WritOptions.NotYetExpired.selector);
        core.settle{value: 1}(id, data);
    }

    function test_Settle_RevertWhen_AlreadySettled() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        _settleAt(id, q.expiry, 60_000e8);
        bytes memory data = _oracleData(60_000e8, q.expiry + 2, q.expiry - 10, -8);
        vm.expectRevert(WritOptions.PositionNotOpen.selector);
        core.settle{value: 1}(id, data);
    }

    function test_Settle_RevertWhen_PublishTimeOutsideWindow() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 3 hours);
        bytes memory data = _oracleData(60_000e8, q.expiry + 2 hours, q.expiry - 10, -8);
        vm.expectRevert(bytes("MockPyth: publishTime outside window"));
        core.settle{value: 1}(id, data);
    }

    function test_Settle_RevertWhen_NotFirstTickInWindow() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 5);
        // prevPublishTime inside the window -> this is not the first tick
        bytes memory data = _oracleData(60_000e8, q.expiry + 3, q.expiry + 1, -8);
        vm.expectRevert(bytes("MockPyth: not first update in window"));
        core.settle{value: 1}(id, data);
    }

    function test_Settle_RevertWhen_ConfidenceTooWide() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 5);
        // conf = 2% of price, above the 1% default limit
        bytes[] memory updates = new bytes[](1);
        updates[0] =
            pyth.createUpdateData(FEED_ID, 60_000e8, 1_200e8, -8, q.expiry + 2, q.expiry - 10);
        vm.expectRevert(PythAdapter.ConfidenceTooWide.selector);
        core.settle{value: 1}(id, abi.encode(updates));
    }

    function test_Settle_NormalizesExpoMinus6() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 5);
        // $60,000 expressed at expo -6 must settle identically to expo -8
        core.settle{value: 1}(id, _oracleData(60_000e6, q.expiry + 2, q.expiry - 10, -6));
        assertEq(core.getPosition(id).settlementPrice, 60_000e8);
        assertEq(core.getPosition(id).payout, 500e6);
        _assertSolvent();
    }

    // ------------------------------------------------------------- fallback

    function test_SettleFallback_RevertWhen_TooEarly() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 1);
        vm.expectRevert(WritOptions.FallbackTooEarly.selector);
        core.settleFallback(id, 60_000e8);
    }

    function test_SettleFallback_RevertWhen_NotOwner() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 4 days);
        vm.prank(writer);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, writer)
        );
        core.settleFallback(id, 60_000e8);
    }

    function test_SettleFallback_Works() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 4 days);
        core.settleFallback(id, 60_000e8);
        assertEq(core.getPosition(id).payout, 500e6);
        _assertSolvent();
    }

    // ------------------------------------------------------------- desk

    function test_WithdrawDesk_RevertWhen_ExceedsFreeBalance() public {
        vm.expectRevert(WritOptions.InsufficientDeskLiquidity.selector);
        core.withdrawDesk(address(this), 200_000e6 + 1);
    }

    function test_WithdrawDesk_NeverTouchesCollateral() public {
        _write(_putQuote()); // locks 6,500 collateral, pays 120 premium
        core.withdrawDesk(address(this), core.deskBalance()); // withdraw all free desk funds
        // locked collateral must remain untouched in the contract
        assertEq(usdc.balanceOf(address(core)), core.totalOpenCollateral());
        assertEq(core.totalOpenCollateral(), 6_500e6);
        _assertSolvent();
    }

    // ------------------------------------------------------------- fuzz

    /// The core solvency property: no settlement price can ever produce a
    /// payout above the locked collateral.
    function testFuzz_PayoutNeverExceedsCollateral(
        bool isPut,
        uint64 strike,
        uint64 capDelta,
        uint64 qty,
        uint64 price
    ) public pure {
        strike = uint64(bound(strike, 1, 1e15)); // up to $10M at 1e8
        qty = uint64(bound(qty, 1, 1e15)); // up to 10M BTC at 1e8
        uint64 cap = isPut ? 0 : uint64(bound(capDelta, 1, 1e15)) + strike;

        uint128 collateral = OptionMath.collateralUsdc(isPut, strike, cap, qty);
        uint128 payout = OptionMath.payoutUsdc(isPut, strike, cap, qty, price);
        assertLe(payout, collateral);
    }

    // ------------------------------------------------------------- e2e

    function test_EndToEnd_TwoPositions_SolvencyMaintained() public {
        WritOptions.Quote memory p = _putQuote();
        uint256 putId = _write(p);
        _assertSolvent();

        WritOptions.Quote memory c = _callQuote();
        uint256 callId = _write(c);
        _assertSolvent();

        _settleAt(putId, p.expiry, 60_000e8); // put ITM: desk +500
        _assertSolvent();

        vm.warp(c.expiry + 5);
        core.settle{value: 1}(callId, _oracleData(60_000e8, c.expiry + 2, c.expiry - 10, -8));
        _assertSolvent(); // call OTM: full refund

        // desk P&L: -120 -60 premiums, +500 put payout
        assertEq(core.deskBalance(), 200_000e6 - 120e6 - 60e6 + 500e6);
        assertEq(core.totalOpenCollateral(), 0);

        core.withdrawDesk(address(this), core.deskBalance());
        assertEq(usdc.balanceOf(address(core)), 0);
    }
}
