/** Server-side desk configuration (route handlers only — never import client-side). */

const DEV_QUOTER_KEY =
  // Well-known anvil dev key #0 — NEVER use outside local development.
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Accept the key however it survived the journey through a dashboard env field:
 * stray whitespace, wrapping quotes, or a missing 0x prefix. Anything that is
 * still not 32 bytes of hex falls back to the dev key, so a mistyped secret
 * degrades to "quotes won't verify on-chain" instead of breaking the build.
 */
function normalizeKey(raw: string | undefined): `0x${string}` {
  if (!raw) return DEV_QUOTER_KEY as `0x${string}`;
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
  const hex = cleaned.startsWith("0x") ? cleaned.slice(2) : cleaned;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    console.error("[desk] QUOTER_PRIVATE_KEY is not 32 bytes of hex — using the dev key");
    return DEV_QUOTER_KEY as `0x${string}`;
  }
  return `0x${hex}` as `0x${string}`;
}

export const deskConfig = {
  chainId: Number(process.env.CHAIN_ID ?? 91342),
  coreAddress: (process.env.CORE_ADDRESS ??
    process.env.NEXT_PUBLIC_CORE_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as `0x${string}`,
  quoterPrivateKey: normalizeKey(process.env.QUOTER_PRIVATE_KEY),
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
  /** Short-lived quotes: GIWA preconfirms in ~200ms, so the desk only
   * needs a 20s window instead of 60s — less stale-price risk priced in. */
  quoteTtlSec: Number(process.env.QUOTE_TTL_SEC ?? 20),
};
