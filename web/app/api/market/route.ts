import { NextResponse } from "next/server";

import { bsCall, bsPut } from "@/lib/desk/bs";
import { atmVol, deskSpread, impliedVol } from "@/lib/desk/surface";
import { getSpot } from "@/lib/desk/price";

export const dynamic = "force-dynamic";

/** Headline rates are quoted at this tenor. */
const REF_TENOR_SEC = 7 * 86400;

/** Market snapshot: spot, IV, a strike ladder, and the next daily expiries. */
export async function GET() {
  try {
    const { usd: spot, source: spotSource } = await getSpot();

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

    // Quote the surface at the nearest expiry, so the headline IV matches
    // what a writer is actually shown first.
    const nearestTenorYears = expiries.length ? (expiries[0] - now) / (365 * 86400) : 1 / 365;

    // The rate a writer can actually get today, per strategy. Rysk leads with
    // this because a premium alone is not comparable across strikes or tenors.
    const aprAt = (strike: number, T: number, isPut: boolean) => {
      const iv = impliedVol(spot, strike, T);
      const fair = isPut ? bsPut(spot, strike, T, iv) : bsCall(spot, strike, T, iv);
      const bid = fair * (1 - deskSpread(spot, strike, T));
      // Both products commit full notional: a put locks the strike in cash, a
      // covered call locks one unit of the underlying. So the rates compare.
      const committedPerBtc = isPut ? strike : spot;
      return (bid / committedPerBtc / T) * 100;
    };

    // Quoted at one reference tenor rather than across all of them. Annualizing
    // a one-day premium is arithmetically fine and useless as a headline: it
    // dominates the range and tells a writer nothing about what they can hold.
    const refExpiry = expiries.reduce(
      (best, e) => (Math.abs(e - now - REF_TENOR_SEC) < Math.abs(best - now - REF_TENOR_SEC) ? e : best),
      expiries[0] ?? now + REF_TENOR_SEC,
    );
    const refTenorYears = (refExpiry - now) / (365 * 86400);

    const aprRange = (isPut: boolean) => {
      const side = strikes.filter((k) => (isPut ? k <= spot : k >= spot));
      const rates = side.map((k) => aprAt(k, refTenorYears, isPut));
      if (!rates.length) return null;
      return { minPct: Math.min(...rates), maxPct: Math.max(...rates) };
    };

    return NextResponse.json({
      spotUsd: spot,
      spotSource,
      ivAnnualized: atmVol(nearestTenorYears),
      strikes,
      expiries,
      apr: { put: aprRange(true), call: aprRange(false), refExpiry, refTenorDays: 7 },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "market failed" },
      { status: 502 },
    );
  }
}
