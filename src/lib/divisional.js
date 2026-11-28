/**
 * divisional.js — division rivals' head-to-head history, their betting
 * record against the closing line, and how much of it is worth putting
 * into a projection.
 *
 * Every game here is a real, finished NFL game from nflverse's schedule
 * file (nflverse/nfldata games.csv), with the closing spread and total it
 * records for that game. Nothing is filled in: a game with no recorded line
 * counts toward the straight-up record and is left out of every
 * against-the-spread and over/under number, and the count of such games is
 * reported alongside.
 *
 * Seasons start at 2002, the first year of the current eight-division
 * alignment; relocated franchises are kept as one team (Oakland/Las Vegas
 * Raiders, San Diego/Los Angeles Chargers, St. Louis/Los Angeles Rams).
 *
 * How much history should move a projection is measured, not assumed —
 * see fitDivisionalModel(). Each effect is fitted walk-forward against the
 * closing line, shrunk by how uncertain it is, and capped, so a head-to-head
 * streak can never outweigh this season's form, injuries or a quarterback
 * change. When it was last fitted, the only effect that held up was that
 * home field is worth less in division games; head-to-head ATS records and
 * a team's recent divisional ATS form showed no predictive value at all.
 */

import { TEAMS } from '../data/teams.js'
import { winProbFromMargin, impliedProb } from './odds.js'

export const FROM_SEASON = 2002
/** Older meetings count for less: a meeting two seasons back counts half. */
export const HALF_LIFE_SEASONS = 2
/** A meeting played with a different starting QB (or head coach) than now says less about this one. */
export const QB_CHANGE_WEIGHT = 0.6
export const COACH_CHANGE_WEIGHT = 0.8
/** How many recent meetings feed the projection signals. */
export const SIGNAL_MEETINGS = 10
/** Caps on how far history may move a projection, in points. */
export const MAX_MARGIN_SHIFT = 1.5
export const MAX_TOTAL_SHIFT = 1.5
/** A margin of this many points or fewer counts as a close game. */
export const CLOSE_GAME = 7

export const isDivisional = (a, b) => {
  const x = TEAMS[a]
  const y = TEAMS[b]
  return !!x && !!y && a !== b && x.conference === y.conference && x.division === y.division
}

export const pairKey = (a, b) => [a, b].sort().join('|')
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d)
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The bundled history file stores games as rows (see
 * scripts/fetch-division-history.mjs); this turns them back into objects.
 */
export function decodeHistory(file) {
  if (!file?.games) return []
  const cols = file.columns
  const names = file.names ?? []
  const name = (i) => (i == null || i < 0 ? null : names[i] ?? null)
  return file.games.map((row) => {
    const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    return {
      season: r.season,
      postseason: r.type === 'P',
      week: r.week,
      date: r.date,
      home: r.home,
      away: r.away,
      homeScore: r.hs,
      awayScore: r.as,
      spread: r.spread,
      total: r.total,
      homeML: r.hml,
      awayML: r.aml,
      homeQb: name(r.hqb),
      awayQb: name(r.aqb),
      homeCoach: name(r.hc),
      awayCoach: name(r.ac),
      overtime: r.ot === 1,
      neutral: r.neutral === 1
    }
  })
}

/* Perspective helpers. `spread` follows nflverse: points the home team is favoured by (negative = home underdog). */
export const marginFor = (g, team) => (team === g.home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore)
export const pointsFor = (g, team) => (team === g.home ? g.homeScore : g.awayScore)
export const pointsAgainst = (g, team) => (team === g.home ? g.awayScore : g.homeScore)
/** Points the team beat (+) or missed (-) the closing spread by, or null with no line. */
export const atsResidFor = (g, team) => {
  if (g.spread == null) return null
  const homeResid = g.homeScore - g.awayScore - g.spread
  return team === g.home ? homeResid : -homeResid
}
export const totalResid = (g) => (g.total == null ? null : g.homeScore + g.awayScore - g.total)
/** 'fav' | 'dog' | 'pick' | null for one team in one game. */
export const roleFor = (g, team) => {
  if (g.spread == null) return null
  if (g.spread === 0) return 'pick'
  const homeFav = g.spread > 0
  return (team === g.home) === homeFav ? 'fav' : 'dog'
}
const wlt = () => ({ w: 0, l: 0, t: 0 })
const tally = (rec, x) => { if (x > 0) rec.w++; else if (x < 0) rec.l++; else rec.t++ }

/** Every meeting of two teams, newest first. */
export function meetings(games, a, b) {
  return games
    .filter((g) => (g.home === a && g.away === b) || (g.home === b && g.away === a))
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
}

/* ------------------------------------------------------------------ */
/* 1. Head to head                                                      */
/* ------------------------------------------------------------------ */

function resultSummary(list, a, b) {
  const s = {
    games: list.length,
    record: wlt(), // from a's side
    aHome: wlt(),
    aAway: wlt(),
    avgA: null,
    avgB: null,
    avgCombined: null,
    avgWinMargin: null,
    closeGames: 0,
    seasons: list.length ? [list[list.length - 1].season, list[0].season] : null
  }
  if (!list.length) return s
  for (const g of list) {
    const m = marginFor(g, a)
    tally(s.record, m)
    tally(g.home === a ? s.aHome : s.aAway, m)
    if (Math.abs(m) <= CLOSE_GAME) s.closeGames++
  }
  s.avgA = round(avg(list.map((g) => pointsFor(g, a))))
  s.avgB = round(avg(list.map((g) => pointsFor(g, b))))
  s.avgCombined = round(avg(list.map((g) => g.homeScore + g.awayScore)))
  const decided = list.filter((g) => g.homeScore !== g.awayScore)
  s.avgWinMargin = decided.length ? round(avg(decided.map((g) => Math.abs(g.homeScore - g.awayScore)))) : null
  return s
}

/**
 * Head-to-head record from `a`'s side: all meetings, the last 5 and 10,
 * and regular season and playoffs kept apart.
 */
export function headToHead(list, a, b) {
  const regular = list.filter((g) => !g.postseason)
  return {
    all: resultSummary(list, a, b),
    last5: resultSummary(list.slice(0, 5), a, b),
    last10: resultSummary(list.slice(0, 10), a, b),
    regular: resultSummary(regular, a, b),
    playoffs: resultSummary(list.filter((g) => g.postseason), a, b),
    last: list[0] ?? null
  }
}

/* ------------------------------------------------------------------ */
/* 2. Betting trends                                                    */
/* ------------------------------------------------------------------ */

const atsRec = () => ({ w: 0, l: 0, p: 0 })
const tallyAts = (rec, resid) => { if (resid > 0) rec.w++; else if (resid < 0) rec.l++; else rec.p++ }

/**
 * Against-the-spread and over/under record over a list of meetings,
 * from `a`'s side where a side matters. Games with no recorded line are
 * counted in `missingSpread` / `missingTotal` and left out of everything
 * else.
 */
export function bettingTrends(list, a, b) {
  const withSpread = list.filter((g) => g.spread != null)
  const withTotal = list.filter((g) => g.total != null)
  const t = {
    games: list.length,
    withSpread: withSpread.length,
    withTotal: withTotal.length,
    missingSpread: list.length - withSpread.length,
    missingTotal: list.length - withTotal.length,
    ats: { [a]: atsRec(), [b]: atsRec() },
    ou: { o: 0, u: 0, p: 0 },
    homeAts: atsRec(),
    roadAts: atsRec(),
    favorite: { ats: atsRec(), su: wlt(), n: 0 },
    underdog: { ats: atsRec(), su: wlt(), n: 0 },
    pickem: 0,
    avgFavSpread: null,
    avgFavMargin: null,
    avgTotal: null,
    avgCombined: null,
    overPct: null,
    underPct: null,
    roles: {}
  }
  for (const team of [a, b]) {
    t.roles[team] = Object.fromEntries(['homeFav', 'roadFav', 'homeDog', 'roadDog'].map((k) => [k, { n: 0, su: wlt(), ats: atsRec() }]))
  }

  const favSpreads = []
  const favMargins = []
  for (const g of withSpread) {
    tallyAts(t.ats[a], atsResidFor(g, a))
    tallyAts(t.ats[b], atsResidFor(g, b))
    tallyAts(t.homeAts, atsResidFor(g, g.home))
    tallyAts(t.roadAts, atsResidFor(g, g.away))
    if (g.spread === 0) { t.pickem++; continue }
    const fav = g.spread > 0 ? g.home : g.away
    const dog = fav === g.home ? g.away : g.home
    t.favorite.n++
    t.underdog.n++
    tallyAts(t.favorite.ats, atsResidFor(g, fav))
    tallyAts(t.underdog.ats, atsResidFor(g, dog))
    tally(t.favorite.su, marginFor(g, fav))
    tally(t.underdog.su, marginFor(g, dog))
    favSpreads.push(Math.abs(g.spread))
    favMargins.push(marginFor(g, fav))
    for (const team of [a, b]) {
      const role = roleFor(g, team)
      const key = `${team === g.home ? 'home' : 'road'}${role === 'fav' ? 'Fav' : 'Dog'}`
      const r = t.roles[team][key]
      r.n++
      tally(r.su, marginFor(g, team))
      tallyAts(r.ats, atsResidFor(g, team))
    }
  }
  t.avgFavSpread = round(avg(favSpreads))
  t.avgFavMargin = round(avg(favMargins))

  for (const g of withTotal) {
    const r = totalResid(g)
    if (r > 0) t.ou.o++
    else if (r < 0) t.ou.u++
    else t.ou.p++
  }
  t.avgTotal = round(avg(withTotal.map((g) => g.total)))
  t.avgCombined = round(avg(withTotal.map((g) => g.homeScore + g.awayScore)))
  const decidedOu = t.ou.o + t.ou.u
  t.overPct = decidedOu ? round(t.ou.o / decidedOu, 3) : null
  t.underPct = decidedOu ? round(t.ou.u / decidedOu, 3) : null
  return t
}

/* ------------------------------------------------------------------ */
/* 3. Each team against its whole division                              */
/* ------------------------------------------------------------------ */

/** A team's regular-season record against its own division over a span of seasons. */
export function divisionalRecord(games, team, fromSeason, toSeason) {
  const list = games.filter((g) => !g.postseason && g.season >= fromSeason && g.season <= toSeason &&
    (g.home === team || g.away === team) && isDivisional(g.home, g.away))
  const r = {
    seasons: [fromSeason, toSeason],
    games: list.length,
    record: wlt(),
    ats: atsRec(),
    ou: { o: 0, u: 0, p: 0 },
    withSpread: 0,
    withTotal: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    avgFor: null,
    avgAgainst: null
  }
  for (const g of list) {
    tally(r.record, marginFor(g, team))
    r.pointsFor += pointsFor(g, team)
    r.pointsAgainst += pointsAgainst(g, team)
    const resid = atsResidFor(g, team)
    if (resid != null) { r.withSpread++; tallyAts(r.ats, resid) }
    const tr = totalResid(g)
    if (tr != null) {
      r.withTotal++
      if (tr > 0) r.ou.o++
      else if (tr < 0) r.ou.u++
      else r.ou.p++
    }
  }
  r.avgFor = list.length ? round(r.pointsFor / list.length) : null
  r.avgAgainst = list.length ? round(r.pointsAgainst / list.length) : null
  return r
}

/** This season, last season and the last three, for one team. */
export function recentDivisional(games, team, season) {
  return {
    current: divisionalRecord(games, team, season, season),
    previous: divisionalRecord(games, team, season - 1, season - 1),
    last3: divisionalRecord(games, team, season - 2, season)
  }
}

/* ------------------------------------------------------------------ */
/* 4. Patterns                                                          */
/* ------------------------------------------------------------------ */

const recText = (r) => (r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`)
const atsText = (r) => (r.p ? `${r.w}-${r.l}-${r.p}` : `${r.w}-${r.l}`)

/**
 * Notable shapes in a rivalry, each with its sample size. These describe
 * what happened; they are not predictions — the projection uses only what
 * fitDivisionalModel() measured, and the tab says so next to them.
 *
 * @param {Array} list     meetings of a and b, newest first
 * @param {Array} games    every divisional game (for each team's home/road split)
 * @param {number} season  the season being played now
 * @param {object} base    league-wide divisional base rates (closeRate)
 */
export function matchupPatterns(list, a, b, games, season, base = {}) {
  const out = []
  const recent = list.slice(0, 10)

  // Struggles against this rival.
  if (recent.length >= 6) {
    for (const [team, other] of [[a, b], [b, a]]) {
      const r = wlt()
      for (const g of recent) tally(r, marginFor(g, team))
      if (r.w / recent.length <= 0.3) {
        out.push({ kind: 'struggles', team, n: recent.length, text: `${team} has won ${r.w} of the last ${recent.length} meetings with ${other} (${recText(r)}).` })
      }
      const withLine = recent.filter((g) => g.spread != null)
      if (withLine.length >= 6) {
        const ats = atsRec()
        for (const g of withLine) tallyAts(ats, atsResidFor(g, team))
        if (ats.w / withLine.length <= 0.3) {
          out.push({ kind: 'struggles-ats', team, n: withLine.length, text: `${team} has covered ${ats.w} of the last ${withLine.length} meetings with a line (${atsText(ats)} ATS).` })
        }
      }
    }
  }

  // Better at home against the division (last three seasons, every division opponent).
  for (const team of [a, b]) {
    const list3 = games.filter((g) => !g.postseason && g.season >= season - 2 && g.season <= season &&
      (g.home === team || g.away === team) && isDivisional(g.home, g.away))
    const home = list3.filter((g) => g.home === team)
    const road = list3.filter((g) => g.away === team)
    if (home.length >= 4 && road.length >= 4) {
      const hw = home.filter((g) => marginFor(g, team) > 0).length
      const rw = road.filter((g) => marginFor(g, team) > 0).length
      const gap = hw / home.length - rw / road.length
      if (Math.abs(gap) >= 0.25) {
        out.push({
          kind: gap > 0 ? 'home-strong' : 'road-strong',
          team,
          n: list3.length,
          text: `${team} is ${hw}-${home.length - hw} at home and ${rw}-${road.length - rw} on the road against the division over the last three seasons.`
        })
      }
    }
  }

  // Close games.
  if (recent.length >= 5) {
    const close = recent.filter((g) => Math.abs(g.homeScore - g.awayScore) <= CLOSE_GAME).length
    const rate = close / recent.length
    const league = base.closeRate
    if (rate >= 0.6) {
      out.push({ kind: 'close', n: recent.length, text: `${close} of the last ${recent.length} meetings were decided by ${CLOSE_GAME} points or fewer${league != null ? ` (league-wide division games: ${Math.round(league * 100)}%)` : ''}.` })
    } else if (rate <= 0.2) {
      out.push({ kind: 'lopsided', n: recent.length, text: `Only ${close} of the last ${recent.length} meetings were decided by ${CLOSE_GAME} points or fewer${league != null ? ` (league-wide division games: ${Math.round(league * 100)}%)` : ''}.` })
    }
  }

  // Scoring against the closing total.
  const withTotal = recent.filter((g) => g.total != null)
  if (withTotal.length >= 5) {
    const diff = avg(withTotal.map((g) => totalResid(g)))
    const overs = withTotal.filter((g) => totalResid(g) > 0).length
    const unders = withTotal.filter((g) => totalResid(g) < 0).length
    if (diff >= 4 || overs / withTotal.length >= 0.7) {
      out.push({ kind: 'high-scoring', n: withTotal.length, text: `The last ${withTotal.length} meetings with a total went over ${overs} times, averaging ${round(diff)} points above the closing total.` })
    } else if (diff <= -4 || unders / withTotal.length >= 0.7) {
      out.push({ kind: 'low-scoring', n: withTotal.length, text: `The last ${withTotal.length} meetings with a total went under ${unders} times, averaging ${round(-diff)} points below the closing total.` })
    }
  }

  // Recent results running against the older history.
  if (recent.length >= 8) {
    const newer = recent.slice(0, 4)
    const older = recent.slice(4)
    const rate = (l) => l.filter((g) => marginFor(g, a) > 0).length / l.length
    const nr = rate(newer)
    const or = rate(older)
    if ((nr >= 0.75 && or <= 0.34) || (nr <= 0.25 && or >= 0.66)) {
      const winner = nr >= 0.75 ? a : b
      const loser = winner === a ? b : a
      out.push({
        kind: 'shift',
        team: winner,
        n: recent.length,
        text: `Turned around: ${winner} has won ${winner === a ? newer.filter((g) => marginFor(g, a) > 0).length : newer.filter((g) => marginFor(g, b) > 0).length} of the last 4 meetings after ${loser} won most of the ${older.length} before.`
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 5. Signals, fitting and the projection adjustment                    */
/* ------------------------------------------------------------------ */

/**
 * How much one past meeting should count toward a game: halves every
 * HALF_LIFE_SEASONS, and counts less when either side had a different
 * starting quarterback or head coach than it has now.
 *
 * @param {object} m        the past meeting
 * @param {number} season   the season being projected
 * @param {object} current  { [team]: { qb, coach } } for the two teams now
 */
export function meetingWeight(m, season, current = {}) {
  let w = 0.5 ** ((season - m.season) / HALF_LIFE_SEASONS)
  for (const side of ['home', 'away']) {
    const team = m[side]
    const now = current[team]
    if (!now) continue
    const qb = m[`${side}Qb`]
    const coach = m[`${side}Coach`]
    if (now.qb && qb && now.qb !== qb) w *= QB_CHANGE_WEIGHT
    if (now.coach && coach && now.coach !== coach) w *= COACH_CHANGE_WEIGHT
  }
  return w
}

/**
 * The two head-to-head numbers the projection can use, recency- and
 * roster-weighted over the last SIGNAL_MEETINGS meetings that had a line:
 * how far `team` has beaten the closing spread on average, and how far
 * the games have run over the closing total.
 *
 * @param {Array} prior  meetings before the game, newest first
 */
export function pairSignal(prior, team, season, current = {}) {
  const withLine = prior.filter((g) => g.spread != null && g.total != null).slice(0, SIGNAL_MEETINGS)
  if (withLine.length < 3) return { n: withLine.length, atsResid: null, totalResid: null, margin: null }
  let ws = 0
  let ats = 0
  let tot = 0
  let mar = 0
  for (const g of withLine) {
    const w = meetingWeight(g, season, current)
    ws += w
    ats += w * atsResidFor(g, team)
    tot += w * totalResid(g)
    mar += w * marginFor(g, team)
  }
  return { n: withLine.length, atsResid: ats / ws, totalResid: tot / ws, margin: mar / ws, weight: ws }
}

/** A team's average against-the-spread result in division games over this and the two prior seasons, before `date`. */
export function teamDivisionForm(games, team, season, date) {
  const list = games.filter((g) => !g.postseason && g.season >= season - 2 && g.season <= season && g.date < date &&
    (g.home === team || g.away === team) && isDivisional(g.home, g.away) && g.spread != null)
  if (list.length < 6) return { n: list.length, atsResid: null }
  return { n: list.length, atsResid: avg(list.map((g) => atsResidFor(g, team))) }
}

function ols(x, y) {
  const n = x.length
  if (n < 30) return { b: 0, se: null, n }
  const mx = avg(x)
  const my = avg(y)
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my) }
  const b = sxy / sxx
  let sse = 0
  for (let i = 0; i < n; i++) sse += (y[i] - my - b * (x[i] - mx)) ** 2
  return { b, se: Math.sqrt(sse / (n - 2) / sxx), n }
}

/** Pull a fitted effect toward zero by how uncertain it is: a clear effect keeps most of itself, noise keeps almost none. */
export const shrink = (b, se) => (se == null || !Number.isFinite(se) || b === 0 ? 0 : b * (b * b) / (b * b + se * se))

const meanSe = (xs) => {
  const m = avg(xs)
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1))
  return { mean: m, se: sd / Math.sqrt(xs.length), n: xs.length }
}

/**
 * Measure, walk-forward against the closing line, what divisional history
 * actually adds — and fit how much of it the projection should use.
 *
 * Each test asks whether the thing explains how far a game finished from
 * its closing spread or total, using only meetings played before it:
 *
 *   homeField  — division home teams vs. every other home team
 *   h2hSpread  — the recency/roster-weighted head-to-head ATS margin
 *   teamForm   — each side's divisional ATS margin over three seasons
 *   h2hTotal   — how far the rivalry's recent games ran over the total
 *
 * @param {Array} allGames every finished game since FROM_SEASON (not only
 *   divisional ones; the home-field test needs the rest for comparison),
 *   each with `divisional` set.
 */
export function fitDivisionalModel(allGames, { fromSeason = FROM_SEASON + 4 } = {}) {
  const lined = allGames.filter((g) => !g.postseason && !g.neutral && g.spread != null)
  const div = lined.filter((g) => g.divisional)
  const non = lined.filter((g) => !g.divisional)
  const homeResid = (g) => atsResidFor(g, g.home)
  const d = meanSe(div.map(homeResid))
  const o = meanSe(non.map(homeResid))
  const diff = d.mean - o.mean
  const diffSe = Math.sqrt(d.se ** 2 + o.se ** 2)

  // Walk-forward head-to-head and form signals.
  const divAll = allGames.filter((g) => g.divisional).sort((x, y) => (x.date < y.date ? -1 : 1))
  const byPair = new Map()
  const xs = { ats: [], form: [], tot: [] }
  const ys = { ats: [], form: [], tot: [] }
  for (const g of divAll) {
    const key = pairKey(g.home, g.away)
    const prior = byPair.get(key) ?? []
    if (g.season >= fromSeason && !g.postseason && g.spread != null && g.total != null) {
      const current = { [g.home]: { qb: g.homeQb, coach: g.homeCoach }, [g.away]: { qb: g.awayQb, coach: g.awayCoach } }
      const sig = pairSignal(prior, g.home, g.season, current)
      if (sig.atsResid != null) {
        xs.ats.push(sig.atsResid); ys.ats.push(atsResidFor(g, g.home))
        xs.tot.push(sig.totalResid); ys.tot.push(totalResid(g))
      }
      const fh = teamDivisionForm(divAll, g.home, g.season, g.date)
      const fa = teamDivisionForm(divAll, g.away, g.season, g.date)
      if (fh.atsResid != null && fa.atsResid != null) { xs.form.push(fh.atsResid - fa.atsResid); ys.form.push(atsResidFor(g, g.home)) }
    }
    prior.unshift(g)
    byPair.set(key, prior)
  }
  const fit = (x, y) => {
    const r = ols(x, y)
    return { coefficient: round(r.b, 4), se: round(r.se, 4), n: r.n, applied: round(shrink(r.b, r.se), 4) }
  }

  const cover = (list, side) => {
    let w = 0; let l = 0
    for (const g of list) { const r = atsResidFor(g, side(g)); if (r > 0) w++; else if (r < 0) l++ }
    return w + l ? round(w / (w + l), 3) : null
  }
  const divWithTotal = div.filter((g) => g.total != null)
  const overs = divWithTotal.filter((g) => totalResid(g) > 0).length
  const unders = divWithTotal.filter((g) => totalResid(g) < 0).length
  const decidedDiv = div.filter((g) => g.homeScore !== g.awayScore)

  return {
    homeField: {
      divisionalHomeResid: round(d.mean, 2),
      otherHomeResid: round(o.mean, 2),
      effect: round(diff, 2),
      se: round(diffSe, 2),
      n: d.n,
      nOther: o.n,
      applied: round(shrink(diff, diffSe), 2)
    },
    h2hSpread: fit(xs.ats, ys.ats),
    teamForm: fit(xs.form, ys.form),
    h2hTotal: fit(xs.tot, ys.tot),
    baseRates: {
      games: div.length,
      homeCover: cover(div, (g) => g.home),
      otherHomeCover: cover(non, (g) => g.home),
      dogCover: cover(div.filter((g) => g.spread !== 0), (g) => (g.spread > 0 ? g.away : g.home)),
      overPct: overs + unders ? round(overs / (overs + unders), 3) : null,
      closeRate: decidedDiv.length ? round(div.filter((g) => Math.abs(g.homeScore - g.awayScore) <= CLOSE_GAME).length / div.length, 3) : null
    }
  }
}

/**
 * The shift divisional history makes to one game's projection, from the
 * fitted model in division-model.json. Null for anything that is not a
 * regular-season division game the model has numbers for.
 *
 * @returns {{ marginShift, totalShift, parts: Array<{ key, label, points, on: 'margin'|'total' }> } | null}
 */
export function divisionalAdjustment(game, model) {
  if (!model?.fit || game.preseason || !isDivisional(game.home, game.away)) return null
  const { fit } = model
  const parts = []
  if (!game.neutral && fit.homeField?.applied) {
    parts.push({ key: 'homeField', label: 'Smaller home field in division games', points: fit.homeField.applied, on: 'margin' })
  }
  const pair = model.pairs?.[pairKey(game.home, game.away)]
  if (pair && pair.atsResid != null) {
    const atsHome = game.home === pair.team ? pair.atsResid : -pair.atsResid
    if (fit.h2hSpread?.applied) {
      parts.push({ key: 'h2hSpread', label: 'Head-to-head results against the spread', points: clamp(fit.h2hSpread.applied * atsHome, -1, 1), on: 'margin' })
    }
    if (fit.h2hTotal?.applied && pair.totalResid != null) {
      parts.push({ key: 'h2hTotal', label: 'Head-to-head scoring against the total', points: clamp(fit.h2hTotal.applied * pair.totalResid, -MAX_TOTAL_SHIFT, MAX_TOTAL_SHIFT), on: 'total' })
    }
  }
  const fh = model.teamForm?.[game.home]
  const fa = model.teamForm?.[game.away]
  if (fit.teamForm?.applied && fh?.atsResid != null && fa?.atsResid != null) {
    parts.push({ key: 'teamForm', label: 'Recent divisional form against the spread', points: clamp(fit.teamForm.applied * (fh.atsResid - fa.atsResid), -1, 1), on: 'margin' })
  }
  const sum = (on) => parts.filter((p) => p.on === on).reduce((s, p) => s + p.points, 0)
  const marginShift = round(clamp(sum('margin'), -MAX_MARGIN_SHIFT, MAX_MARGIN_SHIFT), 2)
  const totalShift = round(clamp(sum('total'), -MAX_TOTAL_SHIFT, MAX_TOTAL_SHIFT), 2)
  return { marginShift, totalShift, parts: parts.map((p) => ({ ...p, points: round(p.points, 2) })) }
}

/**
 * Fold the divisional shift into a projection, the same way the injury
 * adjustment does: margin, total, both team totals and the win
 * probability all move together, and the shift itself is kept on the
 * projection (`divisional`) so every view can say what history added.
 */
export function applyDivisionalAdjustment(game, projection, model, s = {}) {
  if (!projection) return projection
  const adj = divisionalAdjustment(game, model)
  if (!adj) return projection
  const margin = projection.margin + adj.marginShift
  const total = Math.round((projection.total + adj.totalShift) * 2) / 2
  const homeWinProb = winProbFromMargin(margin, s.marginSigma ?? 13.2)
  return {
    ...projection,
    margin,
    modelSpreadHome: -margin,
    modelSpreadAway: margin,
    total,
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    homeTeamTotal: Math.round(((total + margin) / 2) * 2) / 2,
    awayTeamTotal: Math.round(((total - margin) / 2) * 2) / 2,
    divisional: adj
  }
}

/* ------------------------------------------------------------------ */
/* 6. Bets: the line, the model, and what history says                  */
/* ------------------------------------------------------------------ */

/**
 * The line to measure against: a real sportsbook consensus when the app
 * has one (an Odds API key), otherwise the line nflverse's schedule file
 * carries for the game (updated daily, real but not live). Never the
 * app's simulated prices.
 *
 * @returns {{ spread, total, homeML, awayML, source } | null}  spread = points the home team is favoured by
 */
export function lineFor(game, model) {
  const m = game.market
  const posted = (model?.upcoming ?? []).find((u) => u.home === game.home && u.away === game.away &&
    (!game.kickoff || !u.date || Math.abs(new Date(game.kickoff) - new Date(`${u.date}T12:00:00Z`)) < 4 * 86400e3))
  if (m && !m.simulated && m.consensus?.spreadHome != null) {
    return {
      spread: -m.consensus.spreadHome,
      total: m.consensus.total ?? posted?.total ?? null,
      homeML: posted?.homeML ?? null,
      awayML: posted?.awayML ?? null,
      source: 'Sportsbook consensus (live)'
    }
  }
  if (posted && (posted.spread != null || posted.total != null)) {
    return { spread: posted.spread, total: posted.total, homeML: posted.homeML, awayML: posted.awayML, source: 'Sportsbook line from nflverse schedule data (updated daily)' }
  }
  return null
}

const LEVELS = ['low', 'medium', 'high']
const minLevel = (a, b) => LEVELS[Math.min(LEVELS.indexOf(a), LEVELS.indexOf(b))]
const edgeLevel = (edge, [low, med, high]) => (edge < low ? null : edge >= high ? 'high' : edge >= med ? 'medium' : 'low')

/**
 * Separate confidence for the moneyline, spread and total.
 *
 * Confidence comes from the projection's own edge over the line, capped by
 * the game's overall confidence (confidence.js — model agreement, sample
 * size, injuries, QB status). Divisional history enters only through the
 * measured shift already inside the projection; the head-to-head record is
 * reported beside each bet as "supports" or "contradicts" but cannot raise
 * a confidence level on its own.
 *
 * @param {object} opts
 * @param {object} opts.game        dataset game
 * @param {object} opts.projection  the adjusted projection (with .divisional)
 * @param {object|null} opts.line   lineFor() output
 * @param {Array} opts.list         meetings of the two teams, newest first
 * @param {object} opts.model       division-model.json
 * @param {string} opts.baseLevel   the game's overall confidence level
 */
export function assessBets({ game, projection, line, list, model, baseLevel = 'medium' }) {
  const { home, away } = game
  const cap = LEVELS.includes(baseLevel) ? baseLevel : 'medium'
  const adj = projection?.divisional ?? null
  const marginPart = adj?.marginShift ?? 0
  const recent = list.slice(0, 10)
  const out = {}

  // Moneyline.
  {
    const a = { market: 'moneyline', available: !!projection }
    if (projection) {
      a.modelHome = projection.homeWinProb
      if (line?.homeML != null && line?.awayML != null) {
        const ph = impliedProb(line.homeML)
        const pa = impliedProb(line.awayML)
        a.marketHome = ph / (ph + pa)
        const edge = a.modelHome - a.marketHome
        a.pick = edge >= 0 ? home : away
        a.edge = Math.abs(edge)
        const lvl = edgeLevel(a.edge, [0.03, 0.05, 0.08])
        a.level = lvl ? minLevel(lvl, cap) : 'no edge'
      } else {
        a.pick = projection.homeWinProb >= 0.5 ? home : away
        a.level = 'no line'
      }
      const side = a.pick
      const su = wlt()
      for (const g of recent) tally(su, marginFor(g, side))
      const rate = recent.length ? su.w / recent.length : null
      a.history = {
        lean: recent.length < 4 ? 'none' : rate >= 0.6 ? 'supports' : rate <= 0.4 ? 'contradicts' : 'neutral',
        text: recent.length ? `${side} is ${recText(su)} in the last ${recent.length} meetings.` : 'No previous meetings on record.'
      }
      a.historyPoints = side === home ? marginPart : -marginPart
    }
    out.moneyline = a
  }

  // Spread.
  {
    const a = { market: 'spread', available: !!projection }
    if (projection) {
      a.modelMargin = projection.margin
      if (line?.spread != null) {
        a.lineMargin = line.spread
        const edge = projection.margin - line.spread
        a.pick = edge >= 0 ? home : away
        a.edge = Math.abs(edge)
        const lvl = edgeLevel(a.edge, [1.5, 2.5, 4])
        a.level = lvl ? minLevel(lvl, cap) : 'no edge'
      } else {
        a.pick = projection.margin >= 0 ? home : away
        a.level = 'no line'
      }
      const side = a.pick
      const withLine = recent.filter((g) => g.spread != null)
      const ats = atsRec()
      for (const g of withLine) tallyAts(ats, atsResidFor(g, side))
      const decided = ats.w + ats.l
      const rate = decided ? ats.w / decided : null
      const avgMargin = avg(recent.map((g) => marginFor(g, side)))
      let text = withLine.length
        ? `${side} is ${atsText(ats)} against the spread in the last ${withLine.length} meetings with a line`
        : 'No previous meetings with a recorded line'
      if (avgMargin != null && line?.spread != null) {
        const lineForSide = side === home ? line.spread : -line.spread
        text += `; it has averaged ${avgMargin >= 0 ? 'winning' : 'losing'} by ${Math.abs(round(avgMargin))} in them, and today's line has it ${lineForSide >= 0 ? `favoured by ${Math.abs(lineForSide)}` : `getting ${Math.abs(lineForSide)}`}`
      }
      a.history = {
        lean: decided < 4 ? 'none' : rate >= 0.6 ? 'supports' : rate <= 0.4 ? 'contradicts' : 'neutral',
        text: `${text}.`
      }
      a.historyPoints = side === home ? marginPart : -marginPart
    }
    out.spread = a
  }

  // Total.
  {
    const a = { market: 'total', available: !!projection }
    if (projection) {
      a.modelTotal = projection.total
      if (line?.total != null) {
        a.lineTotal = line.total
        const edge = projection.total - line.total
        a.pick = edge >= 0 ? 'over' : 'under'
        a.edge = Math.abs(edge)
        const lvl = edgeLevel(a.edge, [2, 3, 5])
        a.level = lvl ? minLevel(lvl, cap) : 'no edge'
      } else {
        a.pick = null
        a.level = 'no line'
      }
      const withTotal = recent.filter((g) => g.total != null)
      const overs = withTotal.filter((g) => totalResid(g) > 0).length
      const unders = withTotal.filter((g) => totalResid(g) < 0).length
      const avgCombined = avg(recent.map((g) => g.homeScore + g.awayScore))
      const decided = overs + unders
      const overRate = decided ? overs / decided : null
      const supportsOver = overRate != null && overRate >= 0.6
      const supportsUnder = overRate != null && overRate <= 0.4
      let lean = 'none'
      if (decided >= 4 && a.pick) {
        lean = (a.pick === 'over' && supportsOver) || (a.pick === 'under' && supportsUnder) ? 'supports'
          : (a.pick === 'over' && supportsUnder) || (a.pick === 'under' && supportsOver) ? 'contradicts'
          : 'neutral'
      }
      let text = withTotal.length
        ? `The last ${withTotal.length} meetings with a total went over ${overs} and under ${unders} times`
        : 'No previous meetings with a recorded total'
      if (avgCombined != null) text += `, averaging ${round(avgCombined)} combined points${line?.total != null ? ` against today's ${line.total}` : ''}`
      a.history = { lean, text: `${text}.` }
      const tShift = adj?.totalShift ?? 0
      a.historyPoints = a.pick === 'under' ? -tShift : tShift
    }
    out.total = a
  }

  out.measuredNote = model?.fit ? measuredNote(model.fit) : null
  return out
}

/** One plain sentence per measured effect, for the tab. */
export function measuredNote(fit) {
  const lines = []
  const hf = fit.homeField
  if (hf) {
    lines.push(`Home field: division home teams finished ${Math.abs(hf.divisionalHomeResid)} points ${hf.divisionalHomeResid < 0 ? 'short of' : 'past'} the closing spread on average (${hf.n} games) against ${Math.abs(hf.otherHomeResid)} ${hf.otherHomeResid < 0 ? 'short of' : 'past'} it for every other home team (${hf.nOther}). After shrinking for uncertainty that is worth ${hf.applied} points to the home side, and it is in the projection.`)
  }
  const sig = (f) => (f.se ? Math.abs(f.coefficient) / f.se : 0)
  const verdict = (f) => (sig(f) >= 2 ? 'a real effect' : sig(f) >= 1.5 ? 'a weak, uncertain effect' : 'no reliable effect')
  if (fit.h2hSpread) lines.push(`Head-to-head ATS record: ${verdict(fit.h2hSpread)} on how the next meeting finishes against the spread (${fit.h2hSpread.n} games; ${fit.h2hSpread.coefficient} ± ${fit.h2hSpread.se} points per point). Weight used: ${fit.h2hSpread.applied}.`)
  if (fit.teamForm) lines.push(`Recent divisional ATS form: ${verdict(fit.teamForm)} (${fit.teamForm.n} games; ${fit.teamForm.coefficient} ± ${fit.teamForm.se}). Weight used: ${fit.teamForm.applied}.`)
  if (fit.h2hTotal) lines.push(`Head-to-head scoring against the total: ${verdict(fit.h2hTotal)} (${fit.h2hTotal.n} games; ${fit.h2hTotal.coefficient} ± ${fit.h2hTotal.se}${fit.h2hTotal.coefficient < 0 ? ' — a negative number means rivalries that ran over tended to come in under next time' : ''}). Weight used: ${fit.h2hTotal.applied}.`)
  return lines
}
