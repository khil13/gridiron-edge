/**
 * propMarkets.js — simulated player-prop prices.
 *
 * Same idea as markets.js, extended from game lines to player props: when
 * there is no live odds feed for props (no key connected, or the key's
 * quota is used up), the Card of the day still has something coherent to
 * price anytime-touchdown and yardage props against — a plausible board
 * built by disagreeing with the model's own numbers by a believable amount,
 * then priced to a realistic hold, the same way markets.js already does for
 * spreads and totals. A working odds API key replaces this module with real
 * prices; every offer built here carries `simulated: true` so nothing
 * downstream can present it as a real quote.
 */

import { mulberry32 } from '../lib/model.js'
import { probToAmerican } from '../lib/odds.js'
import {
  expectedTouchdowns, projectAnytimeTouchdowns, normaliseField, teamGameData,
  projectVolume, availableMarkets, expectedScorers
} from '../lib/props.js'
import { overProbabilityFor } from '../lib/distributions.js'
import { SPORTSBOOKS } from './schedule.js'

// Anytime-touchdown boards really do carry ten to twenty percent overround
// (see props.js's devigField comment); yardage lines run much closer to a
// standard two-way hold.
const ANYTIME_HOLD = 0.14
const VOLUME_HOLD = 0.045
// How far the simulated market's own belief is allowed to drift from the
// model's, as a fraction of the model's own number — the thing that makes
// this a disagreement to price rather than the model quoting itself. Kept
// modest (single-digit percent) because yardage markets carry enough
// variance that even a small mean disagreement swings the win probability a
// lot — see IMPLAUSIBLE_EV in card.js, which exists for exactly this shape
// of blowup and already applies to these offers with no extra wiring.
const TD_CONSENSUS_NOISE = 0.08
const VOLUME_CONSENSUS_NOISE = 0.05
const BOOK_DISPERSION = 0.03

const hashSeed = (str) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const rngFor = (...parts) => mulberry32(hashSeed(parts.join('|')))

const toHalf = (v) => Math.round(v * 2) / 2
const clampProb = (p) => Math.max(0.01, Math.min(0.97, p))

/**
 * Simulated anytime-touchdown and yardage offers for one game, in the same
 * shape fetchGameProps() returns — analyseAnytimeTouchdowns() and
 * volumePlaysForGame() cannot tell the difference from a live fetch.
 *
 * @param {object} game
 * @param {object} proj    this game's projection from model.js
 * @param {object} rosters fetchGameRosters() result
 * @param {object} ratings team ratings, for the same environment adjustment
 *                         projectVolume() already uses
 */
export function buildPropOffers({ game, proj, rosters, ratings }) {
  const homeGames = teamGameData(rosters.players, game.home)
  const awayGames = teamGameData(rosters.players, game.away)
  const teamCtx = {
    [game.home]: { expectedTds: expectedTouchdowns(proj.homeTeamTotal), ...homeGames },
    [game.away]: { expectedTds: expectedTouchdowns(proj.awayTeamTotal), ...awayGames }
  }

  const projected = normaliseField(
    projectAnytimeTouchdowns(rosters.players.map((p) => ({ ...p, tds: p.tds ?? 0 })), teamCtx),
    teamCtx
  )

  // devigField() (props.js) recovers a fair probability by rescaling a
  // team's WHOLE posted field so it sums to expectedScorers(expectedTds) —
  // its own definition of "a complete, honestly-priced board," not the sum
  // of this app's own per-player Poisson probabilities (which understates it
  // by Jensen's inequality: sum(1-e^-λ_i) < sum(λ_i) for λ_i > 0, more so the
  // more concentrated a roster's shares are). Building the simulated field
  // straight off each player's own p.prob, independently perturbed, leaves
  // its team sum sitting wherever that happens to land — devigField then
  // silently rescales every player on the team by the same factor to close
  // that gap, which swamps the actual per-player noise and biases every
  // single price the same direction. Renormalising the noisy field to
  // expectedScorers up front — the same move normaliseField() already makes
  // for lambdas — cancels that rescale rather than compounding it, leaving
  // only the real disagreement: this player's own noise, plus a residual
  // skew toward the hold on a roster short of expectedScorers's assumed 6.5
  // real contributors (a live roster's own bench depth closes most of that
  // gap; the touchdown board's fifteen-to-twenty-five percent hold already
  // documented elsewhere in this app absorbs the rest).
  const byTeam = {}
  for (const p of projected) (byTeam[p.team] ??= []).push(p)

  const anytime = []
  for (const [team, players] of Object.entries(byTeam)) {
    const noisy = players.map((p) => ({
      p, noisy: clampProb(p.prob * (1 + (rngFor(game.id, p.name, 'td')() - 0.5) * 2 * TD_CONSENSUS_NOISE))
    }))
    const targetScorers = expectedScorers(teamCtx[team]?.expectedTds ?? 0)
    const sumNoisy = noisy.reduce((s, x) => s + x.noisy, 0)
    const rescale = sumNoisy > 0 && targetScorers > 0 ? targetScorers / sumNoisy : 1

    for (const { p, noisy: n } of noisy) {
      if (!(n > 0)) continue
      const consensus = clampProb(n * rescale)
      for (const book of SPORTSBOOKS) {
        const brand = rngFor(game.id, p.name, 'td', book.key)
        const dispersed = clampProb(consensus * (1 + (brand() - 0.5) * 2 * BOOK_DISPERSION))
        // Overround: the board sells more "yes" probability than will really occur.
        const posted = clampProb(dispersed * (1 + ANYTIME_HOLD))
        anytime.push({
          book: book.name, bookKey: book.key, player: p.name,
          price: probToAmerican(posted), simulated: true
        })
      }
    }
  }

  const teamAverage = (team) => ratings?.[team]?.ppg ?? 22
  const volume = []
  for (const player of rosters.players) {
    const teamPoints = player.team === game.home ? proj.homeTeamTotal : proj.awayTeamTotal
    for (const marketDef of availableMarkets(player)) {
      const v = projectVolume(player, marketDef, { teamPoints, teamAverage: teamAverage(player.team) })
      // A synthetic (positional-average) projection is not this player's own
      // rate — no genuine line can be built against it, live or simulated.
      if (!v || v.synthetic) continue

      // The market's own belief about this player's mean, distinct from the
      // model's — the actual source of a disagreement worth pricing. Reusing
      // the model's own v.over() here would price every offer off the exact
      // number volumePlaysForGame() independently re-derives too, which
      // guarantees zero edge before the hold and a manufactured negative EV
      // on literally every play after it — the same mistake devigField's
      // comments warn against, just with the model devigging itself instead
      // of a market.
      const consensusMean = v.mean * (1 + (rngFor(game.id, player.name, marketDef.key)() - 0.5) * 2 * VOLUME_CONSENSUS_NOISE)
      for (const book of SPORTSBOOKS) {
        const brand = rngFor(game.id, player.name, marketDef.key, book.key)
        const line = toHalf(Math.max(0.5, consensusMean * (1 + (brand() - 0.5) * 2 * BOOK_DISPERSION)))
        const outcome = overProbabilityFor(marketDef.key, consensusMean, line)
        if (!outcome) continue
        const overWin = outcome.win
        const underWin = Math.max(0, 1 - overWin - outcome.push)
        const scale = overWin + underWin > 0 ? (1 + VOLUME_HOLD) / (overWin + underWin) : 1

        volume.push({
          market: marketDef.key, book: book.name, bookKey: book.key, player: player.name,
          side: 'over', line, price: probToAmerican(clampProb(overWin * scale)), simulated: true
        })
        volume.push({
          market: marketDef.key, book: book.name, bookKey: book.key, player: player.name,
          side: 'under', line, price: probToAmerican(clampProb(underWin * scale)), simulated: true
        })
      }
    }
  }

  return { eventId: null, anytime, passing: [], volume, quota: null, unmatched: false, simulated: true }
}
