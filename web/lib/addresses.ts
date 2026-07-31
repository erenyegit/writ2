export const CORE_ADDRESS = (process.env.NEXT_PUBLIC_CORE_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** Settlement token. GIWA has no canonical stablecoin, so testnet uses our
 *  faucet-backed TestUSDC (6 decimals, same as USDC). */
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

/** Pyth is deployed at the same address GIWA shares with other chains. */
export const PYTH_ADDRESS = (process.env.NEXT_PUBLIC_PYTH_ADDRESS ??
  "0x2880aB155794e7179c9eE2e38200202908C17B43") as `0x${string}`;

export const BTC_USD_FEED_ID = (process.env.NEXT_PUBLIC_BTC_USD_FEED_ID ??
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43") as `0x${string}`;

export const EXPLORER_URL = "https://sepolia-explorer.giwa.io";

/** Where users top up gas for the demo. */
export const GAS_FAUCET_URL = "https://faucet.lambda256.io/giwa-sepolia";

export const isConfigured = () =>
  CORE_ADDRESS !== "0x0000000000000000000000000000000000000000";

export const isTokenConfigured = () =>
  USDC_ADDRESS !== "0x0000000000000000000000000000000000000000";
