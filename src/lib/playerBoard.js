/**
 * playerBoard.js — each game's main players and what the model projects
 * for them, with no sportsbook involved.
 *
 * The Card of the day used to need a price to say anything about a player:
 * with no odds API key it priced props against a simulated board built by
 * nudging the model's own number, so which players "qualified" on a given
 * day was noise, and a star with a perfectly good projection could be
 * missing entirely. A projection does not need a price to be useful. This
 * is the model's own read on every game's QB1, RB1, WR1 and TE1 — the stat
 * lines people actually look up — with the range real outcomes fall in,
 * from the same graded distribution the over/under probabilities use.
 */

import { analyseAnytimeTouchdowns, projectVolume, VOLUME_MARKETS, isRuledOut, normPropName } from './props.js'
import { quantileFor } from './distributions.js'
import { isMainPlayer } from './card.js'

/** The stat lines shown for each main role, in display order. */
const BOARD_MARKETS = {
  QB: ['passingYards', 'rushingYards'],
  RB: ['rushingYards', 'receivingYards'],
  WR: ['receivingYards', 'receptions'],
  TE: ['receivingYards', 'receptions']
}

/** Below this a yardage line is noise next to the player's real role (a pocket QB's 4 rushing yards). */
const MIN_YARDS = 8
const MIN_COUNT = 1.5

const ROLE_ORDER = { QB: 0, RB1: 1, WR1: 2, TE1: 3 }
const baseOf = (role) => (role === 'QB' ? 'QB' : role.slice(0, 2))
const isCount = (key) => key === 'receptions' || key === 'rushingAttempts'

/**
 * @param {object} game     dataset game ({ home, away, ... })
 * @param {object} proj     this game's projection from model.js
 * @param {object} rosters  fetchGameRosters() result
 * @param {object} ratings  team ratings (for each team's usual scoring)
 * @returns {Array} one entry per main player, home team first:
 *   { name, team, role, injury, tdProb, lines: [{ market, label, mean, low, high, perGame, games, priorSeason }] }
 */
export function mainPlayerBoard({ game, proj, rosters, ratings }) {
  const { projected } = analyseAnytimeTouchdowns({ game, proj, rosters, props: null })
  const tdByName = new Map(projected.map((p) => [normPropName(p.name), p.prob]))
  const teamAverage = (team) => ratings?.[team]?.ppg ?? 22

  const board = []
  for (const player of rosters.players) {
    if (!isMainPlayer(player.role) || isRuledOut(player.injury)) continue

    const teamPoints = player.team === game.home ? proj.homeTeamTotal : proj.awayTeamTotal
    const opponent = player.team === game.home ? game.away : game.home
    const marginForTeam = player.team === game.home ? proj.margin : -proj.margin

    const lines = []
    for (const key of BOARD_MARKETS[baseOf(player.role)] ?? []) {
      const market = VOLUME_MARKETS.find((m) => m.key === key)
      const v = projectVolume(player, market, { teamPoints, teamAverage: teamAverage(player.team), opponent, marginForTeam })
      // A positional-average stand-in is not this player's projection.
      if (!v || v.synthetic) continue
      if (v.mean < (isCount(key) ? MIN_COUNT : MIN_YARDS)) continue
      lines.push({
        market: key,
        label: market.label,
        mean: v.mean,
        low: quantileFor(key, v.mean, 0.25),
        high: quantileFor(key, v.mean, 0.75),
        perGame: v.perGame,
        games: v.games,
        priorSeason: !!player.statsPriorSeason
      })
    }

    const tdProb = tdByName.get(normPropName(player.name)) ?? null
    if (!lines.length && tdProb == null) continue
    board.push({ name: player.name, team: player.team, role: player.role, injury: player.injury ?? null, tdProb, lines })
  }

  return board.sort((a, b) =>
    (a.team === game.home ? 0 : 1) - (b.team === game.home ? 0 : 1) ||
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
}
