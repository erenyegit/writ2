// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {TestBTC} from "../src/TestBTC.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {WritOptions} from "../src/WritOptions.sol";
import {PythAdapter} from "../src/adapters/PythAdapter.sol";

/// @notice Deploys the desk to GIWA Sepolia.
///
/// GIWA has neither a canonical stablecoin nor a wrapped BTC, so this also
/// deploys both faucet-backed testnet assets. Settlement is physical, so the
/// desk needs inventory in both: cash to buy a covered call away, and the
/// underlying to deliver into an assigned put. Pyth is already live at the same
/// address it uses on other chains, so the adapter needs no changes.
///
/// Env:
///   DEPLOYER_PRIVATE_KEY  deployer key (fund via https://faucet.lambda256.io/giwa-sepolia)
///   PYTH_ADDRESS          0x2880aB155794e7179c9eE2e38200202908C17B43 (GIWA Sepolia)
///   BTC_USD_FEED_ID       0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
///   QUOTE_SIGNER          address that signs the first maker's quotes
///
/// Run:
///   forge script script/Deploy.s.sol --rpc-url giwa_sepolia --broadcast
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address pythAddr = vm.envAddress("PYTH_ADDRESS");
        bytes32 feedId = vm.envBytes32("BTC_USD_FEED_ID");
        address quoteSigner = vm.envAddress("QUOTE_SIGNER");
        // Broadcast runs as this address; `msg.sender` here is the script caller.
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        TestUSDC usdc = new TestUSDC();
        TestBTC btc = new TestBTC();
        PythAdapter adapter = new PythAdapter(pythAddr, feedId);
        WritOptions core = new WritOptions(address(usdc), address(btc), address(adapter));

        // The deployer is the first maker. Nothing about the code path is
        // special to it: registering a second maker is the same three calls.
        core.registerMaker(deployer, quoteSigner);

        // Seed both sides: without inventory a maker cannot back either product.
        usdc.faucet();
        btc.faucet();
        usdc.approve(address(core), type(uint256).max);
        btc.approve(address(core), type(uint256).max);
        core.depositMakerUsdc(usdc.balanceOf(deployer));
        core.depositMakerBtc(btc.balanceOf(deployer));
        vm.stopBroadcast();

        console2.log("TestUSDC:    ", address(usdc));
        console2.log("TestBTC:     ", address(btc));
        console2.log("PythAdapter: ", address(adapter));
        console2.log("WritOptions: ", address(core));
    }
}
