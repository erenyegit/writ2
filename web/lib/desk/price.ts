/**
 * BTC/USD spot, from whichever source answers first.
 *
 * The homepage price and every quote used to depend on one provider behind one
 * paid key. When that key lapsed the site did not degrade, it stopped: the price
 * never arrived and the page waited on it forever. Spot is now a chain of
 * sources tried in order, so one provider going away costs a few basis points of
 * reference accuracy rather than the whole product.
 *
 * This is only for display and off-chain quoting. Settlement never reads it:
 * the contract takes its price from a signed Pyth update, which has no keyless
 * substitute. A maker quoting off Coinbase instead of Pyth is exposed to the
 * gap between the two, which for BTC/USD is a few basis points.
 */

import { deskConfig, hermesHeaders } from "./config";

export type SpotSource = "pyth" | "coinbase" | "kraken";

export interface Spot {
  usd: number;
  source: SpotSource;
  /** Unix ms when this price was fetched. */
  at: number;
}

/** Per source. Long enough to cross the network, short enough that falling
 *  back to the next one still answers inside a page load. */
const TIMEOUT_MS = 2_500;
/** Polling clients and several routes ask at once; one fetch serves them. */
const CACHE_MS = 5_000;

let cached: Spot | null = null;
/** Last reason Pyth was skipped, so a dead key shows up in /api/health. */
let pythError: string | null = null;

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

async function fromPyth(): Promise<number> {
  const body = (await getJson(
    `${deskConfig.hermesUrl}/v2/updates/price/latest?ids[]=${deskConfig.btcFeedId}`,
    hermesHeaders(),
  )) as { parsed?: { price: { price: string; expo: number } }[] };
  const p = body.parsed?.[0]?.price;
  if (!p) throw new Error("pyth: empty price");
  return Number(p.price) * 10 ** p.expo;
}

async function fromCoinbase(): Promise<number> {
  const body = (await getJson("https://api.coinbase.com/v2/prices/BTC-USD/spot")) as {
    data?: { amount?: string };
  };
  return Number(body.data?.amount);
}

async function fromKraken(): Promise<number> {
  const body = (await getJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD")) as {
    error?: string[];
    result?: Record<string, { c?: [string, string] }>;
  };
  if (body.error?.length) throw new Error(`kraken: ${body.error.join(", ")}`);
  const pair = body.result && Object.values(body.result)[0];
  return Number(pair?.c?.[0]);
}

/** A price outside this band is a broken response, not a market move. */
const plausible = (usd: number) => Number.isFinite(usd) && usd > 1_000 && usd < 10_000_000;

export async function getSpot(): Promise<Spot> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;

  const sources: [SpotSource, () => Promise<number>][] = [
    // Pyth first when we have a key: it is the same feed settlement reads.
    ...(deskConfig.pythApiKey ? ([["pyth", fromPyth]] as [SpotSource, () => Promise<number>][]) : []),
    ["coinbase", fromCoinbase],
    ["kraken", fromKraken],
  ];

  const failures: string[] = [];
  for (const [source, read] of sources) {
    try {
      const usd = await read();
      if (!plausible(usd)) throw new Error(`${source}: implausible price ${usd}`);
      if (source === "pyth") pythError = null;
      cached = { usd, source, at: Date.now() };
      return cached;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (source === "pyth") pythError = reason;
      failures.push(reason);
    }
  }
  throw new Error(`no price source answered (${failures.join("; ")})`);
}

/** Kept for existing callers that only need the number. */
export const fetchSpot = async () => (await getSpot()).usd;

/** Null when Pyth answered last time, or when there is no key to try. */
export const pythSpotError = () => (deskConfig.pythApiKey ? pythError : "PYTH_API_KEY not set");
