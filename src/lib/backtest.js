/**
 * backtest.js — did the power-rating model's pregame projections actually
 * match what happened?
 *
 * This replays real finished games in chronological order, exactly the way
 * ratings.js's applyResults() already keeps ratings current in-season: each
 * game is projected from whatever is known BEFORE it kicks off, then (and
 * only then) its real result is folded into the ratings for the next game.
 * A game's own result is never used to predict itself, and nothing here
 * rewrites a past game's recorded prediction once it has been computed —
 * run it again on the same input and every number comes back identical.
 *
 * The only real, bundled historical results in this app right now are
 * season2025.js's Week 18 slate and full 2025 postseason (SEASON_2025.results,
 * 23 games). That is a real but small and late-season-only sample: every
 * team's rating here starts from a neutral prior (no bundled 2024 result
 * feeds an opening rating), so the earliest games in the replay are the
 * model knowing the least. Nothing is invented to hide that — callers can
 * see each game's `homeGamesSoFar`/`awayGamesSoFar` and should read the
 * early rows accordingly.
 */

import { ELO_BASE, DEFAULT_SETTINGS, projectGame, updateElo } from './model.js'
import { restDaysFor } from './ratings.js'

export const LEAGUE_AVG_PPG = 22.1

function isFinishedGame(g) {
  return !!g && !!g.home && !!g.away && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore)
}

/**
 * @param {Array} games           finished games, any order, with home/away/kickoff/homeScore/awayScore
 * @param {object} openingRatings optional { ABBR: { elo, ppg, papg } } to start from instead of a flat prior
 * @param {object} s              model settings
 * @returns {{ games: object[], metrics: object|null }}
 */
export function runBacktest(games, openingRatings = {}, s = DEFAULT_SETTINGS) {
  const finished = (games || [])
    .filter(isFinishedGame)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))

  const teams = {}
  const ensure = (abbr) => {
    if (!teams[abbr]) {
      const opening = openingRatings[abbr]
      teams[abbr] = {
        elo: opening?.elo ?? ELO_BASE,
        openingPpg: opening?.ppg ?? LEAGUE_AVG_PPG,
        openingPapg: opening?.papg ?? LEAGUE_AVG_PPG,
        ppg: opening?.ppg ?? LEAGUE_AVG_PPG,
        papg: opening?.papg ?? LEAGUE_AVG_PPG,
        pointsFor: 0,
        pointsAgainst: 0,
        games: 0
      }
    }
    return teams[abbr]
  }

  const history = []
  const records = []

  for (const g of finished) {
    const home = ensure(g.home)
    const away = ensure(g.away)

    const homeRestDays = restDaysFor(g.home, g.kickoff, history)
    const awayRestDays = restDaysFor(g.away, g.kickoff, history)
    // A snapshot, not a live reference: projectGame must only ever see what
    // was true before kickoff, never the post-update ratings computed below.
    const pregameRatings = {
      [g.home]: { elo: home.elo, ppg: home.ppg, papg: home.papg },
      [g.away]: { elo: away.elo, ppg: away.ppg, papg: away.papg }
    }
    const projection = projectGame({ ...g, homeRestDays, awayRestDays }, pregameRatings, s)

    if (projection) {
      const actualMargin = g.homeScore - g.awayScore
      const actualTotal = g.homeScore + g.awayScore
      const actualHomeWin = actualMargin > 0 ? 1 : actualMargin < 0 ? 0 : 0.5
      const pickedHome = projection.homeWinProb >= 0.5
      records.push({
        gameId: g.id ?? `${g.away}@${g.home}-${g.kickoff}`,
        kickoff: g.kickoff,
        round: g.round ?? g.title ?? null,
        home: g.home,
        away: g.away,
        predictedMargin: round2(projection.margin),
        predictedHomeWinProb: round2(projection.homeWinProb),
        predictedTotal: projection.total,
        actualMargin,
        actualTotal,
        actualHomeWin,
        marginError: round2(projection.margin - actualMargin),
        totalError: round2(projection.total - actualTotal),
        correctWinner: actualMargin === 0 ? null : pickedHome === actualMargin > 0,
        homeGamesSoFar: home.games,
        awayGamesSoFar: away.games
      })
    }

    const next = updateElo(home.elo, away.elo, g.homeScore, g.awayScore, s)
    home.elo = next.home
    away.elo = next.away

    home.pointsFor += g.homeScore
    home.pointsAgainst += g.awayScore
    home.games += 1
    away.pointsFor += g.awayScore
    away.pointsAgainst += g.homeScore
    away.games += 1

    // Same shrinkage rule applyResults() uses: full weight on what has
    // actually happened at 8 games, none at 0.
    const wHome = Math.min(1, home.games / 8)
    home.ppg = home.pointsFor / home.games * wHome + home.openingPpg * (1 - wHome)
    home.papg = home.pointsAgainst / home.games * wHome + home.openingPapg * (1 - wHome)
    const wAway = Math.min(1, away.games / 8)
    away.ppg = away.pointsFor / away.games * wAway + away.openingPpg * (1 - wAway)
    away.papg = away.pointsAgainst / away.games * wAway + away.openingPapg * (1 - wAway)

    history.push({ home: g.home, away: g.away, kickoff: g.kickoff })
  }

  return { games: records, metrics: computeMetrics(records) }
}

/**
 * Mean absolute error on the margin, Brier score on win probability, and
 * straight-up accuracy. These are the honest, standard ways to grade a
 * probabilistic sports model — not a new invented score.
 */
export function computeMetrics(records) {
  const scored = (records || []).filter((r) => r.correctWinner !== null)
  if (!scored.length) return null
  const n = scored.length
  const marginMae = scored.reduce((sum, r) => sum + Math.abs(r.marginError), 0) / n
  const totalMae = scored.reduce((sum, r) => sum + Math.abs(r.totalError), 0) / n
  const brier = scored.reduce((sum, r) => sum + (r.predictedHomeWinProb - r.actualHomeWin) ** 2, 0) / n
  const accuracy = scored.filter((r) => r.correctWinner).length / n
  return { n, marginMae: round2(marginMae), totalMae: round2(totalMae), brier: round(brier, 4), accuracy: round2(accuracy) }
}

/**
 * Calibration: of the games the model gave a home win probability in each
 * bucket, how often did the home side actually win? A well-calibrated model
 * has `actualWinRate` tracking `avgPredicted` bucket by bucket — the point
 * of showing this instead of just accuracy is that a model can be accurate
 * and still badly calibrated (or vice versa), and only this view catches it.
 *
 * With a few dozen games the buckets are necessarily thin; each row carries
 * its own `n` so a thin bucket is visibly thin rather than silently misread
 * as a strong result.
 */
export function calibrationBuckets(records, bucketSize = 0.1) {
  const scored = (records || []).filter((r) => r.correctWinner !== null)
  const buckets = new Map()
  for (const r of scored) {
    const lo = Math.min(1 - bucketSize, Math.floor(r.predictedHomeWinProb / bucketSize) * bucketSize)
    if (!buckets.has(lo)) buckets.set(lo, [])
    buckets.get(lo).push(r)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lo, rows]) => ({
      lo: round2(lo),
      hi: round2(lo + bucketSize),
      n: rows.length,
      avgPredicted: round2(avg(rows.map((r) => r.predictedHomeWinProb))),
      actualWinRate: round2(avg(rows.map((r) => r.actualHomeWin)))
    }))
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const round2 = (v) => Math.round(v * 100) / 100
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d
