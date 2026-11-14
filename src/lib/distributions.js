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
 * How wide the real spread of outcomes is around a projection.
 *
 * This used to be one fixed coefficient of variation per market (receiving
 * 0.72, rushing 0.58, passing 0.32) — "a player's bad-to-good range is the
 * same percentage of his projection whatever the projection is." Measured
 * against real results it is not: walk-forward over every 2025 and 2026
 * player-week (project from only the weeks before, compare to what
 * happened), the VARIANCE of the outcome is proportional to the projection
 * — variance / projection sits at ~21 yards for receiving and ~22 for
 * rushing at every projection size from 5 yards to 85 — so the percentage
 * spread shrinks as the projection grows. A 15-yard projection really has
 * a CV near 1.2, an 80-yard one near 0.5; one fixed number is only right
 * at a single projection size and wrong everywhere else.
 *
 * The practical damage was in the probabilities: with the fixed CV, a
 * rushing-yards over the model called 67% hit 41% of the time and one it
 * called 86% hit 71% (2026 main players). Fitted on 2025 only and checked
 * on 2026 only, variance-proportional-to-mean brought the average
 * calibration gap on rushing yards from 7.3 points to 1.7 (main players)
 * and 12.4 to 2.6 (all players); receiving yards 7.8 to 1.8 (all players).
 *
 * Each number is variance per yard of projection, i.e. the gamma's scale.
 */
export const SPREAD = {
  receivingYards: 21,
  rushingYards: 22,
  passingYards: 30
}

/** The coefficient of variation a projection of this size really carries. */
export function cvFor(market, mean) {
  const spread = SPREAD[market]
  if (!spread || !(mean > 0)) return null
  return Math.sqrt(spread / mean)
}

/**
 * Overdispersion (variance / mean) for the count markets. Receptions sit
 * close to the long-standing 1.35 in the same walk-forward (measured ~1.2
 * to 1.3, with no calibration gain from moving it). Rush attempts do not:
 * measured ~2.4 in both seasons — carries swing with game script far more
 * than a near-Poisson count allows — and using 2.4 took the all-player
 * calibration gap on 2026 from 6.9 points to 2.6.
 */
export const DISPERSION = {
  receptions: 1.35,
  rushingAttempts: 2.4
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
    const win = negBinomOver(mean, line, DISPERSION[market])
    const push = negBinomPush(mean, line, DISPERSION[market])
    return { win, push, lose: Math.max(0, 1 - win - push) }
  }

  const cv = cvFor(market, mean)
  if (!cv) return null
  const win = gammaOver(mean, line, cv)
  // Yardage lines are quoted in halves often enough, but a whole number can
  // land exactly; the mass is tiny on a continuous quantity and ignored.
  return { win, push: 0, lose: 1 - win }
}
