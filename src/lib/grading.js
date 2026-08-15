/**
 * grading.js — settle the card and count the damage.
 *
 * THE RULE THAT MAKES THIS HONEST: a card must be FROZEN when it is issued.
 *
 * It is tempting to grade by re-deriving yesterday's plays from today's
 * model. Do not. The model changes — you move a slider, you rebuild ratings,
 * you tune the devig method — and a regenerated card is not the card you
 * would actually have bet. Grading that is marking your own homework, and it
 * will flatter you every time, because the model has since absorbed the
 * results it is being graded against.
 *
 * So the card is snapshotted at lock time with its prices, lines and stakes,
 * and grading only ever reads that snapshot.
 */

import { americanToDecimal, impliedProb } from './odds.js'

/* ---------- Settling a single play ---------- */

/**
 * @param {object} leg   a locked play: { type, side, line, price, stake }
 * @param {object} game  the finished game, needs homeScore / awayScore
 * @returns {'win'|'loss'|'push'|'pending'}
 */
export function gradeLeg(leg, game) {
  if (!game || game.status !== 'final') return 'pending'
  const h = game.homeScore
  const a = game.awayScore
  if (h == null || a == null) return 'pending'

  switch (leg.type) {
    case 'spread': {
      // A spread is graded from the perspective of the side you took: add
      // your number to your team's score and see who is ahead.
      const margin = leg.side === 'home' ? h - a : a - h
      const result = margin + leg.line
      return result > 0 ? 'win' : result < 0 ? 'loss' : 'push'
    }

    case 'total': {
      const total = h + a
      if (total === leg.line) return 'push'
      return leg.side === 'over'
        ? total > leg.line ? 'win' : 'loss'
        : total < leg.line ? 'win' : 'loss'
    }

    case 'teamTotal': {
      const isHome = leg.side.startsWith('home')
      const pts = isHome ? h : a
      if (pts === leg.line) return 'push'
      return leg.side.endsWith('over')
        ? pts > leg.line ? 'win' : 'loss'
        : pts < leg.line ? 'win' : 'loss'
    }

    case 'moneyline': {
      if (h === a) return 'push' // NFL ties are rare but real
      const won = leg.side === 'home' ? h > a : a > h
      return won ? 'win' : 'loss'
    }

    default:
      return 'pending'
  }
}

/** Profit or loss on a settled leg, in currency. Stake is not returned on a win. */
export function legProfit(leg, result) {
  const stake = leg.stake ?? 0
  if (result === 'win') return stake * (americanToDecimal(leg.price) - 1)
  if (result === 'loss') return -stake
  return 0 // push or pending
}

/* ---------- Settling a whole card ---------- */

export function gradeCard(card, gamesById) {
  const legs = card.legs.map((leg) => {
    const game = gamesById[leg.gameId]
    const result = gradeLeg(leg, game)
    return {
      ...leg,
      result,
      profit: legProfit(leg, result),
      finalScore:
        game && game.status === 'final'
          ? { home: game.homeScore, away: game.awayScore, homeAbbr: game.home, awayAbbr: game.away }
          : null
    }
  })

  const settled = legs.filter((l) => l.result !== 'pending')
  return {
    ...card,
    legs,
    settled: settled.length,
    pending: legs.length - settled.length,
    complete: settled.length === legs.length,
    profit: legs.reduce((s, l) => s + l.profit, 0)
  }
}

/* ---------- The running record ---------- */

/**
 * Aggregate every graded card. Reports units rather than only currency,
 * because unit-denominated results survive a bankroll change.
 */
export function summarise(gradedCards, unitSize = 10) {
  const legs = gradedCards.flatMap((c) => c.legs)
  const settled = legs.filter((l) => l.result !== 'pending')

  const wins = settled.filter((l) => l.result === 'win').length
  const losses = settled.filter((l) => l.result === 'loss').length
  const pushes = settled.filter((l) => l.result === 'push').length
  const decided = wins + losses

  const staked = settled.reduce((s, l) => s + (l.stake ?? 0), 0)
  const profit = settled.reduce((s, l) => s + l.profit, 0)

  // Break-even win rate given the actual prices taken, not an assumed -110.
  const decidedLegs = settled.filter((l) => l.result !== 'push')
  const breakEven = decidedLegs.length
    ? decidedLegs.reduce((s, l) => s + impliedProb(l.price), 0) / decidedLegs.length
    : 0.5238

  const byTier = {}
  for (const l of settled) {
    const k = l.tierLabel || 'Unlabelled'
    byTier[k] = byTier[k] || { wins: 0, losses: 0, pushes: 0, profit: 0, staked: 0 }
    byTier[k][l.result === 'win' ? 'wins' : l.result === 'loss' ? 'losses' : 'pushes'] += 1
    byTier[k].profit += l.profit
    byTier[k].staked += l.stake ?? 0
  }

  const byMarket = {}
  for (const l of settled) {
    const k = l.type
    byMarket[k] = byMarket[k] || { wins: 0, losses: 0, pushes: 0, profit: 0, staked: 0 }
    byMarket[k][l.result === 'win' ? 'wins' : l.result === 'loss' ? 'losses' : 'pushes'] += 1
    byMarket[k].profit += l.profit
    byMarket[k].staked += l.stake ?? 0
  }

  return {
    wins, losses, pushes, decided,
    total: settled.length,
    pending: legs.length - settled.length,
    winRate: decided ? wins / decided : null,
    breakEven,
    staked,
    profit,
    roi: staked ? profit / staked : 0,
    units: profit / (unitSize || 1),
    byTier,
    byMarket,
    significance: significanceOf(wins, decided, breakEven)
  }
}

/* ---------- Is the record meaningful, or is it noise? ---------- */

/**
 * The question every betting record has to answer and almost none do:
 * could this have happened by luck?
 *
 * Computes the one-sided probability of winning at least this many bets if
 * the model had NO edge at all — i.e. if every play were a coin flip at the
 * break-even rate the prices imply. A small number is evidence of an edge;
 * anything above roughly 0.05 means the record is indistinguishable from
 * chance, which is the honest verdict for almost every sample under a few
 * hundred bets.
 */
export function significanceOf(wins, decided, breakEven = 0.5238) {
  if (!decided) return { p: null, verdict: 'No settled plays yet', level: 'none' }

  // P(X >= wins) for X ~ Binomial(decided, breakEven)
  let p = 0
  for (let k = wins; k <= decided; k++) p += binomPmf(k, decided, breakEven)
  p = Math.min(1, Math.max(0, p))

  // How many decided bets it would take for a real edge of the size observed
  // to become detectable. Keeps the sample-size problem concrete.
  const observed = wins / decided
  const lift = observed - breakEven
  const needed =
    lift > 0
      ? Math.ceil((2.7 * Math.sqrt(breakEven * (1 - breakEven)) / lift) ** 2)
      : null

  let verdict
  let level
  if (decided < 30) {
    verdict = `Far too few plays to mean anything. ${decided} settled; hundreds are needed before a record separates skill from luck.`
    level = 'none'
  } else if (p < 0.05) {
    verdict = `Unlikely to be chance alone (p ≈ ${p.toFixed(3)}), though a sample this size still is not proof.`
    level = 'signal'
  } else {
    verdict = `Indistinguishable from luck (p ≈ ${p.toFixed(2)}). This is the normal verdict for a small sample and is not a failure.`
    level = 'noise'
  }

  return { p, verdict, level, needed, observed }
}

function binomPmf(k, n, p) {
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p))
}

function logChoose(n, k) {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
}

/** Lanczos approximation — accurate enough well past any realistic bet count. */
function logGamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = 0.99999999999980993
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1)
  const t = z + g.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}
