import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { config } from "./config.js";
import { fetchSpot } from "./hermes.js";
import { buildSignedQuote, quoterAddress } from "./quote.js";

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, quoter: quoterAddress, chainId: config.chainId }));

/** Market snapshot: spot, IV, a strike ladder, and the next daily expiries. */
app.get("/market", async (c) => {
  const spot = await fetchSpot();

  const strikes: number[] = [];
  for (let i = -4; i <= 4; i++) {
    const raw = spot * (1 + 0.025 * i);
    const rounded = Math.max(500, Math.round(raw / 500) * 500);
    if (!strikes.includes(rounded)) strikes.push(rounded);
  }

  const expiries: number[] = [];
  const now = Math.floor(Date.now() / 1000);
  const d = new Date();
  d.setUTCHours(8, 0, 0, 0);
  for (let i = 0; i < 8 && expiries.length < 7; i++) {
    const t = Math.floor(d.getTime() / 1000) + i * 86400;
    if (t >= now + 3600) expiries.push(t); // respect min tenor with margin
  }

  return c.json({ spotUsd: spot, ivAnnualized: config.iv, strikes, expiries });
});

/**
 * Signed desk quote.
 * GET /quote?writer=0x..&isPut=true&strike=65000&qty=0.1&expiry=1770000000[&cap=75000]
 */
app.get("/quote", async (c) => {
  try {
    const writer = c.req.query("writer") as `0x${string}` | undefined;
    if (!writer || !/^0x[0-9a-fA-F]{40}$/.test(writer)) {
      return c.json({ error: "invalid writer address" }, 400);
    }
    const isPut = c.req.query("isPut") === "true";
    const strikeUsd = Number(c.req.query("strike"));
    const qtyBtc = Number(c.req.query("qty"));
    const expiry = Number(c.req.query("expiry"));
    const capRaw = c.req.query("cap");
    const capUsd = capRaw !== undefined ? Number(capRaw) : undefined;
    if (!Number.isFinite(strikeUsd) || !Number.isFinite(qtyBtc) || !Number.isInteger(expiry)) {
      return c.json({ error: "strike, qty, expiry are required numbers" }, 400);
    }

    const spot = await fetchSpot();
    const result = await buildSignedQuote({ writer, isPut, strikeUsd, capUsd, qtyBtc, expiry }, spot);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "quote failed" }, 400);
  }
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[pricing] Writ desk quoting on :${info.port} (signer ${quoterAddress})`);
});
