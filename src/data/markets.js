/**
 * markets.js — simulated sportsbook prices.
 *
 * IMPORTANT: these numbers are generated, not scraped. They exist so the
 * analytics surfaces have something coherent to chew on offline. Set
 * VITE_ODDS_API_KEY to replace this entire module with live prices.
 *
 * The generator builds a consensus line from the model's own projection plus
 * noise, then disperses each book around that consensus and prices both sides
 * to a realistic hold. That produces the thing the app is actually about:
 * small, believable disagreements between books and model.
 */

import { mulberry32 } from '../lib/model.js'
import { probToAmerican, winProbFromMargin, coverProbability, overProbability } from '../lib/odds.js'
import { SPORTSBOOKS } from './schedule.js'

const HOLD = 0.045              // 4.5% two-way hold, typical US retail
const SHARP_HOLD = 0.032        // reduced-juice books
const CONSENSUS_NOISE = 1.15    // points of disagreement between model and market
const BOOK_DISPERSION = 0.55    // how far individual books stray from consensus

const hashSeed = (str) => {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const toHalf = (v) => Math.round(v * 2) / 2

/** Price two outcomes to a target hold. */
function priceTwoWay(pA, pB, hold = HOLD) {
  const scale = (1 + hold) / (pA + pB)
  return [probToAmerican(pA * scale), probToAmerican(pB * scale)]
}

/**
 * @param {Array} games      schedule entries
 * @param {Function} project (game) => projection from model.js
 */
export function buildMarkets(games, project) {
  const markets = {}

  for (const game of games) {
    const proj = project(game)
    if (!proj) continue

    const seed = hashSeed(game.id)
    const rand = mulberry32(seed)

    // The market's own belief about the game, which is not the model's.
    const gaussian = () => (rand() + rand() + rand() + rand() - 2) * 0.866
    const consensusMargin = proj.margin + gaussian() * CONSENSUS_NOISE
    const consensusSpreadHome = toHalf(-consensusMargin)
    const consensusTotal = toHalf(proj.total + gaussian() * 1.4)

    const books = SPORTSBOOKS.map((book, i) => {
      const jitter = () => (rand() - 0.5) * 2 * BOOK_DISPERSION
      // Pinnacle and Circa post sharper, tighter markets.
      const sharp = book.key === 'pin' || book.key === 'circa'
      const bookHold = sharp ? SHARP_HOLD + (rand() - 0.5) * 0.006 : HOLD + (rand() - 0.5) * 0.014
      // Retail books post round juice (-110, -115) rather than exact fair
      // prices. Sharp books really do quote -104s, so leave those alone.
      const post = (a) => (sharp ? a : Math.round(a / 5) * 5)

      const spreadHome = toHalf(consensusSpreadHome + (sharp ? jitter() * 0.4 : jitter()))
      const totalLine = toHalf(consensusTotal + (sharp ? jitter() * 0.4 : jitter()))

      const cover = coverProbability(consensusMargin, spreadHome)
      const coverAway = coverProbability(-consensusMargin, -spreadHome)
      const [spHome, spAway] = priceTwoWay(cover.win, coverAway.win, bookHold).map(post)

      const over = overProbability(consensusTotal, totalLine)
      const under = { win: 1 - over.win - over.push }
      const [ovPrice, unPrice] = priceTwoWay(over.win, under.win, bookHold).map(post)

      const pHome = winProbFromMargin(consensusMargin)
      const [mlHome, mlAway] = priceTwoWay(pHome, 1 - pHome, bookHold * 1.35).map(post)

      return {
        key: book.key,
        name: book.name,
        sharp,
        spread: { home: { line: spreadHome, price: spHome }, away: { line: -spreadHome, price: spAway } },
        total: { line: totalLine, over: ovPrice, under: unPrice },
        moneyline: { home: mlHome, away: mlAway }
      }
    })

    // Line movement since the game was posted, oldest first.
    const openSpread = toHalf(consensusSpreadHome + gaussian() * 1.4)
    const steps = 9
    const movement = Array.from({ length: steps }, (_, i) => {
      const t = i / (steps - 1)
      const eased = t * t * (3 - 2 * t)
      const value = openSpread + (consensusSpreadHome - openSpread) * eased + (rand() - 0.5) * 0.25 * (1 - t)
      return { step: i, spreadHome: Math.round(value * 4) / 4 }
    })
    movement[movement.length - 1].spreadHome = consensusSpreadHome

    markets[game.id] = {
      gameId: game.id,
      consensus: { spreadHome: consensusSpreadHome, total: consensusTotal },
      open: { spreadHome: openSpread },
      movement,
      books,
      simulated: true
    }
  }

  return markets
}

/** Find the best available price for a given side across all books. */
export function bestPrice(market, market_type, side) {
  if (!market) return null
  let best = null
  for (const b of market.books) {
    let line, price
    if (market_type === 'spread') { line = b.spread[side].line; price = b.spread[side].price }
    else if (market_type === 'total') { line = b.total.line; price = side === 'over' ? b.total.over : b.total.under }
    else { line = null; price = b.moneyline[side] }

    // Better line wins first, then better price at the same line.
    if (!best) { best = { book: b, line, price }; continue }
    if (line !== null && market_type === 'spread' && line > best.line) { best = { book: b, line, price }; continue }
    if (line !== null && market_type === 'total') {
      const better = side === 'over' ? line < best.line : line > best.line
      if (better) { best = { book: b, line, price }; continue }
      if (line !== best.line) continue
    }
    if (line === best.line && price > best.price) best = { book: b, line, price }
    if (market_type === 'moneyline' && price > best.price) best = { book: b, line, price }
  }
  return best
}
