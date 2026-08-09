/**
 * odds.js — sportsbook price math.
 *
 * Everything here is pure and unit-tested by inspection: no React, no data.
 * American odds are the canonical format; decimal is used internally for
 * payout math because it multiplies cleanly across parlay legs.
 */

/* ---------- Format conversion ---------- */

export const americanToDecimal = (a) =>
  a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a)

export const decimalToAmerican = (d) =>
  d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1))

/** Raw implied probability, vig included. */
export const impliedProb = (american) =>
  american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100)

/** Fair price for a true probability, no vig. */
export const probToAmerican = (p) => {
  if (p <= 0) return 100000
  if (p >= 1) return -100000
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p)
}

/* ---------- Vig removal ---------- */

/**
 * Strip the bookmaker margin from a set of prices on the same market.
 *
 * multiplicative — normalise so probabilities sum to 1. Fast, standard,
 *                  but overstates the favourite's true chance.
 * additive       — subtract the margin equally across outcomes.
 * power          — solve k where Σ pᵢ^k = 1. Handles longshot bias better.
 * shin           — models the book's insider-trading risk. Closest to
 *                  closing-line truth on two-way markets.
 *
 * @param {number[]} americanPrices
 * @param {'multiplicative'|'additive'|'power'|'shin'} method
 * @returns {{ probs: number[], hold: number }}
 */
export function devig(americanPrices, method = 'multiplicative') {
  const raw = americanPrices.map(impliedProb)
  const overround = raw.reduce((a, b) => a + b, 0)
  const hold = overround - 1
  const n = raw.length

  let probs
  if (method === 'additive') {
    probs = raw.map((p) => p - hold / n)
  } else if (method === 'power') {
    const k = bisect((x) => raw.reduce((s, p) => s + Math.pow(p, x), 0) - 1, 0.5, 3)
    probs = raw.map((p) => Math.pow(p, k))
  } else if (method === 'shin') {
    const z = bisect((zz) => shinSum(raw, overround, zz) - 1, 0, 0.4)
    probs = raw.map((p) => shinProb(p, overround, z))
  } else {
    probs = raw.map((p) => p / overround)
  }

  // Guard against pathological inputs; always return a valid distribution.
  const total = probs.reduce((a, b) => a + b, 0)
  probs = probs.map((p) => clamp(p / total, 1e-6, 1 - 1e-6))
  return { probs, hold }
}

const shinProb = (pi, sum, z) =>
  (Math.sqrt(z * z + 4 * (1 - z) * ((pi * pi) / sum)) - z) / (2 * (1 - z))

const shinSum = (raw, sum, z) => raw.reduce((s, pi) => s + shinProb(pi, sum, z), 0)

/** Monotone bisection. Returns lo if the root is not bracketed. */
function bisect(f, lo, hi, iters = 60) {
  let a = lo
  let b = hi
  const fa = f(a)
  const fb = f(b)
  if (fa * fb > 0) return Math.abs(fa) < Math.abs(fb) ? a : b
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2
    if (f(a) * f(m) <= 0) b = m
    else a = m
  }
  return (a + b) / 2
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/* ---------- Wager evaluation ---------- */

/**
 * Expected value per unit staked.
 * @param {number} pWin  probability the bet wins
 * @param {number} american price
 * @param {number} pPush probability of a push (stake returned)
 */
export function expectedValue(pWin, american, pPush = 0) {
  const b = americanToDecimal(american) - 1
  const pLose = Math.max(0, 1 - pWin - pPush)
  return pWin * b - pLose
}

/**
 * Kelly stake as a fraction of bankroll. Returns 0 when there is no edge —
 * a negative Kelly means "bet the other side", never "bet less than nothing".
 */
export function kelly(pWin, american, pPush = 0, fraction = 1) {
  const b = americanToDecimal(american) - 1
  const pLose = Math.max(0, 1 - pWin - pPush)
  const f = (pWin * b - pLose) / b
  return Math.max(0, f * fraction)
}

/** Combine legs into a parlay price. Assumes independence. */
export function parlayPrice(americanLegs) {
  const dec = americanLegs.reduce((d, a) => d * americanToDecimal(a), 1)
  return { decimal: dec, american: decimalToAmerican(dec) }
}

/** Payout on a winning wager, stake included. */
export const payout = (stake, american) => stake * americanToDecimal(american)

/**
 * Closing line value: how much better your price was than the close,
 * expressed in probability points.
 */
export const clv = (betPrice, closePrice) =>
  impliedProb(closePrice) - impliedProb(betPrice)

/* ---------- Score distributions ---------- */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf). */
export function normalCdf(x, mu = 0, sigma = 1) {
  const z = (x - mu) / (sigma * Math.SQRT2)
  return 0.5 * (1 + erf(z))
}

function erf(x) {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a)
  return s * y
}

/**
 * Approximate probability that an NFL game lands on an exact margin.
 * NFL scoring is lumpy — 3 and 7 carry far more mass than a normal curve
 * implies, which is why whole-number spreads are priced differently from
 * half-points. Values are rounded historical frequencies.
 */
const PUSH_MASS = {
  0: 0.005, 1: 0.021, 2: 0.014, 3: 0.094, 4: 0.050, 5: 0.024,
  6: 0.055, 7: 0.073, 8: 0.026, 9: 0.020, 10: 0.046, 11: 0.025,
  12: 0.015, 13: 0.022, 14: 0.034, 15: 0.014, 16: 0.017, 17: 0.023,
  18: 0.011, 19: 0.010, 20: 0.014, 21: 0.015, 22: 0.008, 23: 0.008,
  24: 0.012, 25: 0.006, 27: 0.007, 28: 0.007
}

export const pushProbability = (line) =>
  Number.isInteger(line) ? PUSH_MASS[Math.abs(line)] ?? 0.004 : 0

/** Key numbers, in order of how much mass they hold. Used by the Edge Rail. */
export const KEY_NUMBERS = [3, 7, 6, 10, 14, 4, 1]

/**
 * Probability a team covers a spread.
 * @param {number} projMargin model's projected margin for that team (+ = favoured)
 * @param {number} line       the team's spread (-3.5 means laying 3.5)
 * @param {number} sigma      SD of NFL game margin, ~13.2 historically
 */
export function coverProbability(projMargin, line, sigma = 13.2) {
  const pPush = pushProbability(line)
  const raw = normalCdf(projMargin + line, 0, sigma)
  return { win: raw * (1 - pPush), lose: (1 - raw) * (1 - pPush), push: pPush }
}

/** Probability the total goes over. Totals are less lumpy than margins. */
export function overProbability(projTotal, line, sigma = 10.4) {
  const pPush = Number.isInteger(line) ? 0.024 : 0
  const raw = 1 - normalCdf(line, projTotal, sigma)
  return { win: raw * (1 - pPush), lose: (1 - raw) * (1 - pPush), push: pPush }
}

/** Straight-up win probability implied by a projected margin. */
export const winProbFromMargin = (projMargin, sigma = 13.2) =>
  normalCdf(projMargin, 0, sigma)

/** Inverse: the spread that corresponds to a win probability. */
export const marginFromWinProb = (p, sigma = 13.2) => {
  const q = clamp(p, 0.001, 0.999)
  // Newton on the normal CDF is overkill; bisect is exact enough here.
  return bisect((m) => normalCdf(m, 0, sigma) - q, -40, 40)
}
