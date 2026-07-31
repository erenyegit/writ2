// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {TestUSDC} from "../src/TestUSDC.sol";

contract TestUSDCTest is Test {
    TestUSDC usdc;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        usdc = new TestUSDC();
    }

    function test_MirrorsUsdcPrecision() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.symbol(), "USDC");
    }

    function test_FirstClaimSucceeds() public {
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT());
    }

    function test_SecondClaimRevertsDuringCooldown() public {
        vm.prank(alice);
        usdc.faucet();

        vm.warp(block.timestamp + usdc.FAUCET_INTERVAL() - 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                TestUSDC.FaucetCooldown.selector, block.timestamp + 1
            )
        );
        usdc.faucet();
    }

    function test_ClaimAgainAfterCooldown() public {
        vm.prank(alice);
        usdc.faucet();

        vm.warp(block.timestamp + usdc.FAUCET_INTERVAL());
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT() * 2);
    }

    function test_CooldownIsPerAddress() public {
        vm.prank(alice);
        usdc.faucet();

        // bob is unaffected by alice's claim
        vm.prank(bob);
        usdc.faucet();
        assertEq(usdc.balanceOf(bob), usdc.FAUCET_AMOUNT());
    }

    function test_FaucetCooldownView() public {
        assertEq(usdc.faucetCooldown(alice), 0, "claimable before first claim");

        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.faucetCooldown(alice), usdc.FAUCET_INTERVAL());

        vm.warp(block.timestamp + usdc.FAUCET_INTERVAL() / 2);
        assertEq(usdc.faucetCooldown(alice), usdc.FAUCET_INTERVAL() / 2);

        vm.warp(block.timestamp + usdc.FAUCET_INTERVAL());
        assertEq(usdc.faucetCooldown(alice), 0, "claimable again");
    }

    function testFuzz_ClaimIsAlwaysFixedSize(address user) public {
        vm.assume(user != address(0));
        vm.prank(user);
        usdc.faucet();
        assertEq(usdc.balanceOf(user), usdc.FAUCET_AMOUNT());
    }
}
