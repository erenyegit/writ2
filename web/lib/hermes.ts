import { BTC_USD_FEED_ID } from "./addresses";

const HERMES = "https://hermes.pyth.network";

/**
 * Fetch the archived Pyth update for the first tick at/after `publishTime`
 * (Hermes benchmarks). Returned blobs go straight into settle()'s oracleData
 * after abi-encoding as bytes[].
 */
export async function fetchSettlementUpdate(publishTime: number): Promise<`0x${string}`[]> {
  const url = `${HERMES}/v2/updates/price/${publishTime}?ids[]=${BTC_USD_FEED_ID}&encoding=hex`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes benchmark: ${res.status}`);
  const body = (await res.json()) as { binary: { data: string[] } };
  return body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`) as `0x${string}`);
}
