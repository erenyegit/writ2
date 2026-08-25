/**
 * Volatility surface and desk spread.
 *
 * The desk used to price every strike and every tenor off one number. That is
 * wrong in two directions at once: a flat vol overpays wherever the market
 * trades below it, and quotes nothing anyone wants wherever it trades above.
 * Because the writer chooses which side to sell, the error is not symmetric —
 * they only take the side the mispricing favours.
 *
 * This is still a model rather than a market, but it has the two features that
 * matter for BTC: short tenors carry more vol than long ones, and downside
 * strikes carry more vol than upside ones.
 */

const env = (k: string, d: number) => Number(process.env[k] ?? d);

const P = {
  /** ATM vol as tenor goes to zero, and as it goes to infinity. */
  atmShort: env("VOL_ATM_SHORT", 0.65),
  atmLong: env("VOL_ATM_LONG", 0.5),
  /** Decay constant in years: how fast short-dated vol relaxes to the long one. */
  tau: env("VOL_TAU_YEARS", 0.25),
  /** Downside skew: puts below spot price at a higher vol than calls above. */
  skew: env("VOL_SKEW", 0.1),
  /** Smile curvature: both wings above the ATM level. */
  smile: env("VOL_SMILE", 0.03),
  /**
   * Standardized moneyness is clamped before it reaches the skew and smile
   * terms. Dividing by sqrt(T) makes `k` blow up at short tenors, and an
   * unbounded quadratic then returns vols no market has ever printed. Real
   * surfaces flatten in the far wings, so this both matches them and keeps
   * the model from quoting nonsense.
   */
  maxAbsK: env("VOL_MAX_K", 2.5),
  minVol: env("VOL_MIN", 0.2),
  maxVol: env("VOL_MAX", 1.5),
};

/** ATM vol for a tenor, in years. Short-dated sits above long-dated. */
export function atmVol(tenorYears: number): number {
  const t = Math.max(tenorYears, 1 / 365 / 24);
  return P.atmLong + (P.atmShort - P.atmLong) * Math.exp(-t / P.tau);
}

/**
 * Implied vol for one strike and tenor.
 *
 * `k` is log-moneyness standardized by the ATM move over the tenor, so the same
 * skew parameters mean the same thing at one day and at one month. Negative `k`
 * is below spot, which is where the extra vol goes.
 */
export function impliedVol(spot: number, strike: number, tenorYears: number): number {
  const atm = atmVol(tenorYears);
  const t = Math.max(tenorYears, 1 / 365 / 24);
  const raw = Math.log(strike / spot) / (atm * Math.sqrt(t));
  const k = Math.min(P.maxAbsK, Math.max(-P.maxAbsK, raw));
  const vol = atm * (1 - P.skew * k + P.smile * k * k);
  return Math.min(P.maxVol, Math.max(P.minVol, vol));
}

const S = {
  base: env("DESK_SPREAD", 0.1),
  /** Extra edge per year of tenor: longer risk is held longer. */
  perYear: env("SPREAD_PER_YEAR", 0.35),
  /** Extra edge per unit of standardized moneyness, for thin wings. */
  perWing: env("SPREAD_PER_WING", 0.02),
  max: env("SPREAD_MAX", 0.22),
};

/**
 * Fraction below fair value the desk bids. Wider for longer tenors and for
 * far strikes, where the model is least trustworthy and a hedge is hardest.
 */
export function deskSpread(spot: number, strike: number, tenorYears: number): number {
  const t = Math.max(tenorYears, 0);
  const raw = Math.abs(Math.log(strike / spot)) / (atmVol(t) * Math.sqrt(Math.max(t, 1 / 365)));
  const k = Math.min(P.maxAbsK, raw);
  return Math.min(S.max, S.base + S.perYear * t + S.perWing * k);
}
