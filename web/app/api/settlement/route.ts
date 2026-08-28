import { NextRequest, NextResponse } from "next/server";

import { fetchSettlementUpdate } from "@/lib/desk/hermes";

export const dynamic = "force-dynamic";

/**
 * Oracle update for one expiry, proxied so the Pyth key stays server-side.
 * GET /api/settlement?expiry=1770000000
 */
export async function GET(req: NextRequest) {
  const expiry = Number(req.nextUrl.searchParams.get("expiry"));
  if (!Number.isInteger(expiry) || expiry <= 0) {
    return NextResponse.json({ error: "expiry must be a unix timestamp" }, { status: 400 });
  }
  try {
    return NextResponse.json({ updates: await fetchSettlementUpdate(expiry) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "settlement data unavailable" },
      { status: 502 },
    );
  }
}
