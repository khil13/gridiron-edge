/**
 * fetch-injury-report.mjs — the real, official weekly NFL injury report,
 * from nflverse's `injuries` release.
 *
 * Same source family as fetch-player-stats.mjs and fetch-team-efficiency.mjs
 * (https://github.com/nflverse/nflverse-data), one file per season
 * (injuries_<season>.csv), updated as teams file their official reports.
 * Each row is one player's designation for one week: report_status is the
 * real Out/Doubtful/Questionable/blank the NFL requires teams to publish —
 * nothing estimated or inferred here, this is the filing itself.
 *
 * Only the most recent week present in the file is kept (an injury report
 * from three weeks ago is not "current"), and only rows that actually carry
 * one of the three real designations — plenty of rows exist only to record
 * a healthy player's practice participation, which is not an injury report
 * entry by the NFL's own definition and would just be noise here.
 *
 * A QB marked Out is also cross-checked against the season's real passing
 * volume (already bundled by fetch-player-stats.mjs, read from disk here
 * rather than re-fetched) so the app can tell "the starter is out" from
 * "a third-string QB who has never played is out" — only the former is
 * real signal worth moving a projection for, so only the former is written
 * to `starterQbOut`. This runs at build time specifically so the browser
 * never needs to load the much larger player-stats file just to answer
 * that one yes/no question (it already loads it lazily for props, but not
 * on every page, and this should not change that).
 *
 * Run:  npm run injury-report
 * Output: src/data/generated/injury-report.json, bundled at build time like
 * every other generated file — no runtime fetch, no CORS question.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normPropName } from '../src/lib/props.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIN_STARTER_PASS_ATTEMPTS = 20

const seasonUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`

/** nflverse's team codes that don't match this app's own (see playerData.js's ABBR). */
const TEAM_ABBR = { JAX: 'JAC' }
const normTeam = (t) => TEAM_ABBR[t] || t

const REPORTABLE = new Set(['Out', 'Doubtful', 'Questionable'])

function parseCSV(text) {
  // No quoted fields in this release (confirmed against the real file: zero
  // double-quote characters, a constant column count per row), so a plain
  // split is safe and simpler than carrying the quote-aware parser the pbp
  // script needs for its play-description column.
  return text.trim().split('\n').map((line) => line.split(','))
}

async function fetchSeason(season) {
  const url = seasonUrl(season)
  const res = await fetch(url)
  if (!res.ok) return null
  const text = await res.text()
  const rows = parseCSV(text)
  const header = rows[0]
  const col = Object.fromEntries(header.map((name, i) => [name, i]))
  const need = (name) => {
    if (!(name in col)) throw new Error(`${url} is missing expected column "${name}"`)
    return col[name]
  }
  const idx = {
    seasonType: need('season_type'),
    team: need('team'),
    week: need('week'),
    position: need('position'),
    fullName: need('full_name'),
    reportStatus: need('report_status'),
    reportPrimaryInjury: need('report_primary_injury'),
    practiceStatus: need('practice_status')
  }

  let latestWeek = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < header.length) continue
    if (r[idx.seasonType] !== 'REG') continue
    const week = Number(r[idx.week])
    if (Number.isFinite(week) && week > latestWeek) latestWeek = week
  }
  if (!latestWeek) return null

  const teams = {}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < header.length) continue
    if (r[idx.seasonType] !== 'REG') continue
    if (Number(r[idx.week]) !== latestWeek) continue
    const status = r[idx.reportStatus]
    if (!REPORTABLE.has(status)) continue

    const team = normTeam(r[idx.team])
    if (!team) continue
    ;(teams[team] ??= []).push({
      name: r[idx.fullName],
      position: r[idx.position],
      status,
      injury: r[idx.reportPrimaryInjury] || null,
      practiceStatus: r[idx.practiceStatus] || null
    })
  }

  return Object.keys(teams).length ? { week: latestWeek, teams } : null
}

/**
 * Which of this report's "Out" QBs were actually playing meaningful snaps
 * this season, from the already-bundled real per-player stats. Null (not
 * an empty object) when that file isn't there yet, so the caller can tell
 * "checked, nobody qualified" apart from "couldn't check."
 */
function findStarterQbOut(teams) {
  const statsPath = resolve(__dirname, '../src/data/generated/player-stats.json')
  if (!existsSync(statsPath)) return null
  const playerStats = JSON.parse(readFileSync(statsPath, 'utf8'))
  const season = playerStats.seasons?.[playerStats.latestSeason]
  if (!season) return null

  const starterQbOut = {}
  for (const [team, rows] of Object.entries(teams)) {
    for (const r of rows) {
      if (r.position !== 'QB' || r.status !== 'Out') continue
      const stats = season[`${normPropName(r.name)}|QB`]
      if (stats && (stats.passingAttempts ?? 0) >= MIN_STARTER_PASS_ATTEMPTS) {
        starterQbOut[team] = { name: r.name, injury: r.injury }
        break
      }
    }
  }
  return starterQbOut
}

async function main() {
  // Same latest-season discovery as the other fetch scripts: probe rather
  // than trust the wall clock.
  const clockYear = new Date().getFullYear()
  const candidates = [clockYear + 1, clockYear, clockYear - 1]

  let season = null
  let data = null
  for (const candidate of candidates) {
    console.log(`Checking ${seasonUrl(candidate)} ...`)
    const result = await fetchSeason(candidate)
    if (result) { season = candidate; data = result; break }
  }
  if (season == null) {
    throw new Error(`No season found among candidates: ${candidates.join(', ')}`)
  }

  const starterQbOut = findStarterQbOut(data.teams)

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/nflverse/nflverse-data (injuries release)',
    season,
    week: data.week,
    teams: data.teams,
    // Only an Out QB with real season passing volume behind them — see
    // findStarterQbOut(). null (not {}) if player-stats.json wasn't
    // available to check against, so a consumer can tell "nobody
    // qualified" apart from "this wasn't checked."
    starterQbOut
  }

  const outDir = resolve(__dirname, '../src/data/generated')
  mkdirSync(outDir, { recursive: true })
  const out = resolve(outDir, 'injury-report.json')
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')

  const totalEntries = Object.values(data.teams).reduce((s, rows) => s + rows.length, 0)
  console.log(`Wrote ${out}`)
  console.log(`Season ${season}, week ${data.week}: ${totalEntries} reportable entries across ${Object.keys(data.teams).length} teams`)
  console.log(`Starting QBs out: ${starterQbOut ? Object.keys(starterQbOut).length : 'not checked (no player-stats.json)'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
