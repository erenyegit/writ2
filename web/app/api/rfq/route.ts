import { NextRequest, NextResponse } from "next/server";

import { fetchSpot } from "@/lib/desk/hermes";
import { requestForQuote } from "@/lib/desk/rfq";

export const dynamic = "force-dynamic";

/**
 * Ask every registered maker for a price and return the best one.
 * GET /api/rfq?writer=0x..&isPut=true&strike=65000&qty=0.1&expiry=1770000000
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const writer = sp.get("writer") as `0x${string}` | null;
    if (!writer || !/^0x[0-9a-fA-F]{40}$/.test(writer)) {
      return NextResponse.json({ error: "invalid writer address" }, { status: 400 });
    }
    const isPut = sp.get("isPut") === "true";
    const strikeUsd = Number(sp.get("strike"));
    const qtyBtc = Number(sp.get("qty"));
    const expiry = Number(sp.get("expiry"));
    if (!Number.isFinite(strikeUsd) || !Number.isFinite(qtyBtc) || !Number.isInteger(expiry)) {
      return NextResponse.json(
        { error: "strike, qty, expiry are required numbers" },
        { status: 400 },
      );
    }

    const spot = await fetchSpot();
    const best = await requestForQuote({ writer, isPut, strikeUsd, qtyBtc, expiry }, spot);
    if (!best) return NextResponse.json({ error: "no maker quoted this" }, { status: 503 });
    return NextResponse.json(best);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "rfq failed" },
      { status: 400 },
    );
  }
}
