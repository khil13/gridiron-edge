/**
 * card.js — the Card of the Day.
 *
 * A card is not "the best plays." It is at most ONE play per game, chosen at
 * the best price available anywhere, with everything that fails to clear the
 * bar shown explicitly as a pass.
 *
 * Every game on the slate gets the model's best read, so the card is a
 * complete view of the day. But a read and a bet are not the same thing,
 * and the card never pretends otherwise:
 *
 *   1. One play per game. Two sides of the same game are the same opinion
 *      expressed twice — a spread and a total on one game correlate, and
 *      stacking them silently doubles your exposure to a single roster being
 *      mis-rated. So the card takes the strongest view per game and stops.
 *
 *   2. Only some reads carry a stake. A game where the model agrees with the
 *      market is shown as a LEAN at zero units: this is who the model likes,
 *      but there is no edge to pay for the vig, and betting it is how a card
 *      bleeds. Staked units, risk and expected return all count qualifying
 *      plays only.
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
 * The zero-unit tier. Shown so the card covers the whole slate, staked at
 * nothing so the card does not quietly become a bet-everything product.
 */
export const NO_PLAY = { units: 0, label: 'No edge', tone: 'quiet', lean: true }

/**
 * Above this, an "edge" is almost certainly a modelling error rather than
 * free money. Real, repeatable edges against a priced market live in the
 * low single digits; a market is not going to leave 15% on the table on a
 * side anyone can bet. Derivative markets like team totals are the usual
 * culprit, because their smaller standard deviation turns a modest
 * disagreement into a large-looking probability gap.
 */
export const IMPLAUSIBLE_EV = 0.12

/** Highest tier a play qualifies for. Never null — falls back to a lean. */
export function tierFor(play) {
  if (!play) return NO_PLAY
  const points = Math.abs(play.edgePoints ?? 0)
  const tier = TIERS.find((t) => play.ev >= t.minEv && points >= t.minPoints) || null
  if (!tier) return NO_PLAY

  // Do not let a suspicious number buy its way to the top of the card.
  // It gets flagged and capped at one unit instead.
  if (play.ev >= IMPLAUSIBLE_EV) {
    return { ...tier, units: 1, label: 'Check model', tone: 'live', suspicious: true }
  }
  return tier
}

/**
 * Why a read is not worth a stake. Being specific here is the difference
 * between a card that teaches you something and one that just says no.
 */
export function leanReason(best) {
  if (!best) return 'No priced market'
  const points = Math.abs(best.edgePoints ?? 0)
  if (best.ev <= 0) return 'Model agrees with the market — no edge to pay the vig'
  if (points < 0.5) return `Only ${points.toFixed(1)} pts of disagreement`
  return `Edge too thin at ${(best.ev * 100).toFixed(1)}% EV`
}

/**
 * Build the card for a set of games.
 *
 * @param {Array}  games      dataset games, each carrying allPlays
 * @param {object} settings   model settings (unit size derives from bankroll)
 * @returns {{ plays, passes, stats }}
 */
/**
 * How many legs a card should aim for.
 *
 * A one-game Thursday night slate produced a one-leg card, which is not a
 * breakdown of anything. A full Sunday should be broader than a handful.
 * These are targets, not quotas: the card fills up to them from genuinely
 * distinct markets and stops when it runs out rather than padding.
 */
/** Independent markets a single game offers before props are considered. */
export const MARKETS_PER_GAME = 5

export function targetLegs(gameCount) {
  if (gameCount <= 1) return 6
  if (gameCount <= 2) return 8
  if (gameCount <= 5) return 10
  return 12
}

/**
 * The axis a play sits on.
 *
 * Two plays share an axis when they are the same decision: home spread and
 * away spread are one bet expressed two ways, and taking both sides is not
 * diversification, it is paying the vig twice to guarantee a wash. Only one
 * play per axis ever reaches the card.
 */
function axisOf(play) {
  const g = play.gameId
  switch (play.type) {
    case 'spread': return `${g}:spread`
    case 'moneyline': return `${g}:ml`
    case 'total': return `${g}:total`
    case 'teamTotal': return `${g}:tt:${play.side.split('-')[0]}`
    default: return `${g}:${play.type}:${play.side}`
  }
}

export function buildCard(games, settings) {
  const unit = (settings.bankroll ?? 1000) * 0.01
  const target = targetLegs(games.length)

  // Every distinct market position available anywhere on the slate, best
  // price per axis, ranked by expected value.
  const byAxis = new Map()
  for (const game of games) {
    for (const p of game.allPlays ?? []) {
      const axis = axisOf(p)
      const current = byAxis.get(axis)
      if (!current || p.ev > current.play.ev) byAxis.set(axis, { play: p, game })
    }
  }

  const ranked = [...byAxis.values()].sort((a, b) => b.play.ev - a.play.ev)

  // Pass one: the strongest view on each game, so a full slate is covered
  // before any game is doubled up on.
  const chosen = []
  const usedGames = new Set()
  for (const entry of ranked) {
    if (usedGames.has(entry.game.id)) continue
    usedGames.add(entry.game.id)
    chosen.push({ ...entry, sameGameIndex: 0 })
  }

  // Pass two: fill toward the target with second and third looks, taking
  // the best remaining regardless of which game it belongs to.
  const perGame = new Map(chosen.map((c) => [c.game.id, 1]))
  if (chosen.length < target) {
    for (const entry of ranked) {
      if (chosen.length >= target) break
      if (chosen.some((c) => c.play.id === entry.play.id)) continue
      const n = perGame.get(entry.game.id) ?? 0
      chosen.push({ ...entry, sameGameIndex: n })
      perGame.set(entry.game.id, n + 1)
    }
  }

  const entries = chosen.map(({ play, game, sameGameIndex }) => {
    const tier = tierFor(play)
    const alternates = (game.allPlays ?? [])
      .filter((p) => axisOf(p) !== axisOf(play) && p.ev > 0)
      .sort((a, b) => b.ev - a.ev)

    return {
      game,
      best: play,
      tier,
      alternate: alternates[0] ?? null,
      reason: tier.lean ? leanReason(play) : null,
      stake: tier.units * unit,
      kellyStake: play.stake ?? 0,
      sameGameIndex,
      // Legs from one game move together. Four plays on a shootout is one
      // opinion at four times the stake, not four independent bets.
      correlated: sameGameIndex > 0
    }
  })

  const reads = entries.sort(
    (a, b) => b.tier.units - a.tier.units || b.best.ev - a.best.ev
  )
  const plays = reads.filter((e) => e.tier.units > 0)
  const leans = reads.filter((e) => e.tier.units === 0)
  const passes = leans

  const suspicious = plays.filter((p) => p.tier.suspicious).length
  const risked = plays.reduce((s, p) => s + p.stake, 0)
  const expected = plays.reduce((s, p) => s + p.best.ev * p.stake, 0)

  // How much of the risk sits on games carrying more than one leg.
  const gameExposure = {}
  for (const p of plays) {
    gameExposure[p.game.id] = (gameExposure[p.game.id] ?? 0) + p.stake
  }
  const stacked = Object.entries(gameExposure).filter(
    ([id]) => plays.filter((p) => p.game.id === id).length > 1
  )

  return {
    reads,
    plays,
    leans,
    passes,
    stats: {
      unit,
      target,
      count: plays.length,
      reads: reads.length,
      leanCount: leans.length,
      suspicious,
      risked,
      expected,
      expectedPct: risked ? expected / risked : 0,
      bankrollPct: risked / (settings.bankroll || 1),
      expectedWinners: plays.reduce((s, p) => s + p.best.modelProb, 0),
      stackedGames: stacked.length,
      stackedRisk: stacked.reduce((s, [, amount]) => s + amount, 0),
      // A game carries five independent markets: spread, moneyline, total
      // and each side's team total. Below the target means the slate has
      // simply run out of distinct positions, and the honest response is to
      // say so rather than list the same bet twice at different numbers.
      shortfall: Math.max(0, target - reads.length)
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
    legs: plays.filter((p) => p.tier.units > 0).map(({ best, tier, stake, game }) => ({
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
