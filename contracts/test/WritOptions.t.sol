// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {WritOptions} from "../src/WritOptions.sol";
import {PythAdapter} from "../src/adapters/PythAdapter.sol";
import {OptionMath} from "../src/libraries/OptionMath.sol";
import {MockBTC} from "./mocks/MockBTC.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPyth} from "./mocks/MockPyth.sol";

contract WritOptionsTest is Test {
    bytes32 constant FEED_ID =
        0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;
    uint256 constant QUOTER_PK = 0xA11CE;

    MockUSDC usdc;
    MockBTC btc;
    MockPyth pyth;
    PythAdapter adapter;
    WritOptions core;

    address quoter;
    address writer = makeAddr("writer");
    uint256 nonceCounter = 1;

    function setUp() public {
        quoter = vm.addr(QUOTER_PK);
        usdc = new MockUSDC();
        btc = new MockBTC();
        pyth = new MockPyth();
        adapter = new PythAdapter(address(pyth), FEED_ID);
        core = new WritOptions(address(usdc), address(btc), address(adapter));
        core.registerMaker(address(this), quoter);

        // Physical settlement means the desk holds both sides: cash to buy a
        // covered call away, and the underlying to deliver into an assigned put.
        usdc.mint(address(this), 1_000_000e6);
        btc.mint(address(this), 100e8);
        usdc.approve(address(core), type(uint256).max);
        btc.approve(address(core), type(uint256).max);
        core.depositMakerUsdc(200_000e6);
        core.depositMakerBtc(50e8);

        usdc.mint(writer, 500_000e6);
        btc.mint(writer, 10e8);
        vm.startPrank(writer);
        usdc.approve(address(core), type(uint256).max);
        btc.approve(address(core), type(uint256).max);
        vm.stopPrank();

        vm.deal(address(this), 10 ether);
        vm.deal(writer, 10 ether);
    }

    // ------------------------------------------------------------- helpers

    /// Put: strike $65,000, qty 0.1 BTC -> collateral 6,500 USDC, premium 120 USDC.
    function _putQuote() internal returns (WritOptions.Quote memory q) {
        q = WritOptions.Quote({
            writer: writer,
            maker: address(this),
            isPut: true,
            strike: 65_000e8,
            qty: 1e7,
            expiry: uint64(block.timestamp + 1 days),
            premium: 120e6,
            quoteDeadline: uint64(block.timestamp + 60),
            nonce: nonceCounter++
        });
    }

    /// Covered call: same strike and size, collateral is 0.1 BTC.
    function _callQuote() internal returns (WritOptions.Quote memory q) {
        q = _putQuote();
        q.isPut = false;
        q.premium = 90e6;
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

    /// Every token in the contract is either uncommitted desk inventory, desk
    /// inventory reserved against an open position, or writer collateral.
    function _assertSolvent() internal view {
        assertEq(
            usdc.balanceOf(address(core)),
            core.makerUsdcFree() + core.makerUsdcReserved() + core.writerUsdcCollateral(),
            "usdc solvency invariant broken"
        );
        assertEq(
            btc.balanceOf(address(core)),
            core.makerBtcFree() + core.makerBtcReserved() + core.writerBtcCollateral(),
            "btc solvency invariant broken"
        );
    }

    // ------------------------------------------------------------- deploy

    function test_Constructor_RevertZeroAddress() public {
        vm.expectRevert(WritOptions.ZeroAddress.selector);
        new WritOptions(address(0), address(btc), address(adapter));
        vm.expectRevert(WritOptions.ZeroAddress.selector);
        new WritOptions(address(usdc), address(0), address(adapter));
        vm.expectRevert(WritOptions.ZeroAddress.selector);
        new WritOptions(address(usdc), address(btc), address(0));
    }

    // ------------------------------------------------------------- write

    function test_WritePut_LocksCashAndReservesUnderlying() public {
        uint256 usdcBefore = usdc.balanceOf(writer);
        uint256 btcFreeBefore = core.makerBtcFree();

        uint256 id = _write(_putQuote());

        WritOptions.Position memory pos = core.getPosition(id);
        assertTrue(pos.isPut);
        assertEq(pos.collateral, 6_500e6);
        assertEq(uint8(pos.state), uint8(WritOptions.PositionState.Open));

        assertEq(usdc.balanceOf(writer), usdcBefore - 6_500e6 + 120e6);
        assertEq(core.writerUsdcCollateral(), 6_500e6);
        // The desk may have to deliver, so that underlying is no longer free.
        assertEq(core.makerBtcFree(), btcFreeBefore - 1e7);
        assertEq(core.makerBtcReserved(), 1e7);
        _assertSolvent();
    }

    function test_WriteCoveredCall_LocksUnderlyingAndReservesCash() public {
        uint256 btcBefore = btc.balanceOf(writer);
        uint256 usdcFreeBefore = core.makerUsdcFree();

        uint256 id = _write(_callQuote());

        WritOptions.Position memory pos = core.getPosition(id);
        assertFalse(pos.isPut);
        assertEq(pos.collateral, 1e7, "collateral is the underlying, one for one");

        assertEq(btc.balanceOf(writer), btcBefore - 1e7);
        assertEq(core.writerBtcCollateral(), 1e7);
        // 6,500 reserved to buy it away, and 90 already paid out as premium.
        assertEq(core.makerUsdcFree(), usdcFreeBefore - 6_500e6 - 90e6);
        assertEq(core.makerUsdcReserved(), 6_500e6);
        _assertSolvent();
    }

    function test_WritePut_RevertWhen_DeskCannotDeliverUnderlying() public {
        core.withdrawMakerBtc(address(this), core.makerBtcFree());
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InsufficientDeskInventory.selector);
        core.writeOption(q, sig);
    }

    function test_WriteCall_RevertWhen_DeskCannotPayStrike() public {
        core.withdrawMakerUsdc(address(this), core.makerUsdcFree() - 100e6);
        WritOptions.Quote memory q = _callQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InsufficientDeskInventory.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_SenderNotWriter() public {
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.expectRevert(WritOptions.NotQuoteWriter.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_QuoteDeadlinePassed() public {
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.warp(q.quoteDeadline + 1);
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
        q.premium = 121e6; // signed for 120
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidQuoteSignature.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_SignerNotQuoter() public {
        WritOptions.Quote memory q = _putQuote();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, core.hashQuote(q));
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidQuoteSignature.selector);
        core.writeOption(q, abi.encodePacked(r, s, v));
    }

    function test_Write_RevertWhen_ExpiryTooSoon() public {
        WritOptions.Quote memory q = _putQuote();
        q.expiry = uint64(block.timestamp + 5 minutes);
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

    function test_Write_RevertWhen_PremiumZero() public {
        WritOptions.Quote memory q = _putQuote();
        q.premium = 0;
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidPremium.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_PremiumGteNotional() public {
        WritOptions.Quote memory q = _putQuote();
        q.premium = 6_500e6;
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidPremium.selector);
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
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.PositionTooLarge.selector);
        core.writeOption(q, sig);
    }

    function test_Write_RevertWhen_ProtocolCapReached() public {
        core.setRiskParams(20 minutes, 30 days, 3 days, 10_000e6, 10_000e6);
        _write(_putQuote());
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.ProtocolCapReached.selector);
        core.writeOption(q, sig);
    }

    // ------------------------------------------------------------- settle

    function test_SettlePut_Assigned_WriterReceivesUnderlying() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        uint256 btcBefore = btc.balanceOf(writer);
        uint256 usdcBefore = usdc.balanceOf(writer);

        _settleAt(id, q.expiry, 60_000e8); // below the strike

        WritOptions.Position memory pos = core.getPosition(id);
        assertTrue(pos.assigned);
        // The writer bought at the price they named: cash out, underlying in.
        assertEq(btc.balanceOf(writer), btcBefore + 1e7);
        assertEq(usdc.balanceOf(writer), usdcBefore, "no cash comes back on assignment");
        assertEq(core.makerUsdcFree(), 200_000e6 - 120e6 + 6_500e6);
        assertEq(core.makerBtcReserved(), 0);
        _assertSolvent();
    }

    function test_SettlePut_NotAssigned_CashReturned() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        uint256 btcBefore = btc.balanceOf(writer);
        uint256 usdcBefore = usdc.balanceOf(writer);

        _settleAt(id, q.expiry, 70_000e8); // above the strike

        assertFalse(core.getPosition(id).assigned);
        assertEq(usdc.balanceOf(writer), usdcBefore + 6_500e6);
        assertEq(btc.balanceOf(writer), btcBefore, "no delivery when not assigned");
        assertEq(core.makerBtcFree(), 50e8, "reserved underlying is released");
        _assertSolvent();
    }

    function test_SettleCall_Assigned_WriterReceivesStrike() public {
        WritOptions.Quote memory q = _callQuote();
        uint256 id = _write(q);
        uint256 btcBefore = btc.balanceOf(writer);
        uint256 usdcBefore = usdc.balanceOf(writer);

        _settleAt(id, q.expiry, 70_000e8); // above the strike

        assertTrue(core.getPosition(id).assigned);
        // Sold at the strike, not at spot: that is the commitment being kept.
        assertEq(usdc.balanceOf(writer), usdcBefore + 6_500e6);
        assertEq(btc.balanceOf(writer), btcBefore, "the underlying is gone");
        assertEq(core.makerBtcFree(), 50e8 + 1e7);
        assertEq(core.makerUsdcReserved(), 0);
        _assertSolvent();
    }

    function test_SettleCall_NotAssigned_UnderlyingReturned() public {
        WritOptions.Quote memory q = _callQuote();
        uint256 id = _write(q);
        uint256 btcBefore = btc.balanceOf(writer);

        _settleAt(id, q.expiry, 60_000e8); // below the strike

        assertFalse(core.getPosition(id).assigned);
        assertEq(btc.balanceOf(writer), btcBefore + 1e7);
        _assertSolvent();
    }

    function test_Settle_AtTheStrike_NeitherSideAssigned() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        uint256 usdcBefore = usdc.balanceOf(writer);

        _settleAt(id, q.expiry, 65_000e8); // exactly the strike

        assertFalse(core.getPosition(id).assigned, "nothing to exchange at the strike");
        assertEq(usdc.balanceOf(writer), usdcBefore + 6_500e6);
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
        _settleAt(id, q.expiry, 70_000e8);
        bytes memory data = _oracleData(70_000e8, q.expiry + 2, q.expiry - 10, -8);
        vm.expectRevert(WritOptions.PositionNotOpen.selector);
        core.settle{value: 1}(id, data);
    }

    function test_SettleMany_SharesOneOracleUpdate() public {
        WritOptions.Quote memory a = _putQuote();
        WritOptions.Quote memory b = _callQuote();
        uint256 idA = _write(a);
        uint256 idB = _write(b);

        uint256[] memory ids = new uint256[](2);
        ids[0] = idA;
        ids[1] = idB;

        vm.warp(a.expiry + 5);
        core.settleMany{value: 1}(ids, _oracleData(70_000e8, a.expiry + 2, a.expiry - 10, -8));

        assertEq(uint8(core.getPosition(idA).state), uint8(WritOptions.PositionState.Settled));
        assertEq(uint8(core.getPosition(idB).state), uint8(WritOptions.PositionState.Settled));
        assertEq(core.totalOpenNotional(), 0);
        _assertSolvent();
    }

    function test_SettleMany_RevertWhen_ExpiriesDiffer() public {
        WritOptions.Quote memory a = _putQuote();
        WritOptions.Quote memory b = _putQuote();
        b.expiry = uint64(block.timestamp + 2 days);
        uint256 idA = _write(a);
        uint256 idB = _write(b);

        uint256[] memory ids = new uint256[](2);
        ids[0] = idA;
        ids[1] = idB;

        vm.warp(b.expiry + 5);
        bytes memory data = _oracleData(70_000e8, a.expiry + 2, a.expiry - 10, -8);
        vm.expectRevert(WritOptions.PositionNotOpen.selector);
        core.settleMany{value: 1}(ids, data);
    }

    // ------------------------------------------------------------- fallback

    function test_SettleFallback_RevertWhen_TooEarly() public {
        WritOptions.Quote memory q = _putQuote();
        uint256 id = _write(q);
        vm.warp(q.expiry + 1 days);
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
        uint256 btcBefore = btc.balanceOf(writer);
        vm.warp(q.expiry + 4 days);
        core.settleFallback(id, 60_000e8);
        assertTrue(core.getPosition(id).assigned);
        assertEq(btc.balanceOf(writer), btcBefore + 1e7);
        _assertSolvent();
    }

    // ------------------------------------------------------------- desk

    function test_WithdrawDesk_CannotTouchReservesOrCollateral() public {
        _write(_putQuote()); // reserves 0.1 BTC, locks 6,500 USDC of writer cash

        core.withdrawMakerUsdc(address(this), core.makerUsdcFree());
        core.withdrawMakerBtc(address(this), core.makerBtcFree());

        // What remains is exactly what is owed to the open position.
        assertEq(usdc.balanceOf(address(core)), core.writerUsdcCollateral());
        assertEq(btc.balanceOf(address(core)), core.makerBtcReserved());
        assertEq(core.makerBtcReserved(), 1e7);
        _assertSolvent();
    }

    function test_WithdrawDesk_RevertWhen_ExceedsFree() public {
        // Read the balances first: expectRevert arms the very next call, and a
        // view read inside the argument list would be the one it catches.
        uint256 tooMuchUsdc = core.makerUsdcFree() + 1;
        uint256 tooMuchBtc = core.makerBtcFree() + 1;

        vm.expectRevert(WritOptions.InsufficientDeskLiquidity.selector);
        core.withdrawMakerUsdc(address(this), tooMuchUsdc);
        vm.expectRevert(WritOptions.InsufficientDeskInventory.selector);
        core.withdrawMakerBtc(address(this), tooMuchBtc);
    }

    function test_MakerCapacity_TracksTheDeliverableSide() public view {
        // A put is limited by underlying the maker can deliver.
        assertEq(core.makerCapacity(address(this), true, 65_000e8, 1e7), 50e8 / 1e7);
        // A covered call is limited by cash the maker can pay.
        assertEq(core.makerCapacity(address(this), false, 65_000e8, 1e7), uint256(200_000e6) / 6_500e6);
    }

    // ------------------------------------------------------------- makers

    uint256 constant MAKER_B_PK = 0xB0BB1E;

    /// Register a second maker with its own signer and its own inventory.
    function _secondMaker() internal returns (address maker, uint256 signerPk) {
        signerPk = MAKER_B_PK;
        maker = makeAddr("makerB");
        core.registerMaker(maker, vm.addr(signerPk));

        usdc.mint(maker, 100_000e6);
        btc.mint(maker, 20e8);
        vm.startPrank(maker);
        usdc.approve(address(core), type(uint256).max);
        btc.approve(address(core), type(uint256).max);
        core.depositMakerUsdc(100_000e6);
        core.depositMakerBtc(20e8);
        vm.stopPrank();
    }

    function _writeAgainst(address maker, uint256 signerPk, bool isPut)
        internal
        returns (uint256 id)
    {
        WritOptions.Quote memory q = isPut ? _putQuote() : _callQuote();
        q.maker = maker;
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(signerPk, core.hashQuote(q));
        vm.prank(writer);
        id = core.writeOption(q, abi.encodePacked(r, sg, v));
    }

    function test_Makers_OneGoingQuietDoesNotStopTheOther() public {
        (address makerB, uint256 pkB) = _secondMaker();

        core.setMakerActive(address(this), false);

        // The first maker can no longer quote...
        WritOptions.Quote memory q = _putQuote();
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.MakerNotActive.selector);
        core.writeOption(q, sig);

        // ...and the market keeps working through the other one.
        uint256 id = _writeAgainst(makerB, pkB, true);
        assertEq(core.getPosition(id).maker, makerB);
        _assertSolvent();
    }

    function test_Makers_ReserveIsRingFencedPerMaker() public {
        (address makerB, uint256 pkB) = _secondMaker();
        _writeAgainst(makerB, pkB, true); // reserves 0.1 BTC of B's inventory

        (, , , uint128 btcFreeB, uint128 btcReservedB,) = core.makers(makerB);
        (, , , uint128 btcFreeA, uint128 btcReservedA,) = core.makers(address(this));

        assertEq(btcReservedB, 1e7, "B backs its own position");
        assertEq(btcReservedA, 0, "A is untouched by B's trade");
        assertEq(btcFreeB, 20e8 - 1e7);
        assertEq(btcFreeA, 50e8);
        _assertSolvent();
    }

    function test_Makers_SignerCannotQuoteForAnother() public {
        (address makerB,) = _secondMaker();

        // A's signer, B's name on the quote.
        WritOptions.Quote memory q = _putQuote();
        q.maker = makerB;
        bytes memory sig = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidQuoteSignature.selector);
        core.writeOption(q, sig);
    }

    function test_Makers_WithdrawCannotReachAnotherMakersBalance() public {
        (address makerB, uint256 pkB) = _secondMaker();
        _writeAgainst(makerB, pkB, false); // reserves 6,500 USDC of B's cash

        // B may take out only what is still free on its own book.
        vm.prank(makerB);
        vm.expectRevert(WritOptions.InsufficientDeskLiquidity.selector);
        core.withdrawMakerUsdc(makerB, 100_000e6);

        vm.prank(makerB);
        core.withdrawMakerUsdc(makerB, 100_000e6 - 6_500e6 - 90e6);
        _assertSolvent();
    }

    function test_Makers_RevertWhen_NotRegistered() public {
        address stranger = makeAddr("stranger");
        usdc.mint(stranger, 1_000e6);
        vm.startPrank(stranger);
        usdc.approve(address(core), type(uint256).max);
        vm.expectRevert(WritOptions.NotMaker.selector);
        core.depositMakerUsdc(1_000e6);
        vm.stopPrank();
    }

    function test_Makers_SignerRotation() public {
        uint256 newPk = 0xFEED;
        core.setMakerSigner(address(this), vm.addr(newPk));

        // The old key stops working immediately.
        WritOptions.Quote memory q = _putQuote();
        bytes memory old = _sign(q);
        vm.prank(writer);
        vm.expectRevert(WritOptions.InvalidQuoteSignature.selector);
        core.writeOption(q, old);

        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(newPk, core.hashQuote(q));
        vm.prank(writer);
        core.writeOption(q, abi.encodePacked(r, sg, v));
        _assertSolvent();
    }

    function test_Makers_InvariantHoldsAcrossBothBooks() public {
        (address makerB, uint256 pkB) = _secondMaker();
        WritOptions.Quote memory a = _putQuote();
        _write(a); // against maker A
        _writeAgainst(makerB, pkB, false); // against maker B
        _assertSolvent();

        vm.warp(a.expiry + 5);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        core.settleMany{value: 1}(ids, _oracleData(70_000e8, a.expiry + 2, a.expiry - 10, -8));
        _assertSolvent();
        assertEq(core.makerUsdcReserved(), 0);
        assertEq(core.makerBtcReserved(), 0);
    }

    // ------------------------------------------------------------- fuzz

    /// The cash leg is quoted once and used in both directions, so a put's
    /// collateral and a covered call's proceeds can never disagree.
    function testFuzz_NotionalIsSymmetric(uint64 strike, uint64 qty) public pure {
        strike = uint64(bound(strike, 1, 1e15));
        qty = uint64(bound(qty, 1, 1e15));
        assertEq(
            OptionMath.notionalUsdc(strike, qty),
            OptionMath.notionalUsdc(strike, qty),
            "notional must be deterministic"
        );
        // Rounding up means the locked side always covers what is owed.
        assertGe(uint256(OptionMath.notionalUsdc(strike, qty)) * 1e10, uint256(strike) * qty);
    }

    /// Assignment is a strict inequality on each side, so exactly at the strike
    /// neither product is assigned and nothing changes hands.
    function testFuzz_AssignmentIsExclusiveAtTheStrike(uint64 strike, uint64 price) public pure {
        strike = uint64(bound(strike, 1, 1e15));
        bool put = OptionMath.isAssigned(true, strike, price);
        bool call = OptionMath.isAssigned(false, strike, price);
        assertFalse(put && call, "both sides can never be assigned at once");
        if (price == strike) {
            assertFalse(put);
            assertFalse(call);
        }
    }

    // ------------------------------------------------------------- e2e

    function test_EndToEnd_BothProducts_SolvencyMaintained() public {
        WritOptions.Quote memory p = _putQuote();
        uint256 putId = _write(p);
        WritOptions.Quote memory c = _callQuote();
        uint256 callId = _write(c);
        _assertSolvent();

        // One price assigns the call and spares the put.
        vm.warp(p.expiry + 5);
        uint256[] memory ids = new uint256[](2);
        ids[0] = putId;
        ids[1] = callId;
        core.settleMany{value: 1}(ids, _oracleData(70_000e8, p.expiry + 2, p.expiry - 10, -8));

        assertFalse(core.getPosition(putId).assigned);
        assertTrue(core.getPosition(callId).assigned);
        assertEq(core.totalOpenNotional(), 0);
        assertEq(core.makerUsdcReserved(), 0);
        assertEq(core.makerBtcReserved(), 0);
        _assertSolvent();

        core.withdrawMakerUsdc(address(this), core.makerUsdcFree());
        core.withdrawMakerBtc(address(this), core.makerBtcFree());
        assertEq(usdc.balanceOf(address(core)), 0);
        assertEq(btc.balanceOf(address(core)), 0);
    }
}
