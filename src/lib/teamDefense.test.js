import { describe, it, expect, vi } from 'vitest'

vi.mock('../data/generated/team-defense.json', () => ({
  default: {
    latestSeason: 2026,
    seasons: {
      2026: {
        // League-average receiving yards allowed/game across these three
        // teams is (300+200+100)/3 = 200.
        AAA: { receivingYardsAllowed: 900, receivingTdsAllowed: 6, rushingYardsAllowed: 400, rushingTdsAllowed: 2, games: 3, ranks: { receivingYardsAllowed: 1, rushingYardsAllowed: 2, receivingTdsAllowed: 1, rushingTdsAllowed: 2 } },
        BBB: { receivingYardsAllowed: 600, receivingTdsAllowed: 3, rushingYardsAllowed: 300, rushingTdsAllowed: 1, games: 3, ranks: { receivingYardsAllowed: 2, rushingYardsAllowed: 1, receivingTdsAllowed: 2, rushingTdsAllowed: 1 } },
        CCC: { receivingYardsAllowed: 300, receivingTdsAllowed: 1, rushingYardsAllowed: 150, rushingTdsAllowed: 0, games: 3, ranks: { receivingYardsAllowed: 3, rushingYardsAllowed: 3, receivingTdsAllowed: 3, rushingTdsAllowed: 3 } },
        // Not enough games recorded yet — excluded from the league average
        // and unusable as an opponent until it has real data.
        ZZZ: { receivingYardsAllowed: 0, receivingTdsAllowed: 0, rushingYardsAllowed: 0, rushingTdsAllowed: 0, games: 0, ranks: {} }
      },
      2025: {
        OLD: { receivingYardsAllowed: 3400, receivingTdsAllowed: 20, rushingYardsAllowed: 1700, rushingTdsAllowed: 10, games: 17, ranks: { receivingYardsAllowed: 5, rushingYardsAllowed: 5 } }
      }
    }
  }
}))

const { defenseStatsFor, allowedYardsRatio } = await import('./teamDefense.js')

describe('defenseStatsFor', () => {
  it('prefers this season when it has real games', () => {
    const found = defenseStatsFor('AAA')
    expect(found.isPrior).toBe(false)
    expect(found.season).toBe(2026)
  })

  it('falls back to last season when this season has no games yet', () => {
    const found = defenseStatsFor('OLD')
    expect(found.isPrior).toBe(true)
    expect(found.season).toBe(2025)
    expect(found.data.games).toBe(17)
  })

  it('returns null for a team with zero games in both seasons', () => {
    expect(defenseStatsFor('ZZZ')).toBeNull()
  })

  it('returns null for a team with no data at all', () => {
    expect(defenseStatsFor('NOPE')).toBeNull()
  })
})

describe('allowedYardsRatio', () => {
  it('rates a team that allows more than league average above 1', () => {
    // AAA: 900/3 = 300/g receiving vs league avg 200/g -> ratio 1.5
    const r = allowedYardsRatio('AAA', 'receiving')
    expect(r.ratio).toBeCloseTo(1.5, 5)
    expect(r.rank).toBe(1)
    expect(r.isPrior).toBe(false)
  })

  it('rates a stingy defense below 1', () => {
    // CCC: 300/3 = 100/g receiving vs league avg 200/g -> ratio 0.5
    const r = allowedYardsRatio('CCC', 'receiving')
    expect(r.ratio).toBeCloseTo(0.5, 5)
  })

  it('computes the rushing side independently from receiving', () => {
    // League avg rushing: (400+300+150)/3/3 = 850/9 ≈ 94.44/g
    // BBB: 300/3 = 100/g -> ratio ≈ 1.059
    const r = allowedYardsRatio('BBB', 'rushing')
    expect(r.ratio).toBeCloseTo(100 / (850 / 9), 5)
  })

  it('returns null for a side this dataset does not cover', () => {
    expect(allowedYardsRatio('AAA', 'passing')).toBeNull()
  })

  it('returns null for an opponent with no usable data', () => {
    expect(allowedYardsRatio('ZZZ', 'receiving')).toBeNull()
    expect(allowedYardsRatio('NOPE', 'receiving')).toBeNull()
  })
})
