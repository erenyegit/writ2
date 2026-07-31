import { defineChain } from "viem";

/**
 * GIWA Sepolia — Upbit's OP Stack L2.
 *
 * Reads and writes go through the Flashblocks endpoint, which preconfirms
 * transactions in ~200ms instead of waiting the full ~1s block. That latency
 * is what lets the desk sign short-lived quotes (see QUOTE_TTL_SEC): the
 * shorter a quote lives, the less stale-price risk the desk prices in, and
 * the more premium the writer keeps.
 */
export const giwaSepolia = defineChain({
  id: 91342,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia-rpc-flashblocks.giwa.io"] },
    // Standard endpoint, kept for tooling that does not expect preconfirmations.
    standard: { http: ["https://sepolia-rpc.giwa.io"] },
  },
  blockExplorers: {
    default: { name: "GIWA Explorer", url: "https://sepolia-explorer.giwa.io" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});
