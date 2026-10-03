/**
 * epaModel.js — a second, independent projection method.
 *
 * model.js's power ratings are a margin-aware Elo: they know nothing about
 * *how* a team wins, only that it did, by how much, and against whom. This
 * model starts from a completely different signal — real per-play EPA
 * (expected points added) and success rate from nflverse's play-by-play
 * data (see scripts/fetch-team-efficiency.mjs) — and never looks at a
 * result's margin at all.
 *
 * The two methods sharing almost no inputs is the point: where they agree,
 * that is a real signal from two different angles; where they disagree, that
 * is genuine uncertainty worth showing rather than averaging away. See
 * modelAgreement.js for how the two get compared.
 *
 * EPA is already denominated in expected points, so a team's own net EPA
 * per play, multiplied by how many plays actually happen, is a direct
 * (not re-scaled) estimate of the points that edge is worth over a game —
 * no fitted conversion constant the way model.js's ELO_PER_POINT is.
 */

import { winProbFromMargin } from './odds.js'

/**
 * League-average offensive and defensive EPA/play for one season's table,
 * used to center a matchup's expected value — a team's raw efficiency
 * numbers already reflect the schedule they played, so a matchup estimate
 * has to express both sides relative to the league they're drawn from,
 * not just add their raw numbers together.
 */
export function leagueAverages(seasonEfficiency) {
  const teams = Object.values(seasonEfficiency ?? {})
  const avg = (key) => {
    const vals = teams.map((t) => t[key]).filter((v) => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const avgPlays = (() => {
    const vals = teams.map((t) => t.playsPerGame).filter((v) => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 64
  })()
  return {
    offEpa: avg('epaPerPlayOff'),
    defEpa: avg('epaPerPlayDef'),
    playsPerGame: avgPlays
  }
}

/**
 * Blend a thin current-season sample toward last season's full-season
 * numbers — the same shrinkage ratings.js already applies to ppg/papg
 * (full weight on observed at 8 games, none at 0), applied here because
 * three or four games of real EPA data is a genuinely noisy read on a
 * team, not because the number is wrong.
 *
 * @param {object|undefined} current  this season's team-efficiency row
 * @param {object|undefined} prior    last season's team-efficiency row
 */
export function blendTeamEfficiency(current, prior) {
  if (!current) return prior ?? null
  if (!prior) return current
  const w = Math.min(1, (current.games ?? 0) / 8)
  const blend = (key) =>
    current[key] == null || prior[key] == null ? current[key] ?? prior[key] : current[key] * w + prior[key] * (1 - w)
  return {
    games: current.games,
    epaPerPlayOff: blend('epaPerPlayOff'),
    epaPerPlayDef: blend('epaPerPlayDef'),
    successRateOff: blend('successRateOff'),
    successRateDef: blend('successRateDef'),
    explosivePlayRateOff: blend('explosivePlayRateOff'),
    thirdDownRateOff: blend('thirdDownRateOff'),
    thirdDownRateDef: blend('thirdDownRateDef'),
    redZoneTdRateOff: blend('redZoneTdRateOff'),
    turnoverRate: blend('turnoverRate'),
    playsPerGame: blend('playsPerGame'),
    sampleWeight: Math.round(w * 100) / 100
  }
}

/**
 * Build one season's worth of blended team tables from the raw generated
 * file's `seasons` map — every team blended toward the prior season the
 * same way, so projectGameEpa() always sees a consistently-shrunk table
 * rather than mixing raw current-season rows with raw prior-season ones.
 */
export function blendedSeasonEfficiency(seasons, latestSeason) {
  const current = seasons?.[latestSeason] ?? {}
  const prior = seasons?.[latestSeason - 1] ?? {}
  const teams = new Set([...Object.keys(current), ...Object.keys(prior)])
  const out = {}
  for (const team of teams) {
    const blended = blendTeamEfficiency(current[team], prior[team])
    if (blended) out[team] = blended
  }
  return out
}

/**
 * Project one game from real team efficiency alone.
 *
 * Deliberately margin/win-probability only, not a total — EPA/play is a
 * genuinely strong signal for "who wins by how much," but turning it into
 * an absolute point total needs a real scoring-rate model, which model.js
 * already has from actual points-for/against; duplicating a weaker version
 * of that here just to have a second total would not be a second opinion,
 * it would be noise dressed up as one.
 *
 * @param {object} game        { home, away, neutral }
 * @param {object} efficiency  one season's team-efficiency.json `seasons[season]`
 * @param {object} s           settings — only homeField and marginSigma are used
 * @returns {{ margin, homeWinProb, awayWinProb, homeNetEpa, awayNetEpa } | null}
 */
export function projectGameEpa(game, efficiency, s = {}) {
  const home = efficiency?.[game.home]
  const away = efficiency?.[game.away]
  if (!home || !away) return null
  if (home.epaPerPlayOff == null || away.epaPerPlayOff == null) return null

  const league = leagueAverages(efficiency)

  // Each side's expected EPA/play in THIS matchup: their own offensive
  // departure from league average, plus the opponent defense's departure
  // from league average — the standard additive adjustment, so a good
  // offense against a bad defense compounds rather than just averaging out.
  const homeExpectedEpa = home.epaPerPlayOff + away.epaPerPlayDef - league.defEpa
  const awayExpectedEpa = away.epaPerPlayOff + home.epaPerPlayDef - league.defEpa

  const hfa = game.neutral ? 0 : (s.homeField ?? 1.6)
  const epaMarginPerPlay = homeExpectedEpa - awayExpectedEpa
  const margin = epaMarginPerPlay * league.playsPerGame + hfa

  const sigma = s.marginSigma ?? 13.2
  const homeWinProb = winProbFromMargin(margin, sigma)

  return {
    margin,
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    homeNetEpa: Math.round(homeExpectedEpa * 1000) / 1000,
    awayNetEpa: Math.round(awayExpectedEpa * 1000) / 1000
  }
}
