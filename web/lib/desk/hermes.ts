import { deskConfig, hermesHeaders } from "./config";

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
  const res = await fetch(url, { cache: "no-store", headers: hermesHeaders() });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const body = (await res.json()) as HermesLatestResponse;
  const p = body.parsed?.[0]?.price;
  if (!p) throw new Error("Hermes: empty price");
  return Number(p.price) * 10 ** p.expo;
}

/**
 * The archived update for the first tick at or after `publishTime`, hex encoded.
 * Goes straight into settle()'s oracleData after abi-encoding as bytes[].
 */
export async function fetchSettlementUpdate(publishTime: number): Promise<`0x${string}`[]> {
  const url =
    `${deskConfig.hermesUrl}/v2/updates/price/${publishTime}` +
    `?ids[]=${deskConfig.btcFeedId}&encoding=hex`;
  const res = await fetch(url, { cache: "no-store", headers: hermesHeaders() });
  if (!res.ok) throw new Error(`Hermes benchmark ${res.status}`);
  const body = (await res.json()) as { binary: { data: string[] } };
  return body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`) as `0x${string}`);
}
