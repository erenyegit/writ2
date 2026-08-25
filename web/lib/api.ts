/** Desk endpoints are served by this app's own /api routes (Vercel functions). */

export interface AprRange {
  minPct: number;
  maxPct: number;
}

export interface Market {
  spotUsd: number;
  ivAnnualized: number;
  strikes: number[];
  expiries: number[];
  apr: { put: AprRange | null; call: AprRange | null; refExpiry: number; refTenorDays: number };
}

export interface SignedQuote {
  quote: {
    writer: `0x${string}`;
    maker: `0x${string}`;
    isPut: boolean;
    strike: string;
    qty: string;
    expiry: string;
    premium: string;
    quoteDeadline: string;
    nonce: string;
  };
  signature: `0x${string}`;
  /** Populated by /api/rfq: how many makers answered, and how many were asked. */
  competingBids?: number;
  makersAsked?: number;
  meta: {
    spotUsd: number;
    ivAnnualized: number;
    tenorYears: number;
    fairValueUsd: number;
    deskBidUsd: number;
    premiumUsdc: string;
    collateralUsdc: string;
    collateralAsset: "usdc" | "btc";
    notionalUsdc: string;
    aprPct: number;
    deskSpread: number;
    maker: `0x${string}`;
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
  const res = await fetch(`/api/rfq?${q.toString()}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `quote: ${res.status}`);
  return body;
}
