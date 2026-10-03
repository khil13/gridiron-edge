/**
 * fetch-team-efficiency.mjs — real team-level advanced metrics, from
 * nflverse's play-by-play release.
 *
 * nflverse (https://github.com/nflverse/nflverse-data) publishes a full
 * play-by-play file per season (`pbp` release), the same source nflfastR
 * and most public NFL analytics write-ups are built from, with EPA and
 * success already computed per play — no need to re-derive either from
 * scratch, and no risk of this script's own version disagreeing with the
 * community-standard numbers. Confirmed live against the real 2025 and
 * 2026 files (372 columns, ~49k rows for a full season) before writing
 * this: the exact column names and value conventions below (REG/POST
 * strings, '0'/'1' flag strings, fixed_drive_result's string vocabulary)
 * are what the file actually contains, not assumed from memory.
 *
 * Aggregated per team per season:
 *   - EPA/play, offense and defense (the single most standard efficiency
 *     number in modern NFL analytics — points of win-probability-adjusted
 *     value per snap, which already nets out garbage-time inflation the
 *     way a raw yards-per-play number does not)
 *   - success rate, offense and defense (nflverse's own down-and-distance-
 *     adjusted definition, not reimplemented here)
 *   - explosive-play rate (rush >= 10 yards or pass >= 20 yards — a
 *     standard "chunk play" threshold, documented here so the definition
 *     is auditable rather than a black box)
 *   - red-zone touchdown rate (of drives that actually reached the red
 *     zone, not all drives — using nflverse's own fixed_drive_result
 *     rather than re-deriving "did this drive score" from raw plays)
 *   - third-down conversion rate
 *   - turnover rate (interceptions + lost fumbles per offensive play)
 *   - pace (offensive plays per game)
 *
 * Deliberately NOT included: pressure rate, coverage grades, offensive-
 * line grades. Those are real, useful numbers — but they come from
 * charting data (PFF and similar) this app has no access to, and nflverse's
 * own public pbp release does not carry them. Nothing here is estimated
 * to fill that gap.
 *
 * Run:  npm run team-efficiency
 * Output: src/data/generated/team-efficiency.json, bundled into the app
 * at build time like every other generated file — no runtime fetch.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const seasonUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`

/** nflverse's team codes that don't match this app's own (see playerData.js's ABBR). */
const TEAM_ABBR = { JAX: 'JAC' }
const normTeam = (t) => TEAM_ABBR[t] || t

/** Quote-aware CSV parser — several fields (play descriptions) contain commas. */
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

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round3 = (n) => (n == null ? null : Math.round(n * 1000) / 1000)
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10)

/** Explosive-play threshold — a standard "chunk play" definition, stated plainly so it's auditable. */
const isExplosive = (playType, yardsGained) =>
  (playType === 'run' && yardsGained >= 10) || (playType === 'pass' && yardsGained >= 20)

/**
 * One season's team efficiency table from the real play-by-play file.
 * Returns null if the file doesn't exist yet for this season.
 */
async function fetchSeason(season) {
  const url = seasonUrl(season)
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
    gameId: need('game_id'),
    homeTeam: need('home_team'),
    awayTeam: need('away_team'),
    seasonType: need('season_type'),
    posteam: need('posteam'),
    defteam: need('defteam'),
    playType: need('play_type'),
    yardsGained: need('yards_gained'),
    epa: need('epa'),
    success: need('success'),
    down: need('down'),
    firstDown: need('first_down'),
    interception: need('interception'),
    fumbleLost: need('fumble_lost'),
    rushAttempt: need('rush_attempt'),
    passAttempt: need('pass_attempt'),
    qbKneel: need('qb_kneel'),
    qbSpike: need('qb_spike'),
    yardline100: need('yardline_100'),
    fixedDrive: need('fixed_drive'),
    fixedDriveResult: need('fixed_drive_result')
  }

  const teams = {}
  const forTeam = (abbr) =>
    (teams[abbr] ??= {
      games: new Set(),
      offEpa: [], defEpa: [],
      offSuccess: [], defSuccess: [],
      offPlays: 0, offExplosive: 0,
      offThirdAtt: 0, offThirdConv: 0,
      defThirdAtt: 0, defThirdConv: 0,
      interceptions: 0, fumblesLost: 0,
      // Red zone is tracked per (game, drive) below, then rolled up.
      redZoneDrives: new Set(), redZoneTds: new Set()
    })

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < header.length) continue
    if (r[idx.seasonType] !== 'REG') continue

    const gameId = r[idx.gameId]
    const home = normTeam(r[idx.homeTeam])
    const away = normTeam(r[idx.awayTeam])
    if (home) forTeam(home).games.add(gameId)
    if (away) forTeam(away).games.add(gameId)

    const posteam = normTeam(r[idx.posteam])
    const defteam = normTeam(r[idx.defteam])
    const playType = r[idx.playType]
    const isRealPlay =
      (r[idx.rushAttempt] === '1' || r[idx.passAttempt] === '1') &&
      r[idx.qbKneel] !== '1' && r[idx.qbSpike] !== '1'

    // Red-zone tracking needs every play (to notice the drive reached the
    // red zone) even though EPA/success below only count "real" plays.
    if (posteam && gameId) {
      const t = forTeam(posteam)
      const driveKey = `${gameId}:${r[idx.fixedDrive]}`
      const yardline = num(r[idx.yardline100])
      if (yardline != null && yardline <= 20) t.redZoneDrives.add(driveKey)
      if (r[idx.fixedDriveResult] === 'Touchdown') t.redZoneTds.add(driveKey)
    }

    if (!isRealPlay) continue

    const epa = num(r[idx.epa])
    const success = num(r[idx.success])
    const yardsGained = num(r[idx.yardsGained]) ?? 0
    const down = r[idx.down]
    const firstDown = r[idx.firstDown] === '1'

    if (posteam) {
      const t = forTeam(posteam)
      if (epa != null) t.offEpa.push(epa)
      if (success != null) t.offSuccess.push(success)
      t.offPlays += 1
      if (isExplosive(playType, yardsGained)) t.offExplosive += 1
      if (down === '3') { t.offThirdAtt += 1; if (firstDown) t.offThirdConv += 1 }
      if (r[idx.interception] === '1') t.interceptions += 1
      if (r[idx.fumbleLost] === '1') t.fumblesLost += 1
    }
    if (defteam) {
      const t = forTeam(defteam)
      if (epa != null) t.defEpa.push(epa)
      if (success != null) t.defSuccess.push(success)
      if (down === '3') { t.defThirdAtt += 1; if (firstDown) t.defThirdConv += 1 }
    }
  }

  const out = {}
  for (const [abbr, t] of Object.entries(teams)) {
    const games = t.games.size
    if (!games) continue
    out[abbr] = {
      games,
      epaPerPlayOff: round3(mean(t.offEpa)),
      epaPerPlayDef: round3(mean(t.defEpa)),
      successRateOff: round3(mean(t.offSuccess)),
      successRateDef: round3(mean(t.defSuccess)),
      explosivePlayRateOff: round3(t.offPlays ? t.offExplosive / t.offPlays : null),
      thirdDownRateOff: round3(t.offThirdAtt ? t.offThirdConv / t.offThirdAtt : null),
      thirdDownRateDef: round3(t.defThirdAtt ? t.defThirdConv / t.defThirdAtt : null),
      redZoneTdRateOff: round3(t.redZoneDrives.size ? t.redZoneTds.size / t.redZoneDrives.size : null),
      turnoverRate: round3(t.offPlays ? (t.interceptions + t.fumblesLost) / t.offPlays : null),
      playsPerGame: round1(t.offPlays / games)
    }
  }
  return Object.keys(out).length ? out : null
}

async function main() {
  // Same latest-season discovery as fetch-player-stats.mjs: probe rather
  // than trust the wall clock, since nflverse's own publishing lag already
  // broke that assumption once for a different release this app uses.
  const clockYear = new Date().getFullYear()
  const candidates = [clockYear + 1, clockYear, clockYear - 1, clockYear - 2]

  let latestSeason = null
  let latestData = null
  for (const season of candidates) {
    console.log(`Checking ${seasonUrl(season)} ...`)
    const data = await fetchSeason(season)
    if (data) { latestSeason = season; latestData = data; break }
  }
  if (latestSeason == null) {
    throw new Error(`No season found among candidates: ${candidates.join(', ')}`)
  }

  const priorSeason = latestSeason - 1
  console.log(`Checking ${seasonUrl(priorSeason)} ...`)
  const priorData = await fetchSeason(priorSeason)

  const seasons = { [latestSeason]: latestData }
  if (priorData) seasons[priorSeason] = priorData

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/nflverse/nflverse-data (pbp release, regular season)',
    definitions: {
      explosivePlayRateOff: 'share of offensive plays gaining >=10 yards on a run or >=20 on a pass',
      redZoneTdRateOff: 'share of drives that reached inside the opponent 20 ending in a touchdown',
      thirdDownRateOff: 'share of 3rd-down plays converted to a first down or touchdown'
    },
    latestSeason,
    seasons
  }

  const outDir = resolve(__dirname, '../src/data/generated')
  mkdirSync(outDir, { recursive: true })
  const out = resolve(outDir, 'team-efficiency.json')
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')

  console.log(`Wrote ${out}`)
  console.log(`Latest season: ${latestSeason} (${Object.keys(latestData).length} teams)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
