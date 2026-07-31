/** Desk configuration, entirely env-driven. See .env.example. */

const DEV_QUOTER_KEY =
  // Well-known anvil dev key #0 — NEVER use outside local development.
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  chainId: Number(process.env.CHAIN_ID ?? 91342),
  coreAddress: (process.env.CORE_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as `0x${string}`,
  quoterPrivateKey: (process.env.QUOTER_PRIVATE_KEY ?? DEV_QUOTER_KEY) as `0x${string}`,
  btcFeedId:
    process.env.BTC_USD_FEED_ID ??
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  hermesUrl: process.env.HERMES_URL ?? "https://hermes.pyth.network",
  /** Annualized implied volatility used for quoting (MVP: static, env-tunable). */
  iv: Number(process.env.IV_DEFAULT ?? 0.55),
  /** Desk buys below fair value by this fraction (desk edge). */
  spread: Number(process.env.DESK_SPREAD ?? 0.1),
  riskFreeRate: Number(process.env.RISK_FREE ?? 0),
  /** Quotes are valid for this many seconds after issuance. */
  quoteTtlSec: Number(process.env.QUOTE_TTL_SEC ?? 20),
};

if (!process.env.QUOTER_PRIVATE_KEY) {
  console.warn("[pricing] QUOTER_PRIVATE_KEY not set — using the anvil dev key (dev only!)");
}
if (!process.env.CORE_ADDRESS) {
  console.warn("[pricing] CORE_ADDRESS not set — signatures will not verify on-chain");
}
