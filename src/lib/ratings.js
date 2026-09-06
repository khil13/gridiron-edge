/**
 * ratings.js — keep the power ratings current as the season is played.
 *
 * The model shipped with an Elo update function that nothing ever called, so
 * ratings were frozen at their opening values. By midseason that means the
 * model still believes last year's teams, and every projection inherits the
 * error.
 *
 * DESIGN RULE: always rebuild from the opening ratings and the full set of
 * results. Never mutate a stored rating in place.
 *
 * Incremental mutation looks cheaper and is a trap: a game applied twice, or
 * applied out of order, silently corrupts the ratings with no way to notice
 * or undo it. A full replay is deterministic, auditable, and cheap — a
 * season is a few hundred games, which is microseconds of arithmetic.
 */

import { updateElo, regressToMean, ELO_BASE, ELO_PER_POINT, DEFAULT_SETTINGS } from './model.js'

/**
 * Replay a season onto the opening ratings.
 *
 * @param {object} opening  { ABBR: { elo, ppg, papg, ... } }
 * @param {Array}  games    finished games; preseason is ignored
 * @param {object} settings model settings
 * @returns {{ ratings, history, applied, skipped, lastGame }}
 */
export function applyResults(opening, games, settings = DEFAULT_SETTINGS) {
  const ratings = {}
  for (const [abbr, r] of Object.entries(opening)) {
    ratings[abbr] = { ...r, openingElo: r.elo, pointsFor: 0, pointsAgainst: 0, games: 0, w: 0, l: 0, t: 0 }
  }

  // Elo is path-dependent: beating a good team early is worth more than
  // beating them once they have already fallen. Order is not optional.
  const finished = games
    .filter((g) => isRateable(g))
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))

  const history = []
  let skipped = 0

  for (const g of finished) {
    const home = ratings[g.home]
    const away = ratings[g.away]
    if (!home || !away) { skipped++; continue }

    const before = { home: home.elo, away: away.elo }
    const next = updateElo(home.elo, away.elo, g.homeScore, g.awayScore, settings)

    home.elo = next.home
    away.elo = next.away

    // Real points, replacing the synthetic figures derived from the rating.
    home.pointsFor += g.homeScore
    home.pointsAgainst += g.awayScore
    away.pointsFor += g.awayScore
    away.pointsAgainst += g.homeScore
    home.games += 1
    away.games += 1

    if (g.homeScore > g.awayScore) { home.w += 1; away.l += 1 }
    else if (g.awayScore > g.homeScore) { away.w += 1; home.l += 1 }
    else { home.t += 1; away.t += 1 }

    history.push({
      gameId: g.id,
      kickoff: g.kickoff,
      home: g.home,
      away: g.away,
      score: [g.awayScore, g.homeScore],
      shift: Math.round(next.shift * 10) / 10,
      before,
      after: { home: next.home, away: next.away }
    })
  }

  // Scoring rates come from what actually happened once there is enough of
  // it. Early in a season two games is not a scoring rate, so blend toward
  // the opening estimate until the sample is worth something.
  for (const r of Object.values(ratings)) {
    if (r.games > 0) {
      const observedFor = r.pointsFor / r.games
      const observedAgainst = r.pointsAgainst / r.games
      // Shrinkage: full weight on observed at 8 games, none at 0.
      const w = Math.min(1, r.games / 8)
      r.ppg = round1(observedFor * w + r.ppg * (1 - w))
      r.papg = round1(observedAgainst * w + r.papg * (1 - w))
      r.observedPpg = round1(observedFor)
      r.observedPapg = round1(observedAgainst)
      r.synthetic = r.games >= 8 ? [] : ['ppg', 'papg']
    }
    r.elo = Math.round(r.elo * 10) / 10
    r.pointsVsAverage = round2((r.elo - ELO_BASE) / ELO_PER_POINT)
    r.eloChange = round1(r.elo - r.openingElo)
  }

  return {
    ratings,
    history,
    applied: history.length,
    skipped,
    lastGame: finished[finished.length - 1] ?? null
  }
}

/**
 * Only completed regular-season and playoff games count.
 *
 * Preseason is excluded deliberately: starters play a handful of snaps, so a
 * preseason result says almost nothing about a roster and would drag ratings
 * toward whichever teams happened to play their backups better.
 */
export function isRateable(g) {
  return (
    g &&
    g.status === 'final' &&
    !g.preseason &&
    typeof g.homeScore === 'number' &&
    typeof g.awayScore === 'number'
  )
}

/** Roll ratings into a new season: regress toward the mean, clear the record. */
export function rollOver(ratings, amount = DEFAULT_SETTINGS.offseasonRegression) {
  const out = {}
  for (const [abbr, r] of Object.entries(ratings)) {
    out[abbr] = {
      ...r,
      elo: round1(regressToMean(r.elo, amount)),
      pointsFor: 0, pointsAgainst: 0, games: 0, w: 0, l: 0, t: 0, eloChange: 0
    }
  }
  return out
}

/** Biggest movers since opening, for the UI. */
export function movers(ratings, count = 5) {
  const rows = Object.entries(ratings)
    .map(([abbr, r]) => ({ abbr, change: r.eloChange ?? 0, pointsVsAverage: r.pointsVsAverage }))
    .filter((r) => r.change !== 0)
  // A team that has fallen is not a riser just because it is the least bad
  // of a short list, so each side is filtered by direction first.
  return {
    up: rows.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, count),
    down: rows.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, count)
  }
}

const round1 = (v) => Math.round(v * 10) / 10
const round2 = (v) => Math.round(v * 100) / 100
