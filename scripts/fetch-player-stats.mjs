/**
 * fetch-player-stats.mjs — real per-player season rates, from a source
 * that isn't blocked.
 *
 * ESPN's per-athlete stats feed (the only other source this app has tried)
 * turned out to be walled off from every kind of server-side infrastructure
 * tested against it: a Cloudflare Worker got a flat 403, and a GitHub
 * Actions runner got 404 on the exact same request, headers and all. That
 * is consistent with ESPN's bot protection denying by IP/ASN reputation —
 * any recognised cloud/datacenter range, not just Cloudflare's — rather
 * than anything fixable by changing the request.
 *
 * nflverse (https://github.com/nflverse) publishes the same shape of data
 * — weekly per-player rushing/receiving/passing stats — as plain CSV files
 * attached to a GitHub release. It is public, free, updated automatically
 * after each week's games, and served from GitHub's own infrastructure
 * rather than anything ESPN's protection could apply to.
 *
 * This reads the `stats_player` release (one file per season:
 * stats_player_week_<season>.csv), not the older `player_stats` release —
 * confirmed live that the latter is frozen at the 2024 season while this
 * one already carries the current season's games as they're played. Since
 * "which season is current" already burned us once (see
 * src/data/providers/playerData.js's statsSeason comment), this discovers
 * the latest season by actually probing for files rather than assuming a
 * wall-clock year lines up with what's published.
 *
 * Run:  npm run player-stats
 * Output: src/data/generated/player-stats.json, bundled into the app at
 * build time as an ordinary import — no runtime fetch, no proxy, no CORS
 * question to answer.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normPropName } from '../src/lib/props.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const seasonUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`

/** Quote-aware CSV parser — several fields (player names) can contain commas. */
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
  return rows
}

/** Folds FB into RB, matching how playerData.js groups roles for everything else. */
const basePosition = (position) => (position === 'FB' ? 'RB' : position)

/** One season's worth of per-player REG-season totals, or null if the file doesn't exist yet. */
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
    name: need('player_display_name'),
    position: need('position'),
    seasonType: need('season_type'),
    attempts: need('attempts'),
    passingYards: need('passing_yards'),
    passingTds: need('passing_tds'),
    carries: need('carries'),
    rushingYards: need('rushing_yards'),
    rushingTds: need('rushing_tds'),
    receptions: need('receptions'),
    targets: need('targets'),
    receivingYards: need('receiving_yards'),
    receivingTds: need('receiving_tds')
  }

  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const players = {}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < header.length) continue
    if (r[idx.seasonType] !== 'REG') continue

    const name = r[idx.name]
    if (!name) continue
    const key = `${normPropName(name)}|${basePosition(r[idx.position])}`

    const attempts = num(r[idx.attempts])
    const carries = num(r[idx.carries])
    const targets = num(r[idx.targets])

    const acc = (players[key] ??= {
      games: 0, tds: 0, receivingYards: 0, receptions: 0, targets: 0,
      rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0
    })

    if (attempts > 0 || carries > 0 || targets > 0) acc.games += 1
    acc.tds += num(r[idx.rushingTds]) + num(r[idx.receivingTds])
    acc.receivingYards += num(r[idx.receivingYards])
    acc.receptions += num(r[idx.receptions])
    acc.targets += targets
    acc.rushingYards += num(r[idx.rushingYards])
    acc.rushingAttempts += carries
    acc.passingYards += num(r[idx.passingYards])
    acc.passingAttempts += attempts
    acc.passingTouchdowns += num(r[idx.passingTds])
  }

  return Object.keys(players).length ? players : null
}

async function main() {
  // Probe from a season ahead of the wall-clock year down to a few behind
  // it, rather than trusting the clock outright — exactly the assumption
  // that broke last time. Stops at the first (highest) season that
  // actually has rows, which is nflverse's real current season whatever
  // the clock says.
  const clockYear = new Date().getFullYear()
  const candidates = [clockYear + 1, clockYear, clockYear - 1, clockYear - 2, clockYear - 3]

  let latestSeason = null
  let latestPlayers = null
  for (const season of candidates) {
    console.log(`Checking ${seasonUrl(season)} ...`)
    const players = await fetchSeason(season)
    if (players) { latestSeason = season; latestPlayers = players; break }
  }
  if (latestSeason == null) {
    throw new Error(`No season found among candidates: ${candidates.join(', ')}`)
  }

  // The season right before it, for the "nothing yet this year" fallback
  // playerData.js already does (opening weeks, or a rookie's first snap).
  const priorSeason = latestSeason - 1
  console.log(`Checking ${seasonUrl(priorSeason)} ...`)
  const priorPlayers = await fetchSeason(priorSeason)

  const seasons = { [latestSeason]: latestPlayers }
  if (priorPlayers) seasons[priorSeason] = priorPlayers

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/nflverse/nflverse-data (stats_player release, regular season)',
    latestSeason,
    seasons
  }

  const outDir = resolve(__dirname, '../src/data/generated')
  mkdirSync(outDir, { recursive: true })

  const out = resolve(outDir, 'player-stats.json')
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')

  const playerCount = Object.keys(latestPlayers).length

  // A separate, tiny file for anything that just wants to show "as of
  // <season>" without pulling the whole few-hundred-KB dataset into a
  // bundle that only needs one number — see ModelLabView.jsx.
  const metaOut = resolve(outDir, 'player-stats-meta.json')
  writeFileSync(metaOut, JSON.stringify({ generatedAt: payload.generatedAt, latestSeason, playerCount }, null, 2) + '\n')

  console.log(`Wrote ${out}`)
  console.log(`Wrote ${metaOut}`)
  console.log(`Latest season: ${latestSeason} (${playerCount} players)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
