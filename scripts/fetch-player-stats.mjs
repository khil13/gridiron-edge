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
 * The same rows also carry each game's `opponent_team`, so a player's
 * production is also a defense's *allowed* production from the other
 * side — no extra fetch needed to build "this defense has allowed the
 * Nth-most rushing TDs" context for the Card's per-pick reasons.
 *
 * Run:  npm run player-stats
 * Output: src/data/generated/player-stats.json + team-defense.json,
 * bundled into the app at build time as ordinary imports — no runtime
 * fetch, no proxy, no CORS question to answer.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normPropName } from '../src/lib/props.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const seasonUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`

/**
 * Next Gen Stats — separation, YAC over expectation, rush yards over
 * expected, and similar tracking-data metrics nflverse republishes from the
 * same release infrastructure as the season totals above, but as its own
 * release (`nextgen_stats`) that runs on its own, slower publishing
 * schedule: confirmed live that only a prior season's files exist there
 * even once the current season is well underway in the main release. So
 * this probes for its own latest season independently rather than assuming
 * it lines up with whatever season the totals above landed on, and every
 * NGS record below carries its own real season number rather than
 * borrowing the season word from a different, fresher dataset.
 */
const ngsUrl = (season, stat) =>
  `https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_${season}_${stat}.csv.gz`

/** nflverse's team codes that don't match this app's own (see playerData.js's ABBR). */
const TEAM_ABBR = { JAX: 'JAC' }
const normTeam = (t) => TEAM_ABBR[t] || t

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

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * One season's per-player REG-season totals plus, from the same rows, each
 * team's allowed rushing/receiving yards and TDs (the flip side of every
 * row's own production). Returns null if the file doesn't exist yet.
 */
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
    opponentTeam: need('opponent_team'),
    gameId: need('game_id'),
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

  const players = {}
  const defense = {}
  const gamesSeenByTeam = {}

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < header.length) continue
    if (r[idx.seasonType] !== 'REG') continue

    const rushingYards = num(r[idx.rushingYards])
    const rushingTds = num(r[idx.rushingTds])
    const receivingYards = num(r[idx.receivingYards])
    const receivingTds = num(r[idx.receivingTds])

    // The defense side: this row's production happened against
    // opponent_team, so it counts toward what that team's defense allowed.
    const defTeam = normTeam(r[idx.opponentTeam])
    if (defTeam) {
      const d = (defense[defTeam] ??= {
        rushingYardsAllowed: 0, rushingTdsAllowed: 0, receivingYardsAllowed: 0, receivingTdsAllowed: 0
      })
      d.rushingYardsAllowed += rushingYards
      d.rushingTdsAllowed += rushingTds
      d.receivingYardsAllowed += receivingYards
      d.receivingTdsAllowed += receivingTds

      const seen = (gamesSeenByTeam[defTeam] ??= new Set())
      const gameId = r[idx.gameId]
      if (gameId) seen.add(gameId)
    }

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
    acc.tds += rushingTds + receivingTds
    acc.receivingYards += receivingYards
    acc.receptions += num(r[idx.receptions])
    acc.targets += targets
    acc.rushingYards += rushingYards
    acc.rushingAttempts += carries
    acc.passingYards += num(r[idx.passingYards])
    acc.passingAttempts += attempts
    acc.passingTouchdowns += num(r[idx.passingTds])
  }

  for (const [team, d] of Object.entries(defense)) {
    d.games = gamesSeenByTeam[team]?.size ?? 0
  }

  return {
    players: Object.keys(players).length ? players : null,
    defense: Object.keys(defense).length ? defense : null
  }
}

/**
 * One NGS file (receiving or rushing) for one season, aggregated to a
 * single row per player. nflverse's own convention marks the season-total
 * row with week 0 — using that instead of summing the weekly rows avoids
 * re-deriving an average nflverse has already computed correctly (several
 * of these fields, like avg_separation, are means that don't sum sensibly
 * across weeks at all).
 *
 * Returns null if the file doesn't exist yet for this season — the normal
 * case for whatever season is more recent than NGS has published.
 */
async function fetchNgsFile(season, stat, fields) {
  const url = ngsUrl(season, stat)
  const res = await fetch(url)
  if (!res.ok) return null
  const gz = Buffer.from(await res.arrayBuffer())
  const text = gunzipSync(gz).toString('utf8')

  const rows = parseCSV(text)
  const header = rows[0]
  const col = Object.fromEntries(header.map((name, i) => [name, i]))
  const need = (name) => {
    if (!(name in col)) throw new Error(`${url} is missing expected column "${name}"`)
    return col[name]
  }
  const idx = {
    week: need('week'),
    seasonType: need('season_type'),
    name: need('player_display_name'),
    position: need('player_position'),
    ...Object.fromEntries(fields.map((f) => [f, need(f)]))
  }

  const out = {}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < header.length) continue
    if (r[idx.seasonType] !== 'REG') continue
    if (r[idx.week] !== '0') continue // season-aggregate row only

    const name = r[idx.name]
    if (!name) continue
    const key = `${normPropName(name)}|${basePosition(r[idx.position])}`
    const record = { season }
    for (const f of fields) record[f] = num(r[idx[f]])
    out[key] = record
  }
  return Object.keys(out).length ? out : null
}

/**
 * The latest season nflverse has actually published Next Gen Stats for,
 * probed the same way fetchSeason's own latest-season search is — starting
 * from the totals release's own latest season (never ahead of it) and
 * walking backward, since NGS has already been confirmed to lag behind.
 */
async function fetchLatestNgs(fromSeason) {
  const RECEIVING_FIELDS = ['avg_separation', 'avg_cushion', 'avg_intended_air_yards', 'percent_share_of_intended_air_yards', 'avg_yac_above_expectation']
  const RUSHING_FIELDS = ['rush_yards_over_expected_per_att', 'percent_attempts_gte_eight_defenders']

  for (let season = fromSeason; season >= fromSeason - 3; season--) {
    console.log(`Checking ${ngsUrl(season, 'receiving')} ...`)
    const [receiving, rushing] = await Promise.all([
      fetchNgsFile(season, 'receiving', RECEIVING_FIELDS),
      fetchNgsFile(season, 'rushing', RUSHING_FIELDS)
    ])
    if (!receiving && !rushing) continue

    const players = {}
    for (const [key, rec] of Object.entries(receiving ?? {})) {
      players[key] = {
        season,
        avgSeparation: round1(rec.avg_separation),
        avgCushion: round1(rec.avg_cushion),
        avgIntendedAirYards: round1(rec.avg_intended_air_yards),
        targetShareAirYards: round1(rec.percent_share_of_intended_air_yards),
        yacAboveExpectation: round1(rec.avg_yac_above_expectation)
      }
    }
    for (const [key, rec] of Object.entries(rushing ?? {})) {
      players[key] = {
        ...players[key],
        season,
        rushYardsOverExpectedPerAtt: round1(rec.rush_yards_over_expected_per_att),
        stackedBoxRate: round1(rec.percent_attempts_gte_eight_defenders)
      }
    }
    return { season, players }
  }
  return null
}

const round1 = (n) => Math.round(n * 10) / 10

/** 1 = allows the most (worst defense) on that stat, matching "allowed the Nth-most X" phrasing. */
function rankDefense(defense) {
  const stats = ['rushingYardsAllowed', 'rushingTdsAllowed', 'receivingYardsAllowed', 'receivingTdsAllowed']
  const teams = Object.keys(defense)
  const out = {}
  for (const stat of stats) {
    const ranked = [...teams].sort((a, b) => defense[b][stat] - defense[a][stat])
    ranked.forEach((team, i) => {
      (out[team] ??= {})[stat] = i + 1
    })
  }
  return out
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
  let latestData = null
  for (const season of candidates) {
    console.log(`Checking ${seasonUrl(season)} ...`)
    const data = await fetchSeason(season)
    if (data?.players) { latestSeason = season; latestData = data; break }
  }
  if (latestSeason == null) {
    throw new Error(`No season found among candidates: ${candidates.join(', ')}`)
  }

  // The season right before it, for the "nothing yet this year" fallback
  // playerData.js already does (opening weeks, or a rookie's first snap).
  const priorSeason = latestSeason - 1
  console.log(`Checking ${seasonUrl(priorSeason)} ...`)
  const priorData = await fetchSeason(priorSeason)

  const playerSeasons = { [latestSeason]: latestData.players }
  if (priorData?.players) playerSeasons[priorSeason] = priorData.players

  const playerPayload = {
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/nflverse/nflverse-data (stats_player release, regular season)',
    latestSeason,
    seasons: playerSeasons
  }

  const defenseSeasons = {}
  for (const [season, data] of [[latestSeason, latestData], [priorSeason, priorData]]) {
    if (!data?.defense) continue
    const ranks = rankDefense(data.defense)
    const teams = {}
    for (const [team, d] of Object.entries(data.defense)) {
      teams[team] = { ...d, ranks: ranks[team] }
    }
    defenseSeasons[season] = teams
  }

  const defensePayload = {
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/nflverse/nflverse-data (stats_player release, regular season, aggregated by opponent)',
    latestSeason,
    seasons: defenseSeasons
  }

  const outDir = resolve(__dirname, '../src/data/generated')
  mkdirSync(outDir, { recursive: true })

  const out = resolve(outDir, 'player-stats.json')
  writeFileSync(out, JSON.stringify(playerPayload, null, 2) + '\n')

  const playerCount = Object.keys(latestData.players).length

  // A separate, tiny file for anything that just wants to show "as of
  // <season>" without pulling the whole few-hundred-KB dataset into a
  // bundle that only needs one number — see ModelLabView.jsx.
  const metaOut = resolve(outDir, 'player-stats-meta.json')
  writeFileSync(metaOut, JSON.stringify({ generatedAt: playerPayload.generatedAt, latestSeason, playerCount }, null, 2) + '\n')

  const defenseOut = resolve(outDir, 'team-defense.json')
  writeFileSync(defenseOut, JSON.stringify(defensePayload, null, 2) + '\n')

  console.log(`Wrote ${out}`)
  console.log(`Wrote ${metaOut}`)
  console.log(`Wrote ${defenseOut}`)
  console.log(`Latest season: ${latestSeason} (${playerCount} players, ${Object.keys(latestData.defense ?? {}).length} teams)`)

  // Next Gen Stats: a genuinely separate release on its own schedule, so it
  // gets its own file with its own season number rather than being forced
  // to share (or silently misrepresent) the totals release's latestSeason.
  // Always written, even when nothing was found — playerData.js statically
  // imports this file, so it must exist for the build to succeed regardless
  // of whether NGS itself is currently reachable.
  const ngs = await fetchLatestNgs(latestSeason)
  const ngsPayload = ngs
    ? {
        generatedAt: new Date().toISOString(),
        source: 'https://github.com/nflverse/nflverse-data (nextgen_stats release, regular season)',
        latestSeason: ngs.season,
        players: ngs.players
      }
    : { generatedAt: new Date().toISOString(), source: null, latestSeason: null, players: {} }
  const ngsOut = resolve(outDir, 'player-ngs.json')
  writeFileSync(ngsOut, JSON.stringify(ngsPayload, null, 2) + '\n')
  console.log(`Wrote ${ngsOut}`)
  console.log(
    ngs
      ? `Next Gen Stats season: ${ngs.season} (${Object.keys(ngs.players).length} players)`
      : 'No Next Gen Stats found in the last 4 seasons.'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
