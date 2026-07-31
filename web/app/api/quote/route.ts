import { NextRequest, NextResponse } from "next/server";

import { fetchSpot } from "@/lib/desk/hermes";
import { buildSignedQuote } from "@/lib/desk/quote";

export const dynamic = "force-dynamic";

/**
 * Signed desk quote.
 * GET /api/quote?writer=0x..&isPut=true&strike=65000&qty=0.1&expiry=1770000000[&cap=75000]
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
    const capRaw = sp.get("cap");
    const capUsd = capRaw !== null ? Number(capRaw) : undefined;
    if (!Number.isFinite(strikeUsd) || !Number.isFinite(qtyBtc) || !Number.isInteger(expiry)) {
      return NextResponse.json(
        { error: "strike, qty, expiry are required numbers" },
        { status: 400 },
      );
    }

    const spot = await fetchSpot();
    const result = await buildSignedQuote(
      { writer, isPut, strikeUsd, capUsd, qtyBtc, expiry },
      spot,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "quote failed" },
      { status: 400 },
    );
  }
}
