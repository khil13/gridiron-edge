/**
 * reasons.js — the "why" behind a Card pick.
 *
 * A handful of short, factual bullets: the player's own real production,
 * his rostered role, how the opponent's defense has fared against that
 * side of the ball, and — when the bundled snapshot has it — Next Gen
 * Stats tracking data (separation, YAC over expectation, rush yards over
 * expected). Every number here traces back to something already in the
 * app (the bundled nflverse snapshot, the roster feed, or the pick
 * itself) — nothing about redzone share, snap trends, or head-to-head
 * history is invented, because this app doesn't have that data. When a
 * fact isn't available (no season stats yet, an unranked opponent, no NGS
 * row for this player), its bullet is simply left off rather than guessed
 * at. NGS is published on its own schedule, often a season or more behind
 * the totals above, so every NGS bullet states its own real year rather
 * than borrowing "this season"/"last season" from a different dataset.
 */

import { ordinal } from './format.js'
import { defenseStatsFor } from './teamDefense.js'

/** Which side of the ball a position's production comes from. */
const sideFor = (positionGroup) =>
  positionGroup === 'RB' || positionGroup === 'QB' || positionGroup === 'FB' ? 'rushing' : 'receiving'

/** Depth-chart roles are always a base group plus an optional rank digit — e.g. "WR3" -> "WR". */
const roleGroup = (role) => String(role || '').replace(/[0-9]/g, '')

/**
 * Next Gen Stats bullets — target share of the team's air yards, separation
 * and YAC over expectation for a pass-catcher; rush yards over expected and
 * box counts for a runner. Capped at two: this is additive context on top
 * of the season-rate and defense bullets already built above, not a
 * replacement for them. Target share leads when it's available since it's
 * the strongest real usage signal this app has for a receiver — closer to
 * "how much of the offense goes through him" than separation or YAC are.
 */
function ngsBullets(ngs, positionGroup) {
  if (!ngs) return []
  const bullets = []
  const year = ngs.season
  if (sideFor(positionGroup) === 'receiving') {
    if (ngs.targetShareAirYards != null) {
      bullets.push(`Commands ${ngs.targetShareAirYards}% of the team's intended air yards (Next Gen Stats, ${year}).`)
    }
    if (ngs.avgSeparation != null) {
      bullets.push(`Averages ${ngs.avgSeparation} yards of separation (Next Gen Stats, ${year}).`)
    }
    if (ngs.yacAboveExpectation != null) {
      const n = Math.abs(ngs.yacAboveExpectation)
      const dir = ngs.yacAboveExpectation >= 0 ? 'more' : 'fewer'
      bullets.push(`Gains ${n} ${dir} yards after the catch than expected (Next Gen Stats, ${year}).`)
    }
  } else {
    if (ngs.rushYardsOverExpectedPerAtt != null) {
      const n = Math.abs(ngs.rushYardsOverExpectedPerAtt)
      const dir = ngs.rushYardsOverExpectedPerAtt >= 0 ? 'more' : 'fewer'
      bullets.push(`Gains ${n} ${dir} yards per carry than the blocking suggests (Next Gen Stats, ${year}).`)
    }
    if (ngs.stackedBoxRate != null) {
      bullets.push(`Faces a stacked box (8+ defenders) on ${ngs.stackedBoxRate}% of carries (Next Gen Stats, ${year}).`)
    }
  }
  return bullets.slice(0, 2)
}

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

  bullets.push(...ngsBullets(model?.ngs, roleGroup(model?.role)))

  return bullets
}

/** Yardage/volume pick: real per-game rate this season, opponent context, injury status, Next Gen Stats. */
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

  bullets.push(...ngsBullets(e.ngs, roleGroup(e.role)))

  if (e.injury && e.injury !== 'Active') bullets.push(`Injury status: ${e.injury}.`)

  return bullets
}

/** One entry point — the caller doesn't need to know touchdown from volume. */
export function reasonsForPick(pick) {
  return pick.kind === 'volume' ? reasonsForVolumePick(pick) : reasonsForTouchdownPick(pick)
}
