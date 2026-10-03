import { describe, it, expect, vi } from 'vitest'

// AAA allows well above league average on both sides; CCC well below.
// League-average receiving/game across AAA+BBB+CCC = (300+200+100)/3 = 200.
vi.mock('../data/generated/team-defense.json', () => ({
  default: {
    latestSeason: 2026,
    seasons: {
      2026: {
        AAA: { receivingYardsAllowed: 900, receivingTdsAllowed: 6, rushingYardsAllowed: 600, rushingTdsAllowed: 4, games: 3, ranks: { receivingYardsAllowed: 1, rushingYardsAllowed: 1, receivingTdsAllowed: 1, rushingTdsAllowed: 1 } },
        BBB: { receivingYardsAllowed: 600, receivingTdsAllowed: 3, rushingYardsAllowed: 300, rushingTdsAllowed: 1, games: 3, ranks: { receivingYardsAllowed: 2, rushingYardsAllowed: 2, receivingTdsAllowed: 2, rushingTdsAllowed: 2 } },
        CCC: { receivingYardsAllowed: 300, receivingTdsAllowed: 1, rushingYardsAllowed: 150, rushingTdsAllowed: 0, games: 3, ranks: { receivingYardsAllowed: 3, rushingYardsAllowed: 3, receivingTdsAllowed: 3, rushingTdsAllowed: 3 } }
      }
    }
  }
}))

const { projectVolume } = await import('./props.js')

const receivingYardsMarket = { key: 'receivingYards', label: 'Receiving yards', stat: 'receivingYards', positions: ['WR'] }
const receptionsMarket = { key: 'receptions', label: 'Receptions', stat: 'receptions', positions: ['WR'] }

const player = { stats: { games: 8, receivingYards: 640 } } // 80 yds/g, no environment shift

describe('projectVolume — opponent defense adjustment', () => {
  it('scales a projection up against a defense that allows well above league average', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'AAA' })
    expect(v.defense).not.toBeNull()
    expect(v.defense.rank).toBe(1)
    expect(v.defense.factor).toBeGreaterThan(1)
    expect(v.mean).toBeGreaterThan(v.perGame)
  })

  it('scales a projection down against a stingy defense', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'CCC' })
    expect(v.defense.factor).toBeLessThan(1)
    expect(v.mean).toBeLessThan(v.perGame)
  })

  it('damps the adjustment rather than passing the full ratio through', () => {
    // AAA allows 300/g receiving vs league avg 200/g -> raw ratio 1.5.
    // A damped, clamped factor should land well short of that.
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'AAA' })
    expect(v.defense.factor).toBeLessThan(1.5)
    expect(v.defense.factor).toBeLessThanOrEqual(1.25) // the documented clamp
  })

  it('is left off when no opponent is given', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.defense).toBeNull()
    expect(v.mean).toBe(v.perGame)
  })

  it('is left off for a market team-defense.json does not cover (receptions)', () => {
    const p = { stats: { games: 8, receptions: 48 } }
    const v = projectVolume(p, receptionsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'AAA' })
    expect(v.defense).toBeNull()
  })

  it('is left off for an opponent with no usable defense data', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'NOBODY' })
    expect(v.defense).toBeNull()
    expect(v.mean).toBe(v.perGame)
  })

  it('combines with the environment adjustment rather than replacing it', () => {
    // Team projected well above its own average AND a generous defense:
    // both factors should apply, so the combined mean exceeds either alone.
    const envOnly = projectVolume(player, receivingYardsMarket, { teamPoints: 30, teamAverage: 22 })
    const combined = projectVolume(player, receivingYardsMarket, { teamPoints: 30, teamAverage: 22, opponent: 'AAA' })
    expect(combined.mean).toBeGreaterThan(envOnly.mean)
  })
})
