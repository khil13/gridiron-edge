/**
 * build-ratings.mjs — derive 2026 season-opening power ratings.
 *
 * Inputs are real: 2025 final records and every postseason result.
 * Output is src/data/generated/ratings.json.
 *
 * Method
 *   1. Convert final win% into an end-of-season Elo on the 1500 scale.
 *   2. Credit postseason wins, which records alone under-reward.
 *   3. Regress 25% toward 1500 — the offseason resets more than fans think.
 *   4. Derive scoring rates consistent with each rating so the totals model
 *      has something to chew on. These are SYNTHETIC and flagged as such.
 *
 * Run:  npm run ratings
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEASON_2025 } from '../src/data/season2025.js'
import { mulberry32, regressToMean } from '../src/lib/model.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WIN_PCT_SCALE = 600   // Elo points across the full win% range
const PLAYOFF_WIN_BONUS = 15
const TITLE_BONUS = 25
const REGRESSION = 0.25
const LEAGUE_PPG = 22.1

const playoffWins = {}
for (const g of SEASON_2025.results) {
  if (g.round === 'Week 18') continue
  const winner = g.homeScore > g.awayScore ? g.home : g.away
  playoffWins[winner] = (playoffWins[winner] ?? 0) + 1
}

const rand = mulberry32(20260808)
const ratings = {}

for (const row of SEASON_2025.standings) {
  const games = row.w + row.l
  const winPct = row.w / games

  const endOfSeason =
    1500 +
    WIN_PCT_SCALE * (winPct - 0.5) +
    PLAYOFF_WIN_BONUS * (playoffWins[row.abbr] ?? 0) +
    (row.abbr === SEASON_2025.champion ? TITLE_BONUS : 0)

  const elo = regressToMean(endOfSeason, REGRESSION)
  const pointsVsAverage = (elo - 1500) / 25

  // Split a team's quality between offence and defence. Synthetic, but
  // internally consistent: ppg - papg always equals pointsVsAverage.
  const offenseShare = 0.35 + rand() * 0.3

  // Pace: how many possessions a team's games tend to produce. Without it
  // every projected total collapses onto the league mean, because quality
  // cancels out on both sides of the ball.
  const pace = 0.86 + rand() * 0.28

  const ppg = (LEAGUE_PPG + pointsVsAverage * offenseShare) * pace
  const papg = (LEAGUE_PPG - pointsVsAverage * (1 - offenseShare)) * pace

  ratings[row.abbr] = {
    elo: round(elo, 1),
    endOfSeasonElo: round(endOfSeason, 1),
    pointsVsAverage: round(pointsVsAverage, 2),
    ppg: round(ppg, 1),
    papg: round(papg, 1),
    pace: round(pace, 3),
    wins: row.w,
    losses: row.l,
    playoffWins: playoffWins[row.abbr] ?? 0,
    synthetic: ['ppg', 'papg', 'pace']
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  season: 2026,
  basis: '2025 final records + postseason results',
  method: {
    winPctScale: WIN_PCT_SCALE,
    playoffWinBonus: PLAYOFF_WIN_BONUS,
    titleBonus: TITLE_BONUS,
    offseasonRegression: REGRESSION,
    eloPerPoint: 25
  },
  note: 'ppg, papg and pace are derived from the rating, not observed. Replace them with real box-score data before trusting any projected total.',
  ratings
}

const out = resolve(__dirname, '../src/data/generated/ratings.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')

const ranked = Object.entries(ratings).sort((a, b) => b[1].elo - a[1].elo)
console.log(`Wrote ${out}`)
console.log('\n  #  TEAM   ELO      vs AVG   PPG    PAPG')
ranked.forEach(([abbr, r], i) => {
  console.log(
    `  ${String(i + 1).padStart(2)}  ${abbr.padEnd(5)} ${String(r.elo).padStart(7)}  ${String(r.pointsVsAverage > 0 ? '+' + r.pointsVsAverage : r.pointsVsAverage).padStart(6)}   ${String(r.ppg).padStart(5)}  ${String(r.papg).padStart(5)}`
  )
})

function round(v, d) { const m = 10 ** d; return Math.round(v * m) / m }
