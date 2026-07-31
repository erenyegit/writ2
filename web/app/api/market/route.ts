import { NextResponse } from "next/server";

import { deskConfig } from "@/lib/desk/config";
import { fetchSpot } from "@/lib/desk/hermes";

export const dynamic = "force-dynamic";

/** Market snapshot: spot, IV, a strike ladder, and the next daily expiries. */
export async function GET() {
  try {
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

    return NextResponse.json({ spotUsd: spot, ivAnnualized: deskConfig.iv, strikes, expiries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "market failed" },
      { status: 502 },
    );
  }
}
