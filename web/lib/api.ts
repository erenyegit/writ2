/** Desk endpoints are served by this app's own /api routes (Vercel functions). */

export interface Market {
  spotUsd: number;
  ivAnnualized: number;
  strikes: number[];
  expiries: number[];
}

export interface SignedQuote {
  quote: {
    writer: `0x${string}`;
    isPut: boolean;
    strike: string;
    cap: string;
    qty: string;
    expiry: string;
    premium: string;
    quoteDeadline: string;
    nonce: string;
  };
  signature: `0x${string}`;
  meta: {
    spotUsd: number;
    ivAnnualized: number;
    tenorYears: number;
    fairValueUsd: number;
    deskBidUsd: number;
    premiumUsdc: string;
    collateralUsdc: string;
    quoter: `0x${string}`;
  };
}

export async function getMarket(): Promise<Market> {
  const res = await fetch(`/api/market`);
  if (!res.ok) throw new Error(`market: ${res.status}`);
  return res.json();
}

export async function getQuote(params: {
  writer: `0x${string}`;
  isPut: boolean;
  strike: number;
  cap?: number;
  qty: number;
  expiry: number;
}): Promise<SignedQuote> {
  const q = new URLSearchParams({
    writer: params.writer,
    isPut: String(params.isPut),
    strike: String(params.strike),
    qty: String(params.qty),
    expiry: String(params.expiry),
  });
  if (params.cap !== undefined) q.set("cap", String(params.cap));
  const res = await fetch(`/api/quote?${q.toString()}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `quote: ${res.status}`);
  return body;
}
