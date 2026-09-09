/**
 * distributions.js — the shapes football statistics actually take.
 *
 * The temptation with a yardage prop is to assume a normal distribution
 * around the projection. It is wrong in a way that matters:
 *
 *   - Yards cannot go far below zero, but a normal puts real mass there.
 *   - Receiving totals are strongly right-skewed. A receiver averaging 60
 *     yards has a floor near zero and a long tail past 150. A symmetric
 *     curve prices the under too cheaply and the big game too dearly, which
 *     is exactly where the market makes its money on recreational bets.
 *
 * So yardage uses a gamma, receptions and touchdowns use count
 * distributions, and each carries a variance taken from how the statistic
 * actually behaves rather than a convenient default.
 */

/* ---------- Gamma, for yardage ---------- */

/** Lanczos log-gamma; accurate well past any football number. */
export function logGamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = 0.99999999999980993
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1)
  const t = z + g.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/**
 * Regularised lower incomplete gamma P(a, x), by series below the mean and
 * continued fraction above it — the standard split, because the series
 * converges slowly on the far side.
 */
export function gammaP(a, x) {
  if (x <= 0) return 0
  if (a <= 0) return 1
  if (x < a + 1) {
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
  }
  // Continued fraction for Q(a, x), then P = 1 - Q.
  let b = x + 1 - a
  let c = 1e300
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
  return 1 - q
}

/**
 * P(yards > line) for a gamma with the given mean and coefficient of
 * variation.
 *
 * @param {number} mean  projected yards
 * @param {number} cv    standard deviation divided by the mean
 */
export function gammaOver(mean, line, cv) {
  if (mean <= 0) return line < 0 ? 1 : 0
  if (line <= 0) return 1
  const shape = 1 / (cv * cv)
  const scale = mean / shape
  return 1 - gammaP(shape, line / scale)
}

/**
 * How variable each statistic is, as a coefficient of variation.
 *
 * These are the numbers that decide how a prop is priced away from its
 * projection, so they are worth stating plainly rather than burying. They
 * are rounded from observed game-to-game spread: receiving is the most
 * volatile because a single deep ball rewrites an afternoon, quarterback
 * passing the least because volume is high and steady.
 */
export const VARIABILITY = {
  receivingYards: 0.72,
  rushingYards: 0.58,
  passingYards: 0.32,
  receptions: null,      // count, uses negative binomial
  rushingAttempts: null
}

/* ---------- Counts, for receptions and carries ---------- */

/**
 * Negative binomial, not Poisson.
 *
 * Poisson forces variance to equal the mean. Reception counts are
 * overdispersed — game plan, script and coverage push them around more than
 * a Poisson allows — so a dispersion term is fitted instead. Using Poisson
 * here would understate both the quiet games and the big ones.
 */
export function negBinomOver(mean, line, dispersion = 1.35) {
  if (mean <= 0) return 0
  const variance = mean * dispersion
  // r successes, p per-trial probability, matched to mean and variance.
  const r = variance > mean ? (mean * mean) / (variance - mean) : 1e6
  const p = r / (r + mean)

  // "Over 7" means eight or more, not seven or more. Landing exactly on a
  // whole line is a push, and counting it as a win overstates the over by
  // the whole push mass — more than ten percent on a typical receptions line.
  const need = Number.isInteger(line) ? line + 1 : Math.ceil(line)
  let below = 0
  for (let k = 0; k < need; k++) below += negBinomPmf(k, r, p)
  return Math.max(0, Math.min(1, 1 - below))
}

export function negBinomPmf(k, r, p) {
  const logC = logGamma(k + r) - logGamma(r) - logGamma(k + 1)
  return Math.exp(logC + r * Math.log(p) + k * Math.log(1 - p))
}

/** Exact-landing mass, for whole-number lines that push. */
export function negBinomPush(mean, line, dispersion = 1.35) {
  if (!Number.isInteger(line) || mean <= 0) return 0
  const variance = mean * dispersion
  const r = variance > mean ? (mean * mean) / (variance - mean) : 1e6
  const p = r / (r + mean)
  return negBinomPmf(line, r, p)
}

/* ---------- One entry point ---------- */

/**
 * Probability of going over a line, dispatched to the right distribution.
 *
 * @param {'receivingYards'|'rushingYards'|'passingYards'|'receptions'|'rushingAttempts'} market
 */
export function overProbabilityFor(market, mean, line) {
  if (mean == null || !Number.isFinite(mean) || mean <= 0) return null

  if (market === 'receptions' || market === 'rushingAttempts') {
    // negBinomOver already excludes the exact-landing mass, so the three
    // outcomes sum to one without further adjustment.
    const win = negBinomOver(mean, line)
    const push = negBinomPush(mean, line)
    return { win, push, lose: Math.max(0, 1 - win - push) }
  }

  const cv = VARIABILITY[market]
  if (!cv) return null
  const win = gammaOver(mean, line, cv)
  // Yardage lines are quoted in halves often enough, but a whole number can
  // land exactly; the mass is tiny on a continuous quantity and ignored.
  return { win, push: 0, lose: 1 - win }
}
