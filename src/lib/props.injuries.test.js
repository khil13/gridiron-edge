import { describe, it, expect } from 'vitest'
import { isRuledOut, analyseAnytimeTouchdowns, volumePlaysForGame } from './props.js'
import { buildPropOffers } from '../data/propMarkets.js'

describe('isRuledOut', () => {
  it('matches the official "Out" designation, case-insensitively, trimmed', () => {
    expect(isRuledOut('Out')).toBe(true)
    expect(isRuledOut('out')).toBe(true)
    expect(isRuledOut(' OUT ')).toBe(true)
  })

  it('does not match a designation that still might play', () => {
    expect(isRuledOut('Doubtful')).toBe(false)
    expect(isRuledOut('Questionable')).toBe(false)
    expect(isRuledOut('Active')).toBe(false)
  })

  it('does not match an inactive-roster status that happens to contain other words', () => {
    expect(isRuledOut('Injured Reserve')).toBe(false)
  })

  it('handles missing input', () => {
    expect(isRuledOut(null)).toBe(false)
    expect(isRuledOut(undefined)).toBe(false)
    expect(isRuledOut('')).toBe(false)
  })
})

const game = { id: 'g1', home: 'DET', away: 'CIN' }
const proj = { homeTeamTotal: 24, awayTeamTotal: 20, margin: 4 }
const ratings = { DET: { ppg: 22 }, CIN: { ppg: 21 } }

const detRoster = (wr1Injury = null) => [
  { id: 1, name: 'Home Runner One', team: 'DET', position: 'RB', role: 'RB1', injury: null, tds: 10, stats: { games: 16, rushingYards: 1200, rushingAttempts: 220, receivingYards: 300, receptions: 40 } },
  { id: 2, name: 'Home Runner Two', team: 'DET', position: 'RB', role: 'RB2', injury: null, tds: 3, stats: { games: 16, rushingYards: 400, rushingAttempts: 90, receivingYards: 100, receptions: 15 } },
  { id: 3, name: 'Home Wideout One', team: 'DET', position: 'WR', role: 'WR1', injury: wr1Injury, tds: 8, stats: { games: 16, receivingYards: 1150, receptions: 100 } },
  { id: 4, name: 'Home Wideout Two', team: 'DET', position: 'WR', role: 'WR2', injury: null, tds: 5, stats: { games: 16, receivingYards: 700, receptions: 60 } },
  { id: 5, name: 'Home Tight End', team: 'DET', position: 'TE', role: 'TE1', injury: null, tds: 4, stats: { games: 16, receivingYards: 600, receptions: 55 } }
]
const cinRoster = [
  { id: 9, name: 'Away Wideout One', team: 'CIN', position: 'WR', role: 'WR1', injury: null, tds: 11, stats: { games: 16, receivingYards: 1400, receptions: 110 } },
  { id: 10, name: 'Away Wideout Two', team: 'CIN', position: 'WR', role: 'WR2', injury: null, tds: 4, stats: { games: 16, receivingYards: 650, receptions: 55 } }
]

describe('analyseAnytimeTouchdowns — ruled-out players', () => {
  it('drops a player officially ruled Out from the projected field', () => {
    const rosters = { players: [...detRoster('Out'), ...cinRoster] }
    const { projected } = analyseAnytimeTouchdowns({ game, proj, rosters, props: null })
    expect(projected.some((p) => p.name === 'Home Wideout One')).toBe(false)
    expect(projected.some((p) => p.name === 'Home Wideout Two')).toBe(true)
  })

  it('still shows a Questionable or Doubtful player — only Out is excluded', () => {
    const rosters = { players: [...detRoster('Questionable'), ...cinRoster] }
    const { projected } = analyseAnytimeTouchdowns({ game, proj, rosters, props: null })
    expect(projected.some((p) => p.name === 'Home Wideout One')).toBe(true)
  })

  it('redistributes the ruled-out player\'s vacated share to his real teammates, not just removing it', () => {
    const healthyRosters = { players: [...detRoster(null), ...cinRoster] }
    const outRosters = { players: [...detRoster('Out'), ...cinRoster] }

    const healthy = analyseAnytimeTouchdowns({ game, proj, rosters: healthyRosters, props: null }).projected
    const withOut = analyseAnytimeTouchdowns({ game, proj, rosters: outRosters, props: null }).projected

    const detSum = (list) => list.filter((p) => p.team === 'DET').reduce((s, p) => s + p.lambda, 0)
    // The team's total expected touchdowns is conserved either way (that's
    // normaliseField's job); what should move is how it's split up.
    expect(detSum(healthy)).toBeCloseTo(detSum(withOut), 5)

    const teammate = (list) => list.find((p) => p.name === 'Home Wideout Two')
    expect(teammate(withOut).lambda).toBeGreaterThan(teammate(healthy).lambda)
  })
})

describe('volumePlaysForGame — ruled-out players', () => {
  const offers = [
    { market: 'receivingYards', book: 'FanDuel', player: 'Home Wideout One', side: 'over', line: 74.5, price: -115 },
    { market: 'receivingYards', book: 'FanDuel', player: 'Home Wideout One', side: 'under', line: 74.5, price: -105 }
  ]

  it('never prices a player officially ruled Out, even with a matching real offer', () => {
    const rosters = { players: [...detRoster('Out'), ...cinRoster] }
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings })
    expect(plays.some((p) => p.player === 'Home Wideout One')).toBe(false)
  })

  it('still prices a healthy player with the same shape of offer', () => {
    const rosters = { players: [...detRoster(null), ...cinRoster] }
    const plays = volumePlaysForGame({ game, proj, rosters, offers, ratings })
    expect(plays.some((p) => p.player === 'Home Wideout One')).toBe(true)
  })
})

describe('buildPropOffers (simulated) — ruled-out players', () => {
  it('builds no anytime or volume offer for a player ruled Out', () => {
    const rosters = { players: [...detRoster('Out'), ...cinRoster] }
    const result = buildPropOffers({ game, proj, rosters, ratings })
    expect(result.anytime.some((o) => o.player === 'Home Wideout One')).toBe(false)
    expect(result.volume.some((o) => o.player === 'Home Wideout One')).toBe(false)
  })
})
