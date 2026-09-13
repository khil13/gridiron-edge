/**
 * reasons.js — the "why" behind a Card pick.
 *
 * A handful of short, factual bullets: the player's own real production,
 * his rostered role, and how the opponent's defense has fared against that
 * side of the ball. Every number here traces back to something already in
 * the app (the bundled nflverse snapshot, the roster feed, or the pick
 * itself) — nothing about redzone share, snap trends, or head-to-head
 * history is invented, because this app doesn't have that data. When a
 * fact isn't available (no season stats yet, an unranked opponent), its
 * bullet is simply left off rather than guessed at.
 */

import { ordinal } from './format.js'
import TEAM_DEFENSE from '../data/generated/team-defense.json'

/** A team's allowed-production stats, preferring this season, falling back one year. */
function defenseStatsFor(team) {
  const current = TEAM_DEFENSE.seasons?.[TEAM_DEFENSE.latestSeason]?.[team]
  if (current?.games > 0) return { data: current, isPrior: false }
  const prior = TEAM_DEFENSE.seasons?.[TEAM_DEFENSE.latestSeason - 1]?.[team]
  return prior?.games > 0 ? { data: prior, isPrior: true } : null
}

/** Which side of the ball a position's production comes from. */
const sideFor = (positionGroup) =>
  positionGroup === 'RB' || positionGroup === 'QB' || positionGroup === 'FB' ? 'rushing' : 'receiving'

/** Depth-chart roles are always a base group plus an optional rank digit — e.g. "WR3" -> "WR". */
const roleGroup = (role) => String(role || '').replace(/[0-9]/g, '')

function defenseBullet(opponent, positionGroup) {
  const found = defenseStatsFor(opponent)
  if (!found) return null
  const side = sideFor(positionGroup)
  const ydsRank = found.data.ranks?.[side === 'rushing' ? 'rushingYardsAllowed' : 'receivingYardsAllowed']
  const tdRank = found.data.ranks?.[side === 'rushing' ? 'rushingTdsAllowed' : 'receivingTdsAllowed']
  if (ydsRank == null && tdRank == null) return null

  const parts = []
  if (tdRank != null) parts.push(`${ordinal(tdRank)}-most ${side} TDs`)
  if (ydsRank != null) parts.push(`${ordinal(ydsRank)}-most ${side} yards`)
  const seasonWord = found.isPrior ? 'last season' : 'this season'
  return `${opponent} has allowed the ${parts.join(' and the ')} ${seasonWord}.`
}

/** Anytime-touchdown pick: real season TDs, rostered role, opponent context. */
export function reasonsForTouchdownPick(pick) {
  const bullets = []
  const model = pick.entry.model
  const stats = model?.stats

  if (stats?.games > 0) {
    const seasonWord = model.statsPriorSeason ? 'last season' : 'this season'
    const perGame = Math.round((stats.tds / stats.games) * 10) / 10
    bullets.push(`${stats.tds} TD${stats.tds === 1 ? '' : 's'} in ${stats.games} games ${seasonWord} (${perGame}/game).`)
  }

  if (model?.role) {
    bullets.push(
      model.depthKnown
        ? `Rostered as the team's ${model.role}.`
        : `Depth chart not published yet — ${model.role} share is split evenly among the group, not individually ranked.`
    )
  }

  const opponent = pick.game.home === pick.entry.team ? pick.game.away : pick.game.home
  const defBullet = defenseBullet(opponent, roleGroup(model?.role))
  if (defBullet) bullets.push(defBullet)

  return bullets
}

/** Yardage/volume pick: real per-game rate this season, opponent context, injury status. */
export function reasonsForVolumePick(pick) {
  const bullets = []
  const e = pick.entry

  if (e.games > 0) {
    const seasonWord = e.statsPriorSeason ? 'last season' : 'this season'
    bullets.push(`${e.perGame} ${e.marketLabel.toLowerCase()}/game over ${e.games} games ${seasonWord}.`)
  }

  const opponent = pick.game.home === e.team ? pick.game.away : pick.game.home
  const defBullet = defenseBullet(opponent, roleGroup(e.role))
  if (defBullet) bullets.push(defBullet)

  if (e.injury && e.injury !== 'Active') bullets.push(`Injury status: ${e.injury}.`)

  return bullets
}

/** One entry point — the caller doesn't need to know touchdown from volume. */
export function reasonsForPick(pick) {
  return pick.kind === 'volume' ? reasonsForVolumePick(pick) : reasonsForTouchdownPick(pick)
}
