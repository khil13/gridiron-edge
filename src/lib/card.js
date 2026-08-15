/**
 * card.js — the Card of the Day.
 *
 * A card is not "the best plays." It is at most ONE play per game, chosen at
 * the best price available anywhere, with everything that fails to clear the
 * bar shown explicitly as a pass.
 *
 * Two rules drive the whole thing:
 *
 *   1. One play per game. Two sides of the same game are the same opinion
 *      expressed twice — a spread and a total on one game correlate, and
 *      stacking them silently doubles your exposure to a single roster being
 *      mis-rated. So the card takes the strongest view per game and stops.
 *
 *   2. Passes are shown. A card with a play on every game is not a card, it
 *      is a schedule. The games you skip are as much a part of the output as
 *      the games you take, and hiding them makes a thin day look strong.
 */

import { dayKey } from './format.js'

/**
 * Conviction tiers, expressed in units — the way stakes are actually talked
 * about. Thresholds are deliberately strict: EV alone is not enough, because
 * a large EV built on a quarter-point of disagreement is mostly rounding.
 * A play must clear BOTH an EV bar and a points-of-edge bar to move up a tier.
 */
export const TIERS = [
  { units: 3, label: 'Best bet', minEv: 0.05, minPoints: 1.5, tone: 'edge' },
  { units: 2, label: 'Strong',   minEv: 0.03, minPoints: 1.0, tone: 'edge' },
  { units: 1, label: 'Lean',     minEv: 0.015, minPoints: 0.5, tone: 'chalk' }
]

/**
 * Above this, an "edge" is almost certainly a modelling error rather than
 * free money. Real, repeatable edges against a priced market live in the
 * low single digits; a market is not going to leave 15% on the table on a
 * side anyone can bet. Derivative markets like team totals are the usual
 * culprit, because their smaller standard deviation turns a modest
 * disagreement into a large-looking probability gap.
 */
export const IMPLAUSIBLE_EV = 0.12

/** Highest tier a play qualifies for, or null if it clears none. */
export function tierFor(play) {
  const points = Math.abs(play.edgePoints ?? 0)
  const tier = TIERS.find((t) => play.ev >= t.minEv && points >= t.minPoints) || null
  if (!tier) return null

  // Do not let a suspicious number buy its way to the top of the card.
  // It gets flagged and capped at one unit instead.
  if (play.ev >= IMPLAUSIBLE_EV) {
    return { ...tier, units: 1, label: 'Check model', tone: 'live', suspicious: true }
  }
  return tier
}

/**
 * Reason a game produced no play. Being specific here is the difference
 * between a card that teaches you something and one that just looks empty.
 */
function passReason(best) {
  if (!best) return 'No priced market'
  const points = Math.abs(best.edgePoints ?? 0)
  if (best.ev <= 0) return 'Model agrees with the market'
  if (points < 0.5) return `Only ${points.toFixed(1)} pts of disagreement`
  return `Edge too thin (${(best.ev * 100).toFixed(1)}% EV)`
}

/**
 * Build the card for a set of games.
 *
 * @param {Array}  games      dataset games, each carrying allPlays
 * @param {object} settings   model settings (unit size derives from bankroll)
 * @returns {{ plays, passes, stats }}
 */
export function buildCard(games, settings) {
  const unit = (settings.bankroll ?? 1000) * 0.01 // 1 unit = 1% of bankroll

  const entries = games.map((game) => {
    // Best available price for each distinct market side, then the single
    // strongest view on the game.
    const bySide = new Map()
    for (const p of game.allPlays ?? []) {
      const k = `${p.type}:${p.side}`
      const cur = bySide.get(k)
      if (!cur || p.ev > cur.ev) bySide.set(k, p)
    }
    const ranked = [...bySide.values()].sort((a, b) => b.ev - a.ev)
    const best = ranked[0] ?? null
    const tier = best ? tierFor(best) : null

    // The runner-up is worth surfacing: if the second-best play is on the
    // same game it is deliberately NOT on the card, and saying so explains
    // the one-play-per-game rule without a footnote.
    const alternate = ranked[1] ?? null

    return { game, best, tier, alternate, reason: tier ? null : passReason(best) }
  })

  const plays = entries
    .filter((e) => e.tier)
    .map((e) => ({
      ...e,
      stake: e.tier.units * unit,
      // Kelly is computed per play from the model's own probability; where it
      // disagrees sharply with the flat tier stake, that is worth showing.
      kellyStake: e.best.stake
    }))
    .sort((a, b) => b.tier.units - a.tier.units || b.best.ev - a.best.ev)

  const passes = entries.filter((e) => !e.tier)

  const suspicious = plays.filter((p) => p.tier.suspicious).length
  const risked = plays.reduce((s, p) => s + p.stake, 0)
  const expected = plays.reduce((s, p) => s + p.best.ev * p.stake, 0)

  return {
    plays,
    passes,
    stats: {
      unit,
      count: plays.length,
      suspicious,
      units: plays.reduce((s, p) => s + p.tier.units, 0),
      risked,
      expected,
      expectedPct: risked ? expected / risked : 0,
      bankrollPct: risked / (settings.bankroll || 1),
      // Sum of win probabilities = the expected number of winners. Reporting
      // this rather than a projected profit keeps the variance visible: a
      // positive-EV card still loses money more often than people expect.
      expectedWinners: plays.reduce((s, p) => s + p.best.modelProb, 0)
    }
  }
}

/** Group games into days, newest last, for the card's day selector. */
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

/**
 * How much this card should be trusted. Preseason is the honest problem case:
 * the model already shrinks its own projections by more than half, which means
 * it is telling you it does not know these rosters. A card built on top of
 * that deserves a visible warning rather than a footnote.
 */
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

/**
 * Freeze a card so it can be graded later.
 *
 * Everything needed to settle the play is copied in: the market, the side,
 * the number, the price and the stake. Nothing is looked up again at grading
 * time except the final score, because the model that produced this card
 * will have changed by then and re-deriving the plays would be grading a
 * card that was never actually issued.
 */
export function lockCard({ dayKey, kickoff, plays, settings, source }) {
  return {
    id: `card-${dayKey}`,
    dayKey,
    kickoff,
    lockedAt: new Date().toISOString(),
    source: source || 'simulated',
    // The settings are recorded so a future you can see which model made
    // these calls, rather than assuming it was the current one.
    settings: {
      homeField: settings.homeField,
      eloPerPoint: settings.eloPerPoint,
      marginSigma: settings.marginSigma,
      devigMethod: settings.devigMethod,
      preseasonShrink: settings.preseasonShrink,
      kellyFraction: settings.kellyFraction,
      bankroll: settings.bankroll
    },
    legs: plays.map(({ best, tier, stake, game }) => ({
      id: best.id,
      gameId: best.gameId,
      matchup: best.matchup,
      kickoff: best.kickoff,
      label: best.label,
      type: best.type,
      side: best.side,
      line: best.line,
      price: best.price,
      book: best.book,
      stake,
      units: tier.units,
      tierLabel: tier.label,
      suspicious: !!tier.suspicious,
      modelProb: best.modelProb,
      marketProb: best.marketProb,
      edgePoints: best.edgePoints,
      ev: best.ev
    }))
  }
}
