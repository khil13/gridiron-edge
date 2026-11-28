/**
 * fetch-division-history.mjs — every division game since 2002, and the
 * fitted numbers that decide how much that history moves a projection.
 *
 * Source: nflverse's schedule file (nflverse/nfldata games.csv) — final
 * scores, the closing spread and total it records for each game, moneylines
 * (from 2006), each side's starting quarterback and head coach, and the
 * lines it posts for games not yet played.
 *
 * Writes:
 *   src/data/generated/division-history.json  every finished division game
 *     (regular season and playoffs), loaded only when a Divisional History
 *     section opens.
 *   src/data/generated/division-model.json  small; bundled with the app.
 *     The walk-forward fit (src/lib/divisional.js fitDivisionalModel), each
 *     rivalry's weighted head-to-head signal as of now, each team's
 *     divisional form, its current QB and coach, and the posted lines for
 *     upcoming division games.
 *
 * Run daily by .github/workflows/update-division-history.yml, so finished
 * games, the fit and the posted lines all stay current. A run that changes
 * nothing but the timestamp leaves both files untouched.
 *
 * Usage: npm run division-history
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FROM_SEASON, isDivisional, pairKey, meetings, pairSignal, teamDivisionForm, fitDivisionalModel
} from '../src/lib/divisional.js'
import { TEAMS } from '../src/data/teams.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
const OUT_DIR = resolve(__dirname, '../src/data/generated')

/** nflverse uses each franchise's code at the time; this app uses today's. */
const FRANCHISE = { OAK: 'LV', SD: 'LAC', STL: 'LA', JAX: 'JAC' }
const team = (t) => FRANCHISE[t] || t

function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const header = rows[0] ?? []
  return rows.slice(1).filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

const num = (v) => (v == null || v === '' || v === 'NA' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v) => (v == null || v === '' || v === 'NA' ? null : v)

const REQUIRED = ['season', 'game_type', 'week', 'gameday', 'away_team', 'home_team', 'away_score', 'home_score', 'location',
  'spread_line', 'total_line', 'away_moneyline', 'home_moneyline', 'overtime', 'away_qb_name', 'home_qb_name', 'away_coach', 'home_coach']

function toGame(r) {
  const home = team(r.home_team)
  const away = team(r.away_team)
  return {
    season: Number(r.season),
    postseason: r.game_type !== 'REG',
    week: Number(r.week),
    date: r.gameday,
    home,
    away,
    homeScore: num(r.home_score),
    awayScore: num(r.away_score),
    spread: num(r.spread_line),
    total: num(r.total_line),
    homeML: num(r.home_moneyline),
    awayML: num(r.away_moneyline),
    homeQb: str(r.home_qb_name),
    awayQb: str(r.away_qb_name),
    homeCoach: str(r.home_coach),
    awayCoach: str(r.away_coach),
    overtime: r.overtime === '1',
    neutral: r.location === 'Neutral',
    divisional: isDivisional(home, away)
  }
}

/** Write `payload` unless the only difference from what is there is the timestamp. */
function writeIfChanged(file, payload) {
  const path = resolve(OUT_DIR, file)
  if (existsSync(path)) {
    try {
      const old = JSON.parse(readFileSync(path, 'utf8'))
      const strip = (o) => JSON.stringify({ ...o, generatedAt: null })
      if (strip(old) === strip(payload)) {
        console.log(`${file}: unchanged`)
        return
      }
    } catch { /* rewrite */ }
  }
  writeFileSync(path, JSON.stringify(payload) + '\n')
  console.log(`Wrote ${path}`)
}

async function main() {
  const res = await fetch(GAMES_URL)
  if (!res.ok) throw new Error(`${GAMES_URL}: HTTP ${res.status}`)
  const rows = parseCSV(await res.text())
  for (const col of REQUIRED) if (!(col in (rows[0] ?? {}))) throw new Error(`games.csv is missing expected column "${col}"`)

  const all = rows.filter((r) => Number(r.season) >= FROM_SEASON).map(toGame)
  for (const g of all) {
    if (!TEAMS[g.home] || !TEAMS[g.away]) throw new Error(`Unknown team code in games.csv: ${g.away} @ ${g.home} (${g.season})`)
  }
  const finished = all.filter((g) => g.homeScore != null && g.awayScore != null)
  const upcomingAll = all.filter((g) => g.homeScore == null)
  const divFinished = finished.filter((g) => g.divisional).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // Cross-check the division mapping against nflverse's own flag.
  const flagged = rows.filter((r) => Number(r.season) >= FROM_SEASON && r.div_game === '1' && r.home_score !== '' && r.home_score !== 'NA').length
  if (Math.abs(flagged - divFinished.length) > 0) {
    console.warn(`Note: nflverse flags ${flagged} finished division games; this app's division table finds ${divFinished.length}.`)
  }

  const throughSeason = finished.reduce((m, g) => Math.max(m, g.season), 0)
  const throughDate = finished.reduce((m, g) => (g.date > m ? g.date : m), '')
  const season = upcomingAll.length ? upcomingAll.reduce((m, g) => Math.max(m, g.season), 0) : throughSeason

  // ---- history file (compact rows, with QB/coach names interned) ----
  const names = []
  const nameIndex = new Map()
  const intern = (s) => {
    if (s == null) return -1
    if (!nameIndex.has(s)) { nameIndex.set(s, names.length); names.push(s) }
    return nameIndex.get(s)
  }
  const columns = ['season', 'type', 'week', 'date', 'home', 'away', 'hs', 'as', 'spread', 'total', 'hml', 'aml', 'hqb', 'aqb', 'hc', 'ac', 'ot', 'neutral']
  const histRows = divFinished.map((g) => [
    g.season, g.postseason ? 'P' : 'R', g.week, g.date, g.home, g.away, g.homeScore, g.awayScore, g.spread, g.total,
    g.homeML, g.awayML, intern(g.homeQb), intern(g.awayQb), intern(g.homeCoach), intern(g.awayCoach), g.overtime ? 1 : 0, g.neutral ? 1 : 0
  ])
  const missing = {
    spread: divFinished.filter((g) => g.spread == null).length,
    total: divFinished.filter((g) => g.total == null).length,
    moneyline: divFinished.filter((g) => g.homeML == null || g.awayML == null).length
  }
  const source = 'nflverse/nfldata games.csv (final scores, closing spread and total, moneylines from 2006, starting QBs and head coaches)'
  writeIfChanged('division-history.json', {
    generatedAt: new Date().toISOString(),
    source,
    fromSeason: FROM_SEASON,
    throughSeason,
    throughDate,
    missing,
    columns,
    names,
    games: histRows
  })

  // ---- model file ----
  const fit = fitDivisionalModel(finished)

  // Each team's current QB and coach: its next scheduled game if nflverse
  // has posted one, otherwise its most recent game.
  const current = {}
  for (const abbr of Object.keys(TEAMS)) {
    const next = upcomingAll.filter((g) => g.home === abbr || g.away === abbr).sort((a, b) => (a.date < b.date ? -1 : 1))[0]
    const last = finished.filter((g) => g.home === abbr || g.away === abbr).sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    const side = (g) => (g.home === abbr ? 'home' : 'away')
    current[abbr] = {
      qb: (next && next[`${side(next)}Qb`]) || (last && last[`${side(last)}Qb`]) || null,
      coach: (next && next[`${side(next)}Coach`]) || (last && last[`${side(last)}Coach`]) || null
    }
  }

  const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d)
  const pairs = {}
  const abbrs = Object.keys(TEAMS).sort()
  for (const a of abbrs) {
    for (const b of abbrs) {
      if (a >= b || !isDivisional(a, b)) continue
      const sig = pairSignal(meetings(divFinished, a, b), a, season, { [a]: current[a], [b]: current[b] })
      pairs[pairKey(a, b)] = { team: a, n: sig.n, atsResid: round(sig.atsResid), totalResid: round(sig.totalResid), margin: round(sig.margin) }
    }
  }
  const teamForm = {}
  for (const abbr of abbrs) {
    const f = teamDivisionForm(divFinished, abbr, season, '9999-12-31')
    teamForm[abbr] = { n: f.n, atsResid: round(f.atsResid) }
  }

  const upcoming = upcomingAll
    .filter((g) => g.divisional && g.season === season)
    .map((g) => ({
      season: g.season, week: g.week, date: g.date, home: g.home, away: g.away,
      spread: g.spread, total: g.total, homeML: g.homeML, awayML: g.awayML, homeQb: g.homeQb, awayQb: g.awayQb
    }))

  writeIfChanged('division-model.json', {
    generatedAt: new Date().toISOString(),
    source,
    fromSeason: FROM_SEASON,
    throughSeason,
    throughDate,
    season,
    divisionGames: divFinished.length,
    fit,
    current,
    pairs,
    teamForm,
    upcoming
  })

  console.log(`Division games ${FROM_SEASON}-${throughSeason}: ${divFinished.length} (missing spread ${missing.spread}, total ${missing.total}, moneyline ${missing.moneyline})`)
  console.log('Home field:', JSON.stringify(fit.homeField))
  console.log('H2H spread:', JSON.stringify(fit.h2hSpread))
  console.log('Team form :', JSON.stringify(fit.teamForm))
  console.log('H2H total :', JSON.stringify(fit.h2hTotal))
  console.log('Base rates:', JSON.stringify(fit.baseRates))
  console.log(`Upcoming division games with posted lines: ${upcoming.filter((u) => u.spread != null).length} of ${upcoming.length}`)
}

mkdirSync(OUT_DIR, { recursive: true })
main().catch((err) => {
  console.error(err)
  process.exit(1)
})
