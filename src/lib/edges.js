/**
 * edges.js — where the model meets the market.
 *
 * For every side of every market at every book, compare the model's
 * probability against the book's own no-vig probability, then express the
 * gap three ways: in points, in expected value, and in stake size.
 */

import {
  devig, expectedValue, kelly, coverProbability, overProbability,
  marginFromWinProb, impliedProb
} from './odds.js'
import { bestPrice } from '../data/markets.js'

/**
 * @returns {Array} plays sorted by expected value, richest first
 */
export function computeEdges(game, market, projection, s) {
  if (!market || !projection) return []
  const plays = []
  const sigma = s.marginSigma

  for (const book of market.books) {
    // ---- Spread ----
    for (const side of ['home', 'away']) {
      const line = book.spread[side].line
      const price = book.spread[side].price
      const margin = side === 'home' ? projection.margin : -projection.margin
      const model = coverProbability(margin, line, sigma)
      const { probs } = devig([book.spread.home.price, book.spread.away.price], s.devigMethod)
      const marketProb = side === 'home' ? probs[0] : probs[1]
      const modelLine = side === 'home' ? projection.modelSpreadHome : projection.modelSpreadAway

      plays.push(makePlay({
        game, book, type: 'spread', side, line, price,
        label: `${abbrFor(game, side)} ${fmtLine(line)}`,
        model, marketProb, edgePoints: line - modelLine, s
      }))
    }

    // ---- Total ----
    const over = overProbability(projection.total, book.total.line, s.totalSigma)
    const under = { win: 1 - over.win - over.push, lose: over.win, push: over.push }
    const { probs: tProbs } = devig([book.total.over, book.total.under], s.devigMethod)
    plays.push(makePlay({
      game, book, type: 'total', side: 'over', line: book.total.line, price: book.total.over,
      label: `Over ${book.total.line}`, model: over, marketProb: tProbs[0],
      edgePoints: projection.total - book.total.line, s
    }))
    plays.push(makePlay({
      game, book, type: 'total', side: 'under', line: book.total.line, price: book.total.under,
      label: `Under ${book.total.line}`, model: under, marketProb: tProbs[1],
      edgePoints: book.total.line - projection.total, s
    }))

    // ---- Moneyline ----
    const { probs: mProbs } = devig([book.moneyline.home, book.moneyline.away], s.devigMethod)
    for (const side of ['home', 'away']) {
      const p = side === 'home' ? projection.homeWinProb : projection.awayWinProb
      const marketProb = side === 'home' ? mProbs[0] : mProbs[1]
      plays.push(makePlay({
        game, book, type: 'moneyline', side, line: null, price: book.moneyline[side],
        label: `${abbrFor(game, side)} ML`,
        model: { win: p, lose: 1 - p, push: 0 }, marketProb,
        edgePoints: marginFromWinProb(p, sigma) - marginFromWinProb(marketProb, sigma), s
      }))
    }
  }

  return plays.sort((a, b) => b.ev - a.ev)
}

function makePlay({ game, book, type, side, line, price, label, model, marketProb, edgePoints, s }) {
  const ev = expectedValue(model.win, price, model.push)
  return {
    id: `${game.id}:${type}:${side}:${book.key}`,
    gameId: game.id,
    matchup: `${game.away} @ ${game.home}`,
    kickoff: game.kickoff,
    type, side, line, price, label,
    book: book.name,
    bookKey: book.key,
    sharp: book.sharp,
    modelProb: model.win,
    pushProb: model.push,
    marketProb,
    impliedProb: impliedProb(price),
    probEdge: model.win - marketProb,
    edgePoints,
    ev,
    stake: kelly(model.win, price, model.push, s.kellyFraction) * s.bankroll,
    qualified: ev >= s.minEdge
  }
}

const abbrFor = (game, side) => (side === 'home' ? game.home : game.away)
export const fmtLine = (n) => (n > 0 ? `+${n}` : `${n}`)

/**
 * One headline play per game — the strongest qualified edge, taken at the
 * best price available anywhere. This is what a game card shows.
 */
export function bestPlayForGame(plays) {
  if (!plays.length) return null
  const top = plays[0]
  return top.ev > 0 ? top : null
}

/** Collapse per-book plays into one row per market side, at the best number. */
export function consensusPlays(game, market, projection, s) {
  const all = computeEdges(game, market, projection, s)
  const byKey = new Map()
  for (const p of all) {
    const key = `${p.type}:${p.side}`
    const existing = byKey.get(key)
    if (!existing || p.ev > existing.ev) byKey.set(key, p)
  }
  return [...byKey.values()].sort((a, b) => b.ev - a.ev)
}

export { bestPrice }

/** Convert a computed play into a slip leg. */
export const toSlipLeg = (play) => ({
  id: play.id,
  label: play.label,
  matchup: play.matchup,
  gameId: play.gameId,
  book: play.book,
  price: play.price,
  modelProb: play.modelProb,
  marketProb: play.marketProb,
  pushProb: play.pushProb,
  ev: play.ev,
  suggestedStake: play.stake,
  stake: Math.max(1, Math.round(play.stake)) || 25
})
