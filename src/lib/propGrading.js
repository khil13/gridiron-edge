/**
 * propGrading.js — grade the player projections against what really happened.
 *
 * Walk-forward and leak-free: for every week of a season, each player is
 * projected from only the weeks BEFORE it (falling back to last season when
 * he has nothing yet, exactly as the app does), through the same production
 * functions the Card's projections board uses, and compared with his real
 * stat line that week. The result is the track record the Card shows — so
 * "how accurate is this" is a measured, current number rather than a claim.
 *
 * Two things here are stand-ins for inputs that are not recoverable after
 * the fact, and both are stated on the report itself:
 *
 *   - Depth-chart role. Historical depth charts are not published, so the
 *     lead player at each position is taken to be whoever had the most
 *     opportunities per game (attempts / carries+targets / targets) over
 *     the weeks before.
 *   - Game context. The app scales by its own projected team total and
 *     margin; replaying that model week by week is out of scope here, so
 *     each game's real pre-kickoff market total and spread stand in for it
 *     where available (neutral otherwise).
 */

import {
  projectVolume, VOLUME_MARKETS, projectAnytimeTouchdowns, normaliseField, expectedTouchdowns, teamGameData
} from './props.js'
import { quantileFor } from './distributions.js'
import { isMainPlayer } from './card.js'
import { boardMarketsFor, isBoardWorthy } from './playerBoard.js'

const STATS = ['passingYards', 'passingAttempts', 'passingTouchdowns', 'rushingYards', 'rushingAttempts', 'receivingYards', 'receptions', 'targets']

/** Season-to-date totals in the shape the bundled snapshot uses. */
export function totalsOf(rows) {
  const t = { games: rows.length, tds: 0 }
  for (const s of STATS) t[s] = 0
  for (const r of rows) {
    for (const s of STATS) t[s] += r[s] ?? 0
    t.tds += (r.rushTds ?? 0) + (r.recTds ?? 0)
  }
  return t
}

const opportunity = (position, t) =>
  !t || !t.games ? 0
    : position === 'QB' ? t.passingAttempts / t.games
    : position === 'RB' ? (t.rushingAttempts + t.targets) / t.games
    : t.targets / t.games

const byId = (rows) => {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.id)) map.set(r.id, [])
    map.get(r.id).push(r)
  }
  return map
}

/**
 * Every (week, player who played) with only pre-week information attached.
 *
 * @param {Array} weeks       this season's player-week rows:
 *   { id, name, position, week, team, opp, passingYards, passingAttempts,
 *     passingTouchdowns, rushingYards, rushingAttempts, rushTds,
 *     receivingYards, receptions, targets, recTds }
 * @param {Array} priorWeeks  last season's rows, same shape
 * @param {Array} games       this season's finished games:
 *   { week, home, away, homeScore, awayScore, spread, total }
 */
export function buildGradingCases({ weeks, priorWeeks = [], games = [], minWeek = 2 }) {
  const priorTotals = new Map([...byId(priorWeeks)].map(([id, rows]) => [id, totalsOf(rows)]))
  const maxWeek = weeks.reduce((m, r) => Math.max(m, r.week), 0)

  const cases = []
  for (let W = minWeek; W <= maxWeek; W++) {
    const before = byId(weeks.filter((r) => r.week < W))

    const teamPoints = {}
    for (const g of games) {
      if (g.week >= W) continue
      for (const [team, scored] of [[g.home, g.homeScore], [g.away, g.awayScore]]) {
        const e = (teamPoints[team] ??= { games: 0, points: 0 })
        e.games++
        e.points += scored
      }
    }

    const groups = {}
    for (const r of weeks) {
      if (r.week !== W) continue
      const rows = before.get(r.id) ?? []
      const current = rows.length ? totalsOf(rows) : null
      const prior = priorTotals.get(r.id) ?? null
      const stats = current ?? prior
      const c = {
        week: W, name: r.name, position: r.position, team: r.team, opp: r.opp, actual: r,
        stats, tds: stats?.tds ?? 0,
        statsPriorSeason: !current && !!prior,
        priorStats: current && prior ? prior : undefined,
        opportunity: opportunity(r.position, stats),
        teamAverage: teamPoints[r.team]?.games ? teamPoints[r.team].points / teamPoints[r.team].games : 22
      }
      const game = games.find((g) => g.week === W && (g.home === r.team || g.away === r.team))
      if (game && Number.isFinite(game.total) && game.total > 0 && Number.isFinite(game.spread)) {
        const sign = game.home === r.team ? 1 : -1
        c.teamPoints = game.total / 2 + (sign * game.spread) / 2
        c.marginForTeam = sign * game.spread
      } else {
        c.teamPoints = c.teamAverage
      }
      ;(groups[`${r.team}|${r.position}`] ??= []).push(c)
      cases.push(c)
    }

    for (const [key, list] of Object.entries(groups)) {
      const group = key.split('|')[1]
      list.sort((a, b) => b.opportunity - a.opportunity)
      list.forEach((c, i) => {
        c.role = group === 'QB' ? (i === 0 ? 'QB' : 'QB2')
          : i === 0 ? `${group}1`
          : i === 1 ? `${group}2`
          : i === 2 && group === 'WR' ? 'WR3'
          : group
      })
    }
  }
  return cases
}

const LINE_MULTIPLES = [0.6, 0.8, 1, 1.2, 1.5]
const isCount = (market) => market === 'receptions' || market === 'rushingAttempts'
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const newBuckets = () => Array.from({ length: 10 }, () => ({ n: 0, predicted: 0, hit: 0 }))

function summariseBuckets(buckets) {
  const total = buckets.reduce((s, b) => s + b.n, 0)
  return {
    // Average distance between the chance stated and how often it happened.
    gap: total ? round(buckets.reduce((s, b) => s + Math.abs(b.predicted - b.hit), 0) / total, 4) : null,
    buckets: buckets.filter((b) => b.n >= 20).map((b) => ({
      predicted: round(b.predicted / b.n, 3), actual: round(b.hit / b.n, 3), n: b.n
    }))
  }
}

/**
 * Score the board's own lines (main players, the markets the board shows)
 * and the touchdown chances.
 *
 * @param {Array} cases  buildGradingCases() output
 * @returns {{ playerWeeks, markets, touchdowns }}
 */
export function gradeProps(cases) {
  const markets = {}
  let playerWeeks = 0

  for (const c of cases) {
    if (!isMainPlayer(c.role)) continue
    let counted = false
    for (const key of boardMarketsFor(c.role)) {
      const market = VOLUME_MARKETS.find((m) => m.key === key)
      const v = projectVolume(c, market, {
        teamPoints: c.teamPoints, teamAverage: c.teamAverage, marginForTeam: c.marginForTeam
      })
      if (!v || v.synthetic || !isBoardWorthy(key, v.mean)) continue
      const actual = c.actual[market.stat] ?? 0
      const m = (markets[key] ??= {
        label: market.label, n: 0, absError: 0, error: 0, below: 0, inside: 0, above: 0, buckets: newBuckets()
      })
      m.n++
      m.absError += Math.abs(v.mean - actual)
      m.error += v.mean - actual

      // The range exactly as the board prints it: rounded to whole numbers.
      const low = Math.round(quantileFor(key, v.mean, 0.25))
      const high = Math.round(quantileFor(key, v.mean, 0.75))
      if (actual < low) m.below++
      else if (actual > high) m.above++
      else m.inside++

      for (const mult of LINE_MULTIPLES) {
        const line = Math.max(0.5, (isCount(key) ? Math.floor(v.mean * mult) : Math.round(v.mean * mult)) + 0.5)
        const p = v.over(line).win
        const b = m.buckets[Math.min(9, Math.floor(p * 10))]
        b.n++
        b.predicted += p
        b.hit += actual > line ? 1 : 0
      }
      counted = true
    }
    if (counted) playerWeeks++
  }

  // Touchdowns need the whole team's pool in the field, not just its stars.
  const teams = new Map()
  for (const c of cases) {
    const k = `${c.week}|${c.team}`
    if (!teams.has(k)) teams.set(k, [])
    teams.get(k).push(c)
  }
  const td = { n: 0, brier: 0, buckets: newBuckets() }
  for (const list of teams.values()) {
    const team = list[0].team
    const ctx = { [team]: { expectedTds: expectedTouchdowns(list[0].teamPoints), ...teamGameData(list, team) } }
    for (const p of normaliseField(projectAnytimeTouchdowns(list, ctx), ctx)) {
      if (!isMainPlayer(p.role)) continue
      const scored = (p.actual.rushTds ?? 0) + (p.actual.recTds ?? 0) > 0 ? 1 : 0
      td.n++
      td.brier += (p.prob - scored) ** 2
      const b = td.buckets[Math.min(9, Math.floor(p.prob * 10))]
      b.n++
      b.predicted += p.prob
      b.hit += scored
    }
  }

  return {
    playerWeeks,
    markets: Object.fromEntries(Object.entries(markets).map(([key, m]) => [key, {
      label: m.label,
      n: m.n,
      mae: round(m.absError / m.n, 1),
      bias: round(m.error / m.n, 1),
      range: { below: round(m.below / m.n, 3), inside: round(m.inside / m.n, 3), above: round(m.above / m.n, 3) },
      calibration: summariseBuckets(m.buckets)
    }])),
    touchdowns: td.n
      ? { n: td.n, brier: round(td.brier / td.n, 4), calibration: summariseBuckets(td.buckets) }
      : null
  }
}
