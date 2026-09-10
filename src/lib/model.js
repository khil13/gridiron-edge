/**
 * model.js — the power rating engine.
 *
 * A margin-aware Elo. Ratings are on the familiar 1500-centred scale, and
 * the conversion constant is the only opinionated number in here:
 * 25 rating points ≈ 1 point of expected margin. That figure comes from
 * fitting rating differentials against closing spreads; it is exposed as a
 * setting so you can refit it against your own data.
 */

import { winProbFromMargin, clamp, normalCdf } from './odds.js'

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
  preseasonShrink: 0.55,  // pull spreads toward a pick'em
  preseasonTotalShift: -7.0, // see note in projectGame
  offseasonRegression: 0.25,
  devigMethod: 'shin',
  minEdge: 0.02,          // 2% EV before a play is flagged
  kellyFraction: 0.25,    // quarter Kelly
  bankroll: 1000
}

/**
 * Named presets.
 *
 * Most people do not want to configure a quant model; they want to say how
 * picky the card should be and how much to risk. These set the two controls
 * that actually change the output, and leave the model internals alone.
 */
export const PRESETS = [
  {
    key: 'cautious',
    label: 'Cautious',
    blurb: 'Only the clearest edges, small stakes. Fewer plays, most days quiet.',
    settings: { minEdge: 0.04, kellyFraction: 0.15 }
  },
  {
    key: 'balanced',
    label: 'Balanced',
    blurb: 'The default. A handful of plays on a normal slate.',
    settings: { minEdge: 0.02, kellyFraction: 0.25 }
  },
  {
    key: 'aggressive',
    label: 'Aggressive',
    blurb: 'Takes thinner edges and stakes them harder. More plays, more variance.',
    settings: { minEdge: 0.01, kellyFraction: 0.5 }
  }
]

/** Which preset the current settings match, if any. */
export const presetFor = (s) =>
  PRESETS.find(
    (p) =>
      Math.abs(p.settings.minEdge - s.minEdge) < 1e-9 &&
      Math.abs(p.settings.kellyFraction - s.kellyFraction) < 1e-9
  ) || null

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
  let total = raw * 0.72 + leagueMean * 0.28

  // Preseason scores far lower than the regular season: vanilla playcalling,
  // no game-planning, backups for three quarters, and a running clock late.
  // Books post preseason totals in the mid-to-high 30s while this model,
  // built from regular-season ratings, would otherwise say 44. Without this
  // correction every preseason total projection is ~7 points too high and
  // the model wrongly loves overs.
  if (game.preseason) total += s.preseasonTotalShift ?? -7

  const rounded = Math.round(total * 2) / 2

  // Team totals fall straight out of the two numbers the model already has:
  // if the game totals T and the home side wins by M, the two scores are
  // (T + M) / 2 and (T - M) / 2. No new assumptions required.
  const homeTeamTotal = Math.round(((rounded + margin) / 2) * 2) / 2
  const awayTeamTotal = Math.round(((rounded - margin) / 2) * 2) / 2

  return {
    margin,                       // + means home favoured
    modelSpreadHome: -margin,     // how the model would post the home side
    modelSpreadAway: margin,
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    total: rounded,
    homeTeamTotal,
    awayTeamTotal,
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
      // Rounded here so downstream comparisons and any raw display do not
      // carry floating-point noise like 5.9360000000000035.
      pointsVsAverage: Math.round(((r.elo - ELO_BASE) / ELO_PER_POINT) * 100) / 100
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

/* ------------------------------------------------------------------ */
/* In-game win probability                                             */
/* ------------------------------------------------------------------ */

/** Minutes left in regulation, from the quarter and the game clock. */
export function minutesRemaining(period, clock) {
  if (!period) return 60
  const [m, s] = String(clock ?? '15:00').split(':').map(Number)
  const inQuarter = Number.isFinite(m) ? m + (Number.isFinite(s) ? s / 60 : 0) : 15
  // Overtime: whatever is left on the clock is all there is.
  if (period > 4) return Math.max(0, inQuarter)
  return Math.max(0, (4 - period) * 15 + inQuarter)
}

/**
 * Live win probability from the score and the clock.
 *
 * The pregame number stops being true the moment a game kicks off, and
 * leaving it on screen while a team leads by ten is worse than showing
 * nothing — it reads as a current estimate.
 *
 * The model is deliberately simple and says what it assumes: the remaining
 * game is the pregame projection scaled to the time left, and the spread of
 * outcomes narrows with the square root of that time. A ten-point lead is
 * worth far more with five minutes left than with fifty, and the square root
 * is what encodes that.
 *
 * It does not know about possession, timeouts, or field position, so it is
 * least reliable in exactly the situations people care most about — a
 * one-score game inside two minutes.
 */
export function liveWinProbability(homeScore, awayScore, period, clock, pregameMargin, s = DEFAULT_SETTINGS) {
  const left = minutesRemaining(period, clock)
  const fraction = Math.max(0, Math.min(1, left / 60))
  const current = (homeScore ?? 0) - (awayScore ?? 0)

  // What is still to come, if the teams play to their projection.
  const expectedRest = pregameMargin * fraction

  // Uncertainty shrinks with the square root of time left, with a floor so
  // a tied game at the whistle reads as a coin flip rather than a certainty.
  const sigma = Math.max(1.5, s.marginSigma * Math.sqrt(fraction))

  const p = normalCdf(current + expectedRest, 0, sigma)
  return {
    home: Math.min(0.999, Math.max(0.001, p)),
    away: Math.min(0.999, Math.max(0.001, 1 - p)),
    minutesLeft: Math.round(left * 10) / 10,
    // A game inside two minutes and one score turns on things this cannot
    // see, so the UI can soften the claim.
    lowConfidence: left < 2 && Math.abs(current) <= 8
  }
}
