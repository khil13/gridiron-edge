/**
 * touchdownLab.js — every player's chance to score, across a whole slate.
 *
 * The Card's projections board shows a touchdown chance for each team's four
 * lead players. This is the same model with the cap taken off: everyone on
 * both rosters who could score, ranked, with what the number is built from
 * shown next to it — the player's own scoring rate, how many touchdowns his
 * team is expected to score in this game, and what the opponent has allowed
 * on that side of the ball.
 *
 * Nothing here is a new model. The probabilities come straight from
 * analyseAnytimeTouchdowns() (props.js), which is graded against real
 * results every week (propGrading.js).
 */

import { analyseAnytimeTouchdowns } from './props.js'
import { defenseStatsFor } from './teamDefense.js'
import { impliedProb, expectedValue, validPrice } from './odds.js'

/** Chance of two or more, from the same Poisson rate the anytime chance uses. */
export const twoPlusProbability = (lambda) => {
  const l = Math.max(0, lambda ?? 0)
  return 1 - Math.exp(-l) * (1 + l)
}

/** Which side of the opponent's defense a position scores against. A quarterback's own touchdowns are runs. */
const sideFor = (position) => (position === 'WR' || position === 'TE' ? 'receiving' : 'rushing')

/**
 * Touchdowns the opponent has allowed on one side of the ball — context for
 * the reader, not an input: the model's team total already reflects how
 * good the opponent is overall, and layering this on top was not something
 * the grading has shown to help.
 */
function defenseContext(opponent, side) {
  const found = defenseStatsFor(opponent)
  if (!found) return null
  const key = side === 'rushing' ? 'rushingTdsAllowed' : 'receivingTdsAllowed'
  const allowed = found.data[key]
  if (allowed == null || !found.data.games) return null
  return {
    side,
    perGame: Math.round((allowed / found.data.games) * 100) / 100,
    rank: found.data.ranks?.[key] ?? null, // 1 = most allowed
    season: found.season,
    isPrior: found.isPrior
  }
}

/**
 * One game's scorers.
 *
 * @param {object} game     dataset game ({ id, home, away, kickoff })
 * @param {object} proj     this game's projection from model.js
 * @param {object} rosters  fetchGameRosters() result
 * @returns {Array} one row per player who could score, highest chance first
 */
export function touchdownBoard({ game, proj, rosters }) {
  const { projected, teamCtx } = analyseAnytimeTouchdowns({ game, proj, rosters, props: null })
  return projected.map((p) => {
    const opponent = p.team === game.home ? game.away : game.home
    const position = p.position === 'FB' ? 'RB' : p.position
    const games = p.stats?.games ?? 0
    return {
      gameId: game.id,
      kickoff: game.kickoff,
      name: p.name,
      team: p.team,
      opponent,
      home: p.team === game.home,
      position,
      role: p.role,
      injury: p.injury ?? null,
      prob: p.prob,
      twoPlus: twoPlusProbability(p.lambda),
      expected: p.lambda,
      tds: games > 0 ? (p.tds ?? 0) : null,
      games,
      priorSeason: !!p.statsPriorSeason,
      // False when no depth chart could be established: every player at the
      // position shares one flat estimate, so the ranking within it is not real.
      depthKnown: p.depthKnown !== false,
      teamExpectedTds: teamCtx[p.team]?.expectedTds ?? null,
      defense: defenseContext(opponent, sideFor(position))
    }
  })
}

/**
 * Above this, an "edge" on a touchdown price is far more likely to be a
 * mistyped price or a depth chart the model has wrong than free money —
 * the same bar the Props tab already uses for this market.
 */
export const SUSPICIOUS_TD_EV = 0.25

/**
 * The model's chance against a sportsbook price the user typed in.
 *
 * `implied` is the raw chance the price pays out at — it includes the
 * book's cut, which on anytime-touchdown boards is large (often 15-25%
 * across the field), so the model sitting a little under it is normal.
 * `ev` is the expected return per unit staked at that price if the model's
 * chance is right.
 *
 * @returns {null | { invalid: true } | { price, implied, ev, suspicious }}
 */
export function priceOutlook(prob, raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (!validPrice(text)) return { invalid: true }
  const price = Number(text)
  const ev = expectedValue(prob, price)
  return { price, implied: impliedProb(price), ev, suspicious: ev > SUSPICIOUS_TD_EV }
}

/**
 * Rank a whole slate's rows, optionally narrowed to a position ('ALL' for
 * everyone), hiding the long tail of players with almost no chance unless
 * asked for.
 */
export function rankScorers(rows, { position = 'ALL', minProb = 0 } = {}) {
  return rows
    .filter((r) => position === 'ALL' || r.position === position)
    .filter((r) => r.prob >= minProb)
    .sort((a, b) => b.prob - a.prob || a.name.localeCompare(b.name))
}
