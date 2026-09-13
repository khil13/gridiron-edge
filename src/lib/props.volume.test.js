import { describe, it, expect } from 'vitest'
import { volumePlaysForGame } from './props.js'
import { tierForVolume, NO_PLAY } from './card.js'

const game = { id: 'g1', home: 'CIN', away: 'DET' }
const proj = { homeTeamTotal: 24, awayTeamTotal: 20 }

const realPlayer = (overrides = {}) => ({
  id: 'p1', name: 'Real Receiver', team: 'CIN', position: 'WR', role: 'WR1', injury: null,
  stats: { games: 8, receivingYards: 640, receptions: 48 }, // 80 yds/g real rate
  ...overrides
})

const syntheticPlayer = (overrides = {}) => ({
  id: 'p2', name: 'No Data WR', team: 'DET', position: 'WR', role: 'WR1', injury: null,
  stats: null,
  ...overrides
})

const rushMarket = (side, price, over = {}) => ({
  market: 'receivingYards', book: 'FanDuel', player: 'Real Receiver', side, line: 74.5, price, ...over
})

describe('volumePlaysForGame', () => {
  it('prices a real player with a matching over/under pair', () => {
    const rosters = { players: [realPlayer()] }
    const offers = [
      rushMarket('over', -115),
      rushMarket('under', -105)
    ]
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings: {} })

    expect(plays.length).toBe(2)
    const over = plays.find((p) => p.side === 'over')
    const under = plays.find((p) => p.side === 'under')
    expect(over.player).toBe('Real Receiver')
    expect(over.market).toBe('receivingYards')
    // Over and under probabilities should sum to ~1 (no push modelled here).
    expect(over.modelProb + under.modelProb).toBeCloseTo(1, 5)
    // Fair (devigged) probabilities should sum to ~1 too.
    expect(over.fair + under.fair).toBeCloseTo(1, 2)
  })

  it('never prices a player with no real season rate (synthetic)', () => {
    const rosters = { players: [syntheticPlayer()] }
    const offers = [
      { market: 'receivingYards', book: 'FanDuel', player: 'No Data WR', side: 'over', line: 40.5, price: -110 },
      { market: 'receivingYards', book: 'FanDuel', player: 'No Data WR', side: 'under', line: 40.5, price: -110 }
    ]
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings: {} })
    expect(plays).toEqual([])
  })

  it('ignores an offer with only one side posted', () => {
    const rosters = { players: [realPlayer()] }
    const offers = [rushMarket('over', -115)] // no matching under
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings: {} })
    expect(plays).toEqual([])
  })

  it('does not pair an over and under from different books', () => {
    const rosters = { players: [realPlayer()] }
    const offers = [
      rushMarket('over', -115, { book: 'FanDuel' }),
      rushMarket('under', -105, { book: 'DraftKings' })
    ]
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings: {} })
    expect(plays).toEqual([])
  })

  it('ignores a player not found on the roster', () => {
    const rosters = { players: [realPlayer()] }
    const offers = [
      { market: 'receivingYards', book: 'FanDuel', player: 'Nobody On This Roster', side: 'over', line: 40.5, price: -110 },
      { market: 'receivingYards', book: 'FanDuel', player: 'Nobody On This Roster', side: 'under', line: 40.5, price: -110 }
    ]
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings: {} })
    expect(plays).toEqual([])
  })
})

describe('tierForVolume', () => {
  const base = { ev: 0, edge: 0 }

  it('returns NO_PLAY below the lean threshold', () => {
    expect(tierForVolume({ ...base, ev: 0.005, edge: 0.005 })).toBe(NO_PLAY)
  })

  it('qualifies a lean once both EV and edge clear the bar', () => {
    const tier = tierForVolume({ ...base, ev: 0.025, edge: 0.02 })
    expect(tier.units).toBe(1)
    expect(tier.label).toBe('Lean')
  })

  it('reaches the top tier, unlike a touchdown prop, capped at 3 units', () => {
    const tier = tierForVolume({ ...base, ev: 0.08, edge: 0.05 })
    expect(tier.units).toBe(3)
    expect(tier.label).toBe('Best bet')
  })

  it('flags an implausibly large edge as "Check model" and caps it at 1 unit', () => {
    const tier = tierForVolume({ ...base, ev: 0.5, edge: 0.3 })
    expect(tier.suspicious).toBe(true)
    expect(tier.units).toBe(1)
  })
})
