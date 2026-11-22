/**
 * grade-props.mjs — measure how the player projections have actually done.
 *
 * Fetches nflverse's real week-by-week player stats for the current season
 * (and last season, for the same fallback the app uses), plus each game's
 * real pre-kickoff total and spread, then replays the season week by week
 * through the app's own projection functions (see src/lib/propGrading.js)
 * and writes the result to src/data/generated/prop-accuracy.json — the
 * track record shown on the Card of the day.
 *
 * Run by the same scheduled workflow that refreshes the player stats, so
 * the record stays current without anyone remembering to re-run it.
 *
 * Usage: npm run prop-accuracy
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGradingCases, gradeProps } from '../src/lib/propGrading.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const weeksUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`
const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'

/** nflverse's team codes that don't match this app's own (see playerData.js's ABBR). */
const TEAM_ABBR = { JAX: 'JAC' }
const normTeam = (t) => TEAM_ABBR[t] || t

/** Quote-aware CSV parser — player names can contain commas. */
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
  return rows.slice(1)
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((name, i) => [name, r[i]])))
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const SKILL = new Set(['QB', 'RB', 'FB', 'WR', 'TE'])

async function fetchWeeks(season) {
  const res = await fetch(weeksUrl(season))
  if (!res.ok) return null
  const rows = parseCSV(await res.text())
  if (!rows.length) return null
  for (const col of ['player_id', 'player_display_name', 'position', 'week', 'season_type', 'team', 'opponent_team', 'receiving_yards', 'rushing_yards', 'passing_yards', 'carries', 'targets']) {
    if (!(col in rows[0])) throw new Error(`${weeksUrl(season)} is missing expected column "${col}"`)
  }
  return rows
    .filter((r) => r.season_type === 'REG' && SKILL.has(r.position))
    .map((r) => ({
      id: r.player_id,
      name: r.player_display_name,
      position: r.position === 'FB' ? 'RB' : r.position,
      week: num(r.week),
      team: normTeam(r.team),
      opp: normTeam(r.opponent_team),
      passingYards: num(r.passing_yards), passingAttempts: num(r.attempts), passingTouchdowns: num(r.passing_tds), passingInterceptions: num(r.passing_interceptions),
      rushingYards: num(r.rushing_yards), rushingAttempts: num(r.carries), rushTds: num(r.rushing_tds),
      receivingYards: num(r.receiving_yards), receptions: num(r.receptions), targets: num(r.targets), recTds: num(r.receiving_tds)
    }))
}

/** Finished regular-season games with their pre-kickoff market total and spread. Best-effort. */
async function fetchGames(season) {
  try {
    const res = await fetch(GAMES_URL)
    if (!res.ok) return []
    return parseCSV(await res.text())
      .filter((g) => g.season === String(season) && g.game_type === 'REG' && g.home_score !== '' && g.home_score !== 'NA')
      .map((g) => ({
        week: num(g.week), home: normTeam(g.home_team), away: normTeam(g.away_team),
        homeScore: num(g.home_score), awayScore: num(g.away_score),
        spread: g.spread_line === '' ? NaN : Number(g.spread_line),
        total: g.total_line === '' ? NaN : Number(g.total_line)
      }))
  } catch {
    return []
  }
}

async function main() {
  const clockYear = new Date().getFullYear()
  let season = null
  let weeks = null
  for (const candidate of [clockYear + 1, clockYear, clockYear - 1]) {
    console.log(`Checking ${weeksUrl(candidate)} ...`)
    weeks = await fetchWeeks(candidate)
    if (weeks?.length) { season = candidate; break }
  }
  if (season == null) throw new Error('No weekly player stats found for any recent season.')

  const priorWeeks = (await fetchWeeks(season - 1)) ?? []
  const games = await fetchGames(season)
  const throughWeek = weeks.reduce((m, r) => Math.max(m, r.week), 0)

  const cases = buildGradingCases({ weeks, priorWeeks, games })
  const report = gradeProps(cases)

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/nflverse/nflverse-data (stats_player release) and nflverse/nfldata games.csv',
    season,
    fromWeek: 2,
    throughWeek,
    method: 'Walk-forward: each week projected from only the weeks before it, through the app\'s own projection functions, for each team\'s lead QB, RB, WR and TE. Lead players are identified by prior-weeks opportunity (historical depth charts are not published); game context uses each game\'s real pre-kickoff market total and spread.',
    marketContextGames: games.length,
    ...report
  }

  const outDir = resolve(__dirname, '../src/data/generated')
  mkdirSync(outDir, { recursive: true })
  const out = resolve(outDir, 'prop-accuracy.json')
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
  console.log(`Wrote ${out}`)
  console.log(`Season ${season}, weeks 2-${throughWeek}: ${report.playerWeeks} main-player weeks graded`)
  for (const [key, m] of Object.entries(report.markets)) {
    console.log(`  ${key.padEnd(15)} n=${String(m.n).padStart(4)}  avg miss ${m.mae}  bias ${m.bias}  range held ${(m.range.inside * 100).toFixed(0)}%  calibration gap ${(m.calibration.gap * 100).toFixed(1)} pts`)
  }
  if (report.interceptions) {
    console.log(`  QB throws INT   n=${String(report.interceptions.n).padStart(4)}  avg miss ${report.interceptions.mae}  Brier ${report.interceptions.brier}  calibration gap ${(report.interceptions.calibration.gap * 100).toFixed(1)} pts`)
  }
  if (report.touchdowns) {
    console.log(`  anytime TD      n=${String(report.touchdowns.n).padStart(4)}  Brier ${report.touchdowns.brier}  calibration gap ${(report.touchdowns.calibration.gap * 100).toFixed(1)} pts`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
