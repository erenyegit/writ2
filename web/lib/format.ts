export const fmtUsd = (v: number, digits = 2) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });

/** USDC amount scaled 1e6 -> "$1,234.56". */
export const fmtUsdc = (v: bigint) => fmtUsd(Number(v) / 1e6);

/** Price scaled 1e8 -> "$65,000". */
export const fmtPrice8 = (v: bigint) => fmtUsd(Number(v) / 1e8, 0);

/** Quantity scaled 1e8 -> "0.1 BTC". */
export const fmtQty8 = (v: bigint) => `${Number(v) / 1e8} BTC`;

export const fmtTs = (ts: number | bigint) =>
  new Date(Number(ts) * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }) + " UTC";

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
