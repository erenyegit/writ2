/**
 * Settlement data used to be fetched straight from Hermes in the browser.
 * Hermes now requires an API key, and a key the browser can read is a key
 * anyone can read, so the request goes through our own route instead. The
 * shape returned is unchanged.
 */
export async function fetchSettlementUpdate(publishTime: number): Promise<`0x${string}`[]> {
  const res = await fetch(`/api/settlement?expiry=${publishTime}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `settlement data: ${res.status}`);
  return body.updates as `0x${string}`[];
}
