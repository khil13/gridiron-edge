/**
 * simulation.js — real Monte Carlo game simulation.
 *
 * edges.js and model.js already compute win probability and totals exactly,
 * in closed form, from a Normal approximation to the margin/total. That is
 * correct on average but hides two things a single number can't show: NFL
 * scores are not continuous (a team can land on 17 or 20, never 18.4), and
 * a reader never sees how much spread sits around the headline number.
 *
 * This simulates each side's score as a sequence of discrete scoring
 * events — the same scoring-event model props.js's quarterPointsDistribution
 * already uses for first-quarter projections (Poisson count of scores, each
 * one a touchdown-or-field-goal coin flip), extended to a full game and run
 * thousands of times rather than solved in closed form. Running it as an
 * actual simulation (not the exact combinatorial distribution the Q1 model
 * uses) is deliberate: it keeps the door open for real per-simulation
 * variation — this version keeps that scope to realistic score step sizes
 * (not a continuous Normal) with no stronger claim than that.
 */

import { TOUCHDOWN_FRACTION } from './props.js'
import { mulberry32 } from './model.js'
import { winProbFromMargin } from './odds.js'

const DEFAULT_ITERATIONS = 5000

/** Knuth's algorithm — fine at the scoring-event rates a single team sees (2-6 per game). */
function samplePoisson(rand, lambda) {
  if (lambda <= 0) return 0
  const limit = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > limit)
  return k - 1
}

/**
 * One simulated score for one team: a Poisson number of scoring drives,
 * each one a touchdown (7, ignoring the rare missed extra point or two-point
 * try — the same simplification quarterPointsDistribution already makes)
 * or a field goal (3).
 */
function sampleTeamScore(rand, expectedPoints, touchdownFraction) {
  const perScore = touchdownFraction * 7 + (1 - touchdownFraction) * 3
  const lambda = Math.max(0, expectedPoints) / perScore
  const events = samplePoisson(rand, lambda)
  let points = 0
  for (let i = 0; i < events; i++) points += rand() < touchdownFraction ? 7 : 3
  return points
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]

/** Fixed-width histogram over a sorted sample array, for charting. */
function histogram(sorted, binWidth) {
  if (!sorted.length) return []
  const min = Math.floor(sorted[0] / binWidth) * binWidth
  const max = Math.ceil(sorted[sorted.length - 1] / binWidth) * binWidth
  const bins = []
  for (let lo = min; lo < max; lo += binWidth) bins.push({ lo, hi: lo + binWidth, count: 0 })
  for (const v of sorted) {
    const idx = Math.min(bins.length - 1, Math.floor((v - min) / binWidth))
    if (bins[idx]) bins[idx].count++
  }
  return bins
}

const summarize = (values, binWidth) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
  return {
    mean: Math.round(mean * 10) / 10,
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    histogram: histogram(sorted, binWidth)
  }
}

/**
 * Simulate one game thousands of times from its own projected team totals.
 *
 * @param {{homeTeamTotal:number, awayTeamTotal:number, margin:number}} projection
 * @param {object} [opts]
 * @param {number} [opts.iterations]
 * @param {number} [opts.seed]          deterministic by default — same game,
 *                                      same projection, same simulated
 *                                      distribution on every render, rather
 *                                      than the UI reshuffling on its own
 * @returns {object|null} null when there's nothing real to simulate from
 */
export function simulateGame(projection, { iterations = DEFAULT_ITERATIONS, seed } = {}) {
  if (!projection || projection.homeTeamTotal == null || projection.awayTeamTotal == null) return null

  const rand = mulberry32(seed ?? hashFromProjection(projection))
  const homeScores = new Array(iterations)
  const awayScores = new Array(iterations)
  let homeWins = 0
  let pushes = 0

  for (let i = 0; i < iterations; i++) {
    const home = sampleTeamScore(rand, projection.homeTeamTotal, TOUCHDOWN_FRACTION)
    const away = sampleTeamScore(rand, projection.awayTeamTotal, TOUCHDOWN_FRACTION)
    homeScores[i] = home
    awayScores[i] = away
    if (home > away) homeWins++
    else if (home === away) pushes++
  }

  const margins = homeScores.map((h, i) => h - awayScores[i])
  const totals = homeScores.map((h, i) => h + awayScores[i])

  const homeWinProb = homeWins / iterations
  const pushProb = pushes / iterations
  const awayWinProb = 1 - homeWinProb - pushProb

  // A cross-check against the closed-form Normal approximation edges.js
  // relies on elsewhere — real disagreement here means the discrete,
  // event-driven shape of scoring genuinely differs from a smooth Normal
  // for this specific matchup (a very low- or high-scoring projection,
  // where "lands on exactly 0" or heavy field-goal mix bends the shape),
  // not a bug in either one.
  const analyticalWinProb = projection.margin != null ? winProbFromMargin(projection.margin) : null

  return {
    iterations,
    homeWinProb: Math.round(homeWinProb * 1000) / 1000,
    awayWinProb: Math.round(awayWinProb * 1000) / 1000,
    pushProb: Math.round(pushProb * 1000) / 1000,
    analyticalWinProb: analyticalWinProb != null ? Math.round(analyticalWinProb * 1000) / 1000 : null,
    homeScore: summarize(homeScores, 3),
    awayScore: summarize(awayScores, 3),
    margin: summarize(margins, 3),
    total: summarize(totals, 3)
  }
}

/** Deterministic seed from the projection itself, so repeated renders of the same game agree. */
function hashFromProjection(p) {
  const s = `${p.homeTeamTotal}|${p.awayTeamTotal}|${p.margin}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
