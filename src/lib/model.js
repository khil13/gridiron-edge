/**
 * model.js — the power rating engine.
 *
 * A margin-aware Elo. Ratings are on the familiar 1500-centred scale, and
 * the conversion constant is the only opinionated number in here:
 * 25 rating points ≈ 1 point of expected margin. That figure comes from
 * fitting rating differentials against closing spreads; it is exposed as a
 * setting so you can refit it against your own data.
 */

import { winProbFromMargin, clamp } from './odds.js'

export const ELO_BASE = 1500
export const ELO_PER_POINT = 25

export const DEFAULT_SETTINGS = {
  homeField: 1.6,        // points, not Elo. Post-2020 NFL HFA has been ~1.5-2.0
  eloPerPoint: 25,
  kFactor: 20,
  marginMultiplier: true, // scale updates by margin of victory
  marginSigma: 13.2,      // SD of NFL final margins
  totalSigma: 10.4,
  restPointsPerDay: 0.12, // short week / bye adjustment
  offseasonRegression: 0.25,
  devigMethod: 'shin',
  minEdge: 0.02,          // 2% EV before a play is flagged
  kellyFraction: 0.25,    // quarter Kelly
  bankroll: 1000
}

/** Elo win expectancy for a rating difference already including HFA. */
export const eloExpected = (ratingDiff) => 1 / (1 + Math.pow(10, -ratingDiff / 400))

/**
 * FiveThirtyEight-style margin-of-victory multiplier. Blowouts move ratings
 * more, but the autocorrelation term stops good teams from running away.
 */
export function movMultiplier(margin, ratingDiff) {
  return Math.log(Math.abs(margin) + 1) * (2.2 / (ratingDiff * 0.001 + 2.2))
}

/**
 * Update both ratings after a completed game.
 * @returns {{ home: number, away: number, shift: number }}
 */
export function updateElo(homeElo, awayElo, homeScore, awayScore, s = DEFAULT_SETTINGS) {
  const hfaElo = s.homeField * s.eloPerPoint
  const diff = homeElo + hfaElo - awayElo
  const expected = eloExpected(diff)
  const margin = homeScore - awayScore
  const actual = margin > 0 ? 1 : margin < 0 ? 0 : 0.5
  const mult = s.marginMultiplier ? movMultiplier(margin || 1, actual === 1 ? diff : -diff) : 1
  const shift = s.kFactor * mult * (actual - expected)
  return { home: homeElo + shift, away: awayElo - shift, shift }
}

/** Pull ratings back toward the mean between seasons. */
export const regressToMean = (elo, amount = DEFAULT_SETTINGS.offseasonRegression) =>
  ELO_BASE + (elo - ELO_BASE) * (1 - amount)

/** Rating points → points of spread. */
export const eloToPoints = (eloDiff, s = DEFAULT_SETTINGS) => eloDiff / s.eloPerPoint

/**
 * Project a single game.
 *
 * @param {object} game    { home, away, homeRestDays, awayRestDays, neutral }
 * @param {object} ratings { [abbr]: { elo, ppg, papg } }
 * @param {object} s       settings
 * @returns projection with the model's own spread, total and win probability
 */
export function projectGame(game, ratings, s = DEFAULT_SETTINGS) {
  const home = ratings[game.home]
  const away = ratings[game.away]
  if (!home || !away) return null

  const hfa = game.neutral ? 0 : s.homeField
  const rest =
    ((game.homeRestDays ?? 7) - (game.awayRestDays ?? 7)) * s.restPointsPerDay

  const margin = eloToPoints(home.elo - away.elo, s) + hfa + rest
  const homeWinProb = winProbFromMargin(margin, s.marginSigma)

  // Totals blend each side's scoring rate against the other's defence,
  // then shrink toward the league mean because single-season pace is noisy.
  const leagueMean = 44.2
  const raw = (home.ppg + away.papg) / 2 + (away.ppg + home.papg) / 2
  const total = raw * 0.72 + leagueMean * 0.28

  return {
    margin,                       // + means home favoured
    modelSpreadHome: -margin,     // how the model would post the home side
    modelSpreadAway: margin,
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    total: Math.round(total * 2) / 2,
    hfa,
    rest
  }
}

/**
 * Build season-opening ratings from finished results.
 * Regresses last season's ending Elo toward the mean and applies any
 * manual offseason adjustment (free agency, draft, QB change).
 */
export function seasonOpeningRatings(endOfSeason, adjustments = {}, s = DEFAULT_SETTINGS) {
  const out = {}
  for (const [abbr, r] of Object.entries(endOfSeason)) {
    out[abbr] = {
      ...r,
      elo: regressToMean(r.elo, s.offseasonRegression) + (adjustments[abbr] ?? 0) * s.eloPerPoint
    }
  }
  return out
}

/** Rank teams by rating and return power-rating rows. */
export function powerRankings(ratings) {
  return Object.entries(ratings)
    .map(([abbr, r]) => ({
      abbr,
      ...r,
      pointsVsAverage: (r.elo - ELO_BASE) / ELO_PER_POINT
    }))
    .sort((a, b) => b.elo - a.elo)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

/**
 * Strength of schedule: average opponent rating across a team's games,
 * expressed in points relative to a league-average opponent.
 */
export function strengthOfSchedule(abbr, games, ratings) {
  const opponents = games
    .filter((g) => g.home === abbr || g.away === abbr)
    .map((g) => (g.home === abbr ? g.away : g.home))
    .map((o) => ratings[o]?.elo)
    .filter(Boolean)
  if (!opponents.length) return 0
  const mean = opponents.reduce((a, b) => a + b, 0) / opponents.length
  return (mean - ELO_BASE) / ELO_PER_POINT
}

/**
 * Reconstruct a plausible in-game win probability path.
 *
 * This is a demo device, not a play-by-play model: it walks a Brownian
 * bridge from the pregame number to the actual result so finished games
 * have a chart to show. Anything drawn from this is tagged "simulated"
 * in the UI. Swap in real drive data and delete this function.
 */
export function winProbabilityPath(pregameProb, finalMargin, seed = 1, points = 40) {
  const rand = mulberry32(seed)
  const path = []
  let value = pregameProb
  const target = finalMargin > 0 ? 1 : finalMargin < 0 ? 0.5 : 0.5
  for (let i = 0; i <= points; i++) {
    const t = i / points
    const pull = Math.pow(t, 2.4)
    const noise = (rand() - 0.5) * 0.16 * (1 - pull)
    value = value + noise + (target - value) * pull * 0.22
    path.push({ t: t * 60, p: clamp(value, 0.01, 0.99) })
  }
  path[0].p = pregameProb
  path[path.length - 1].p = target
  return path
}

/** Small deterministic PRNG so generated data is stable across reloads. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
