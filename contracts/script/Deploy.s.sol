// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {TestUSDC} from "../src/TestUSDC.sol";
import {WritOptions} from "../src/WritOptions.sol";
import {PythAdapter} from "../src/adapters/PythAdapter.sol";

/// @notice Deploys the desk to GIWA Sepolia.
///
/// GIWA has no canonical stablecoin, so this also deploys the faucet-backed
/// TestUSDC used as the settlement asset on testnet. Pyth is already live at
/// the same address it uses on other chains, so the adapter needs no changes.
///
/// Env:
///   DEPLOYER_PRIVATE_KEY  deployer key (fund via https://faucet.lambda256.io/giwa-sepolia)
///   PYTH_ADDRESS          0x2880aB155794e7179c9eE2e38200202908C17B43 (GIWA Sepolia)
///   BTC_USD_FEED_ID       0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
///   QUOTE_SIGNER          address of the pricing service's signer key
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
        PythAdapter adapter = new PythAdapter(pythAddr, feedId);
        WritOptions core = new WritOptions(address(usdc), address(adapter), quoteSigner);

        // Seed the desk so it can pay premiums from the first trade.
        usdc.faucet();
        usdc.approve(address(core), type(uint256).max);
        core.depositDesk(usdc.balanceOf(deployer));
        vm.stopBroadcast();

        console2.log("TestUSDC:    ", address(usdc));
        console2.log("PythAdapter: ", address(adapter));
        console2.log("WritOptions: ", address(core));
    }
}
