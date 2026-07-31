/**
 * Black-Scholes pricing for European options (r defaults to 0).
 * All inputs in natural units: S/K/cap in USD, T in years, sigma annualized.
 */

/** Abramowitz & Stegun 7.1.26 approximation, |error| < 1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function bsCall(S: number, K: number, T: number, sigma: number, r = 0): number {
  if (T <= 0) return Math.max(S - K, 0);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / sq;
  const d2 = d1 - sq;
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

export function bsPut(S: number, K: number, T: number, sigma: number, r = 0): number {
  if (T <= 0) return Math.max(K - S, 0);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / sq;
  const d2 = d1 - sq;
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/** A capped call (call spread): long call at K, short call at cap. */
export function bsCappedCall(
  S: number,
  K: number,
  cap: number,
  T: number,
  sigma: number,
  r = 0,
): number {
  return bsCall(S, K, T, sigma, r) - bsCall(S, cap, T, sigma, r);
}
