/**
 * card.js — the Card of the Day.
 *
 * A card is not "the best plays." It is at most ONE play per game, chosen at
 * the best price available anywhere, with everything that fails to clear the
 * bar shown explicitly as a pass.
 */

import { dayKey } from './format.js'

/**
 * Conviction tiers, expressed in units. Thresholds are deliberately strict:
 * EV alone is not enough, because a large EV built on a quarter-point of
 * disagreement is mostly rounding. A play must clear BOTH bars.
 */
export const TIERS = [
  { units: 3, label: 'Best bet', minEv: 0.05, minPoints: 1.5, tone: 'edge' },
  { units: 2, label: 'Strong',   minEv: 0.03, minPoints: 1.0, tone: 'edge' },
  { units: 1, label: 'Lean',     minEv: 0.015, minPoints: 0.5, tone: 'chalk' }
]

/** Highest tier a play qualifies for, or null if it clears none. */
export function tierFor(play) {
  const points = Math.abs(play.edgePoints ?? 0)
  return TIERS.find((t) => play.ev >= t.minEv && points >= t.minPoints) || null
}

/** Reason a game produced no play. Specificity is what makes passes useful. */
function passReason(best) {
  if (!best) return 'No priced market'
  const points = Math.abs(best.edgePoints ?? 0)
  if (best.ev <= 0) return 'Model agrees with the market'
  if (points < 0.5) return `Only ${points.toFixed(1)} pts of disagreement`
  return `Edge too thin (${(best.ev * 100).toFixed(1)}% EV)`
}

/**
 * Build the card for a set of games.
 * @returns {{ plays, passes, stats }}
 */
export function buildCard(games, settings) {
  const unit = (settings.bankroll ?? 1000) * 0.01 // 1 unit = 1% of bankroll

  const entries = games.map((game) => {
    const bySide = new Map()
    for (const p of game.allPlays ?? []) {
      const k = `${p.type}:${p.side}`
      const cur = bySide.get(k)
      if (!cur || p.ev > cur.ev) bySide.set(k, p)
    }
    const ranked = [...bySide.values()].sort((a, b) => b.ev - a.ev)
    const best = ranked[0] ?? null
    const tier = best ? tierFor(best) : null
    const alternate = ranked[1] ?? null

    return { game, best, tier, alternate, reason: tier ? null : passReason(best) }
  })

  const plays = entries
    .filter((e) => e.tier)
    .map((e) => ({
      ...e,
      stake: e.tier.units * unit,
      kellyStake: e.best.stake
    }))
    .sort((a, b) => b.tier.units - a.tier.units || b.best.ev - a.best.ev)

  const passes = entries.filter((e) => !e.tier)

  const risked = plays.reduce((s, p) => s + p.stake, 0)
  const expected = plays.reduce((s, p) => s + p.best.ev * p.stake, 0)

  return {
    plays,
    passes,
    stats: {
      unit,
      count: plays.length,
      units: plays.reduce((s, p) => s + p.tier.units, 0),
      risked,
      expected,
      expectedPct: risked ? expected / risked : 0,
      bankrollPct: risked / (settings.bankroll || 1),
      // Sum of win probabilities = the expected number of winners. Reporting
      // this rather than a projected profit keeps the variance visible.
      expectedWinners: plays.reduce((s, p) => s + p.best.modelProb, 0)
    }
  }
}

/** Group games into days for the card's day selector. */
export function daysFrom(games) {
  const map = new Map()
  for (const g of games) {
    const k = dayKey(g.kickoff)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(g)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({
      key,
      kickoff: list[0].kickoff,
      games: list.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    }))
}

/** How much this card should be trusted. Preseason is the honest problem case. */
export function confidenceOf(games, settings) {
  const preseason = games.filter((g) => g.preseason).length
  const share = games.length ? preseason / games.length : 0

  if (share > 0.5) {
    return {
      level: 'low',
      label: 'Low confidence — preseason',
      note: `Projections on these games are shrunk ${Math.round(
        (settings.preseasonShrink ?? 0.55) * 100
      )}% toward a pick'em because starters play a handful of snaps and depth charts are not real yet. Treat this card as a dry run for the method, not as a set of plays worth money.`
    }
  }
  if (share > 0) {
    return {
      level: 'mixed',
      label: 'Mixed slate',
      note: 'Some games on this card are preseason and carry the same roster uncertainty.'
    }
  }
  return {
    level: 'normal',
    label: 'Regular season',
    note: 'Model output is an estimate. Edges are only as good as the ratings behind them.'
  }
}
