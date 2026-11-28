import { describe, it, expect } from 'vitest'
import { SPOTS, defenseSpots, defenseExtras, rankTone, recentValues } from './matchup.js'

const split = (over = {}) => ({
  QB: { passingYards: 2400, rushingYards: 120 },
  RB: { rushingYards: 700, receivingYards: 440, receptions: 58 },
  WR: { receivingYards: 1500, receptions: 124 },
  TE: { receivingYards: 520, receptions: 46 },
  ...over
})
const ranks = (over = {}) => ({
  'QB.passingYards': 9, 'QB.rushingYards': 23, 'RB.rushingYards': 28, 'RB.receivingYards': 2, 'RB.receptions': 2,
  'WR.receivingYards': 13, 'WR.receptions': 11, 'TE.receivingYards': 17, 'TE.receptions': 15,
  sacks: 5, bigPassesAllowed: 7, bigRunsAllowed: 27, ...over
})
const source = (teams, { latestSeason = 2026, prior = {} } = {}) => ({ latestSeason, seasons: { [latestSeason]: teams, [latestSeason - 1]: prior } })
const pit = { games: 10, sacks: 30, bigPassesAllowed: 34, bigRunsAllowed: 20, byPosition: split(), ranks: ranks() }
const eff = {
  latestSeason: 2026,
  seasons: { 2026: { PIT: { redZoneTripsAllowedPerGame: 2.4 }, DEN: { redZoneTripsAllowedPerGame: 3.3 }, LAC: { redZoneTripsAllowedPerGame: 4.3 } } }
}

describe('defenseSpots', () => {
  it('ranks every spot softest first, with per-game averages', () => {
    const d = defenseSpots('PIT', { source: source({ PIT: pit }) })
    expect(d.spots).toHaveLength(SPOTS.length)
    expect(d.spots.map((s) => s.rank)).toEqual([...d.spots.map((s) => s.rank)].sort((a, b) => a - b))
    const rbRec = d.spots.find((s) => s.key === 'RB.receivingYards')
    expect(rbRec.perGame).toBe(44) // 440 over 10 games
    expect(rbRec.rank).toBe(2)
    expect(d.isPrior).toBe(false)
  })

  it('breaks rank ties by the bigger per-game number', () => {
    const d = defenseSpots('PIT', { source: source({ PIT: pit }) })
    expect(d.spots.slice(0, 2).map((s) => s.key)).toEqual(['RB.receivingYards', 'RB.receptions'])
  })

  it('pairs each spot with the lead player at that position', () => {
    expect(SPOTS.find((s) => s.key === 'RB.rushingYards').role).toBe('RB1')
    expect(SPOTS.find((s) => s.key === 'QB.passingYards').role).toBe('QB')
    expect(SPOTS.find((s) => s.key === 'TE.receptions').role).toBe('TE1')
  })

  it('marks only the two spots that held up against real results', () => {
    expect(SPOTS.filter((s) => s.mattered).map((s) => s.key).sort()).toEqual(['RB.rushingYards', 'TE.receivingYards'])
  })

  it('falls back to last season for a team with no games yet, and says so', () => {
    const d = defenseSpots('PIT', { source: source({ PIT: { games: 0 } }, { prior: { PIT: { ...pit, games: 17 } } }) })
    expect(d.isPrior).toBe(true)
    expect(d.season).toBe(2025)
  })

  it('treats a snapshot without positional splits as having none, rather than crashing', () => {
    expect(defenseSpots('PIT', { source: source({ PIT: { games: 10, ranks: {} } }) })).toBeNull()
    expect(defenseSpots('ZZZ', { source: source({ PIT: pit }) })).toBeNull()
  })
})

describe('defenseExtras', () => {
  it('reports sacks, big plays and red-zone trips per game with league ranks', () => {
    const x = defenseExtras('PIT', { source: source({ PIT: pit }), efficiency: eff })
    expect(x.map((e) => e.key)).toEqual(['sacks', 'bigPasses', 'bigRuns', 'redZone'])
    expect(x.find((e) => e.key === 'sacks')).toMatchObject({ perGame: 3, rank: 5, goodForOffenseWhen: 'low' })
    expect(x.find((e) => e.key === 'bigPasses')).toMatchObject({ perGame: 3.4, rank: 7 })
    // Fewest red-zone trips allowed of the three teams: ranked 3rd most.
    expect(x.find((e) => e.key === 'redZone')).toMatchObject({ perGame: 2.4, rank: 3 })
  })

  it('still gives red-zone trips when the defense snapshot has nothing', () => {
    const x = defenseExtras('DEN', { source: source({}), efficiency: eff })
    expect(x).toEqual([{ key: 'redZone', label: 'Red-zone trips allowed', perGame: 3.3, rank: 2, goodForOffenseWhen: 'high' }])
  })
})

describe('rankTone', () => {
  it('reads a top-third "allows the most" rank as good for the offense facing it', () => {
    expect(rankTone(2)).toBe('pos')
    expect(rankTone(30)).toBe('neg')
    expect(rankTone(16)).toBeNull()
  })

  it('reads sacks the other way: a defense that sacks a lot is bad for the offense', () => {
    expect(rankTone(3, 'low')).toBe('neg')
    expect(rankTone(29, 'low')).toBe('pos')
  })

  it('handles a missing rank', () => {
    expect(rankTone(null)).toBeNull()
  })
})

describe('recentValues', () => {
  const recent = { players: { 'jahmyr gibbs|RB': [{ week: 12, opp: 'CHI', rushingYards: 205 }, { week: 11, opp: 'TB', rushingYards: 98 }] } }
  it('pulls one stat from a player\'s recent games, newest first', () => {
    expect(recentValues(recent, 'jahmyr gibbs|RB', 'rushingYards')).toEqual([
      { week: 12, opp: 'CHI', value: 205 }, { week: 11, opp: 'TB', value: 98 }
    ])
  })
  it('treats a stat the row lacks as zero, and an unknown player as no games', () => {
    expect(recentValues(recent, 'jahmyr gibbs|RB', 'receptions').map((g) => g.value)).toEqual([0, 0])
    expect(recentValues(recent, 'nobody|WR', 'receptions')).toEqual([])
    expect(recentValues(null, 'x', 'y')).toEqual([])
  })
})
