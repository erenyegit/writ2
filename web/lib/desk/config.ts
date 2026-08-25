/** Server-side desk configuration (route handlers only — never import client-side). */

const DEV_QUOTER_KEY =
  // Well-known anvil dev key #0 — NEVER use outside local development.
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Resolve the quote signer.
 *
 * A missing or malformed key used to fall back to the anvil dev key in every
 * environment. That is fine locally and dangerous in production: the fallback
 * is a published key, so a dropped env var would have the desk handing out
 * quotes anyone could forge. In production a bad key is now a hard failure.
 *
 * Deliberately a function rather than an eager value: Next collects route
 * metadata at build time, and a build should not need the secret to succeed.
 */
export function resolveQuoterKey(): `0x${string}` {
  // Read at call time, not at module load: capturing it once means the guard
  // depends on import order, which is exactly the kind of thing that silently
  // stops protecting you.
  const isProd = process.env.NODE_ENV === "production";
  const raw = process.env.QUOTER_PRIVATE_KEY;

  if (!raw) {
    if (isProd) throw new Error("QUOTER_PRIVATE_KEY is required in production");
    console.warn("[desk] QUOTER_PRIVATE_KEY unset — using the local dev key");
    return DEV_QUOTER_KEY as `0x${string}`;
  }

  // Accept the key however it survived a dashboard env field: stray
  // whitespace, wrapping quotes, or a missing 0x prefix.
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
  const hex = cleaned.startsWith("0x") ? cleaned.slice(2) : cleaned;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    if (isProd) throw new Error("QUOTER_PRIVATE_KEY is not 32 bytes of hex");
    console.error("[desk] QUOTER_PRIVATE_KEY is not 32 bytes of hex — using the dev key");
    return DEV_QUOTER_KEY as `0x${string}`;
  }
  return `0x${hex}` as `0x${string}`;
}

/** True when the desk is signing with the published dev key. */
export const usingDevKey = () => resolveQuoterKey() === DEV_QUOTER_KEY;

export const deskConfig = {
  chainId: Number(process.env.CHAIN_ID ?? 91342),
  coreAddress: (process.env.CORE_ADDRESS ??
    process.env.NEXT_PUBLIC_CORE_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as `0x${string}`,
  /** Lazy: reading this throws in production when the key is missing. */
  get quoterPrivateKey(): `0x${string}` {
    return resolveQuoterKey();
  },
  btcFeedId:
    process.env.BTC_USD_FEED_ID ??
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  hermesUrl: process.env.HERMES_URL ?? "https://hermes.pyth.network",
  /** Desk buys below fair value by at least this fraction (see surface.ts). */
  spread: Number(process.env.DESK_SPREAD ?? 0.1),
  riskFreeRate: Number(process.env.RISK_FREE ?? 0),
  /** Short-lived quotes: GIWA preconfirms in ~200ms, so the desk only
   * needs a 20s window instead of 60s — less stale-price risk priced in. */
  quoteTtlSec: Number(process.env.QUOTE_TTL_SEC ?? 20),
  /**
   * The maker account this desk instance quotes for. Its signer is
   * QUOTER_PRIVATE_KEY; the contract checks the pair, so a misconfigured maker
   * simply cannot write rather than writing against someone else's book.
   */
  makerAddress: (process.env.MAKER_ADDRESS ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`,
  /** Warn when free maker liquidity drops below this (USDC, 1e6). */
  lowLiquidityUsdc: BigInt(process.env.LOW_LIQUIDITY_USDC ?? 100_000_000),
};
