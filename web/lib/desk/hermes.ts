import { deskConfig } from "./config";

interface HermesParsedPrice {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
}

interface HermesLatestResponse {
  parsed: HermesParsedPrice[];
}

/** Fetch BTC/USD spot (USD, float) from Pyth's Hermes endpoint. */
export async function fetchSpot(): Promise<number> {
  const url = `${deskConfig.hermesUrl}/v2/updates/price/latest?ids[]=${deskConfig.btcFeedId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const body = (await res.json()) as HermesLatestResponse;
  const p = body.parsed?.[0]?.price;
  if (!p) throw new Error("Hermes: empty price");
  return Number(p.price) * 10 ** p.expo;
}
