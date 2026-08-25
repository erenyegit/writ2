import { NextResponse } from "next/server";

import { bsCappedCall, bsPut } from "@/lib/desk/bs";
import { atmVol, deskSpread, impliedVol } from "@/lib/desk/surface";
import { fetchSpot } from "@/lib/desk/hermes";

export const dynamic = "force-dynamic";

/** Headline rates are quoted at this tenor. */
const REF_TENOR_SEC = 7 * 86400;

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

    // Quote the surface at the nearest expiry, so the headline IV matches
    // what a writer is actually shown first.
    const nearestTenorYears = expiries.length ? (expiries[0] - now) / (365 * 86400) : 1 / 365;

    // The rate a writer can actually get today, per strategy. Rysk leads with
    // this because a premium alone is not comparable across strikes or tenors.
    const aprAt = (strike: number, T: number, isPut: boolean) => {
      const iv = impliedVol(spot, strike, T);
      const collateralPerBtc = isPut ? strike : (strike * 1.05 - strike);
      const fair = isPut
        ? bsPut(spot, strike, T, iv)
        : bsCappedCall(spot, strike, strike * 1.05, T, iv, impliedVol(spot, strike * 1.05, T));
      const bid = fair * (1 - deskSpread(spot, strike, T));
      return (bid / collateralPerBtc / T) * 100;
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
