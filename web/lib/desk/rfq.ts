/**
 * Request for quote.
 *
 * A single desk quoting a single price is a house, not a market: the writer
 * takes what they are given. An RFQ asks every registered maker the same
 * question at the same moment, waits a short window, and shows the writer the
 * best answer that came back. With one maker registered the flow is identical
 * and the writer simply sees one bid, which is the point — nothing here is
 * special-cased for the number of counterparties.
 *
 * A maker is an HTTP endpoint that speaks the same shape as this deployment's
 * own /api/quote. That is the whole integration contract for an external maker.
 */

import { buildSignedQuote, type QuoteRequest } from "./quote";

/** How long the auction stays open. Long enough to cross the network, short
 *  enough that the winning quote is still fresh when the writer signs. */
const WINDOW_MS = Number(process.env.RFQ_WINDOW_MS ?? 2_000);

/** External maker quote endpoints, comma separated. */
const externalMakers = (process.env.MAKER_ENDPOINTS ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

type SignedQuote = Awaited<ReturnType<typeof buildSignedQuote>>;

export interface RfqResult extends SignedQuote {
  /** How many makers answered inside the window, including the winner. */
  competingBids: number;
  /** How many were asked, so a silent maker is visible rather than invisible. */
  makersAsked: number;
}

async function askExternal(url: string, req: QuoteRequest): Promise<SignedQuote | null> {
  const q = new URLSearchParams({
    writer: req.writer,
    isPut: String(req.isPut),
    strike: String(req.strikeUsd),
    qty: String(req.qtyBtc),
    expiry: String(req.expiry),
  });
  const res = await fetch(`${url}?${q}`, { signal: AbortSignal.timeout(WINDOW_MS) });
  if (!res.ok) return null;
  const body = (await res.json()) as SignedQuote | { error: string };
  return "error" in body ? null : body;
}

/**
 * Run the auction and return the best bid, or null if nobody quoted.
 *
 * "Best" is the highest premium: the writer is selling, so more is better. A
 * maker that errors or misses the window is skipped rather than failing the
 * auction — one slow counterparty should not close the market.
 */
export async function requestForQuote(req: QuoteRequest, spot: number): Promise<RfqResult | null> {
  const bids = await Promise.allSettled([
    // This deployment's own book is simply maker #1, asked in-process.
    buildSignedQuote(req, spot),
    ...externalMakers.map((url) => askExternal(url, req)),
  ]);

  const filled = bids
    .filter((b): b is PromiseFulfilledResult<SignedQuote | null> => b.status === "fulfilled")
    .map((b) => b.value)
    .filter((q): q is SignedQuote => q !== null);

  if (filled.length === 0) return null;

  const best = filled.reduce((a, b) =>
    BigInt(b.quote.premium) > BigInt(a.quote.premium) ? b : a,
  );

  return { ...best, competingBids: filled.length, makersAsked: 1 + externalMakers.length };
}
