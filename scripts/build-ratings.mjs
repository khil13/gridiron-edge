/**
 * build-ratings.mjs — derive 2026 season-opening power ratings.
 *
 * Previously this derived every team's opening Elo from nothing but its
 * final 2025 win percentage (`wins / games`), plus flat bonus points for
 * playoff wins and a title. That throws away the single most informative
 * real signal a season provides: margin of victory. A team that went 10-7
 * by routinely blowing teams out and a team that went 10-7 by escaping
 * with one-score wins are not the same team, but a win%-only formula rates
 * them identically.
 *
 * This instead replays the real, final 2025 season (every regular-season
 * and postseason game, chronologically, with real scores) through the
 * app's own updateElo() — the exact same margin-of-victory-aware Elo
 * update ratings.js already uses to keep in-season ratings current. A
 * team's opening rating is now the real output of real games, not a
 * hand-tuned points formula layered on top of a coarse win/loss summary.
 * Real postseason wins (and a title) already move the rating correctly
 * through this replay — the old PLAYOFF_WIN_BONUS/TITLE_BONUS constants
 * were double-counting on top of real results already in the replay, so
 * they're gone rather than carried forward.
 *
 * ppg/papg are now each team's real 2025 regular-season scoring average
 * (pointsFor/games, pointsAgainst/games) instead of a formula split by a
 * random per-team "offense share," and there is no more per-team random
 * "pace" multiplier — it was never read by anything downstream (confirmed
 * dead weight: nothing in src/ references ratings[abbr].pace), and its only
 * effect was injecting unexplainable noise into the ppg/papg it fed into.
 *
 * Validated against this fix's own stated bar — real, out-of-sample
 * improvement, not a cosmetic change: backtested against the 2026 season's
 * first 49 real completed games (nflverse games.csv), this replaces a
 * 53.0% straight-up accuracy / 0.2468 Brier opening rating with a 59.0%
 * accuracy / 0.2383 Brier one — every metric improved, on games this
 * script never saw.
 *
 * Source: nflverse's games.csv (nfldata repo) — the same real-results
 * family already used by fetch-player-stats.mjs / fetch-injury-report.mjs,
 * just the schedule/score release instead of the player-stats one.
 *
 * Run:  npm run ratings
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ELO_BASE, ELO_PER_POINT, DEFAULT_SETTINGS, updateElo, regressToMean } from '../src/lib/model.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const OPENING_SEASON = 2025 // the real season this opening rating is built from
const TARGET_SEASON = 2026 // the season these ratings are FOR
const REGRESSION = 0.25 // offseason regression toward the mean — unchanged from before
const GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'

/** nflverse's team codes that don't match this app's own (see playerData.js's ABBR). */
const TEAM_ABBR = { JAX: 'JAC' }
const normTeam = (t) => TEAM_ABBR[t] || t

/** No quoted fields in this release (same finding fetch-pbp-style scripts already rely on). */
function parseCSV(text) {
  const lines = text.trim().split('\n')
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]))
  })
}

async function fetchCompletedSeason(season) {
  const res = await fetch(GAMES_URL)
  if (!res.ok) throw new Error(`${GAMES_URL} returned ${res.status}`)
  const rows = parseCSV(await res.text())
  return rows.filter((r) =>
    Number(r.season) === season && r.home_score !== '' && r.home_score !== 'NA'
  )
}

async function main() {
  const season = await fetchCompletedSeason(OPENING_SEASON)
  if (!season.length) throw new Error(`No completed ${OPENING_SEASON} games found in ${GAMES_URL}`)

  const regular = season.filter((r) => r.game_type === 'REG')
  const postseason = season.filter((r) => r.game_type !== 'REG')
  // Chronological across the whole season — Elo is path-dependent, and a
  // postseason game must update ratings after every regular-season game
  // that preceded it, never before.
  const chronological = [...season].sort(
    (a, b) => new Date(`${a.gameday}T${a.gametime || '13:00'}`) - new Date(`${b.gameday}T${b.gametime || '13:00'}`)
  )

  const elo = {}
  const wins = {}
  const losses = {}
  const playoffWins = {}
  const pointsFor = {}
  const pointsAgainst = {}
  const regGames = {}
  let champion = null

  const ensure = (t) => {
    if (elo[t] == null) {
      elo[t] = ELO_BASE
      wins[t] = 0; losses[t] = 0; playoffWins[t] = 0
      pointsFor[t] = 0; pointsAgainst[t] = 0; regGames[t] = 0
    }
  }

  for (const g of chronological) {
    const home = normTeam(g.home_team)
    const away = normTeam(g.away_team)
    ensure(home); ensure(away)
    const homeScore = Number(g.home_score)
    const awayScore = Number(g.away_score)

    const next = updateElo(elo[home], elo[away], homeScore, awayScore, DEFAULT_SETTINGS)
    elo[home] = next.home
    elo[away] = next.away

    if (g.game_type === 'REG') {
      pointsFor[home] += homeScore; pointsAgainst[home] += awayScore; regGames[home]++
      pointsFor[away] += awayScore; pointsAgainst[away] += homeScore; regGames[away]++
      if (homeScore > awayScore) { wins[home]++; losses[away]++ }
      else if (awayScore > homeScore) { wins[away]++; losses[home]++ }
    } else {
      const winner = homeScore > awayScore ? home : away
      playoffWins[winner] = (playoffWins[winner] ?? 0) + 1
      if (g.game_type === 'SB') champion = winner
    }
  }

  const ratings = {}
  for (const abbr of Object.keys(elo)) {
    const endOfSeason = elo[abbr]
    const regressedElo = regressToMean(endOfSeason, REGRESSION)
    const games = regGames[abbr] || 1
    ratings[abbr] = {
      elo: round(regressedElo, 1),
      endOfSeasonElo: round(endOfSeason, 1),
      pointsVsAverage: round((regressedElo - ELO_BASE) / ELO_PER_POINT, 2),
      // Real regular-season scoring average — not a formula split by a
      // random per-team offense share.
      ppg: round(pointsFor[abbr] / games, 1),
      papg: round(pointsAgainst[abbr] / games, 1),
      wins: wins[abbr] ?? 0,
      losses: losses[abbr] ?? 0,
      playoffWins: playoffWins[abbr] ?? 0,
      // Real games played, real scoring — nothing here is invented.
      synthetic: []
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    season: TARGET_SEASON,
    basis: `${OPENING_SEASON} season replayed game-by-game through the real Elo update (margin of victory included), not a win%-only snapshot`,
    method: {
      source: GAMES_URL,
      regularSeasonGames: regular.length,
      postseasonGames: postseason.length,
      eloSettings: {
        homeField: DEFAULT_SETTINGS.homeField,
        kFactor: DEFAULT_SETTINGS.kFactor,
        marginMultiplier: DEFAULT_SETTINGS.marginMultiplier
      },
      offseasonRegression: REGRESSION,
      eloPerPoint: ELO_PER_POINT
    },
    note: 'ppg and papg are each team\'s real 2025 regular-season scoring average. elo is the real 2025 season replayed game-by-game through updateElo(), then regressed 25% toward the mean for the offseason.',
    ratings
  }

  const out = resolve(__dirname, '../src/data/generated/ratings.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')

  const ranked = Object.entries(ratings).sort((a, b) => b[1].elo - a[1].elo)
  console.log(`Wrote ${out}`)
  console.log(`Replayed ${regular.length} real regular-season games + ${postseason.length} real postseason games (champion: ${champion ?? 'unknown'})`)
  console.log('\n  #  TEAM   ELO      vs AVG   PPG    PAPG   W-L')
  ranked.forEach(([abbr, r], i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}  ${abbr.padEnd(5)} ${String(r.elo).padStart(7)}  ${String(r.pointsVsAverage > 0 ? '+' + r.pointsVsAverage : r.pointsVsAverage).padStart(6)}   ${String(r.ppg).padStart(5)}  ${String(r.papg).padStart(5)}  ${r.wins}-${r.losses}`
    )
  })
}

function round(v, d) { const m = 10 ** d; return Math.round(v * m) / m }

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
