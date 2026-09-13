import { deskConfig, hermesHeaders } from "./config";

// Spot lives in price.ts, which falls back to other sources. What stays here has
// no substitute: the signed update the contract verifies at settlement.

/**
 * The archived update for the first tick at or after `publishTime`, hex encoded.
 * Goes straight into settle()'s oracleData after abi-encoding as bytes[].
 */
export async function fetchSettlementUpdate(publishTime: number): Promise<`0x${string}`[]> {
  const url =
    `${deskConfig.hermesUrl}/v2/updates/price/${publishTime}` +
    `?ids[]=${deskConfig.btcFeedId}&encoding=hex`;
  const res = await fetch(url, { cache: "no-store", headers: hermesHeaders() });
  if (res.status === 401 || res.status === 403) {
    // Say what actually broke. "Hermes 403" sent us hunting in the wrong place.
    throw new Error("oracle data provider rejected the Pyth API key — renew PYTH_API_KEY");
  }
  if (!res.ok) throw new Error(`Hermes benchmark ${res.status}`);
  const body = (await res.json()) as { binary: { data: string[] } };
  return body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`) as `0x${string}`);
}
