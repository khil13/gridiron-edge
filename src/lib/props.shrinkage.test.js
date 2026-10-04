import { describe, it, expect } from 'vitest'
import { projectVolume, VOLUME_SHRINKAGE_K } from './props.js'

const receivingYardsMarket = { key: 'receivingYards', label: 'Receiving yards', stat: 'receivingYards', positions: ['WR'] }

// WR1's real receivingYards prior is 68 yds/g (VOLUME_PRIORS.WR1.receivingYards in props.js).
const wr1With = (games, total) => ({ role: 'WR1', stats: { games, receivingYards: total } })

describe('projectVolume — shrinkage toward the positional prior', () => {
  it('pulls a one-game sample heavily toward the positional prior', () => {
    // One monster game (150 yds/g observed) should not become next week's
    // full projection — it should regress hard toward the WR1 prior (68).
    const v = projectVolume(wr1With(1, 150), receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.perGame).toBe(150) // the displayed real rate is never altered
    expect(v.shrinkage).not.toBeNull()
    expect(v.shrinkage.prior).toBe(68)
    // weight = 1/(1+K)
    expect(v.shrinkage.weight).toBeCloseTo(1 / (1 + VOLUME_SHRINKAGE_K), 2)
    expect(v.mean).toBeLessThan(150)
    expect(v.mean).toBeGreaterThan(68) // still pulled some weight toward his own hot game
  })

  it('trusts the player\'s own rate almost fully once the sample is large', () => {
    const v = projectVolume(wr1With(16, 68 * 16), receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.shrinkage.weight).toBeGreaterThan(0.8)
    expect(v.mean).toBeCloseTo(68, 0)
  })

  it('shrinks a quiet one-game sample back up toward the prior too, not just hot games down', () => {
    const v = projectVolume(wr1With(1, 10), receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.mean).toBeGreaterThan(10)
    expect(v.mean).toBeLessThan(68)
  })

  it('never shrinks the displayed perGame rate itself, only the projection', () => {
    const v = projectVolume(wr1With(2, 240), receivingYardsMarket, { teamPoints: 22, teamAverage: 22 }) // 120/g real
    expect(v.perGame).toBe(120)
    expect(v.mean).not.toBe(120)
  })

  it('is left off when the role has no matching prior for this market', () => {
    const v = projectVolume({ role: 'DEF', stats: { games: 1, receivingYards: 50 } }, receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.shrinkage).toBeNull()
    expect(v.mean).toBe(50) // falls back to the raw rate, unshrunk, same as before this change
  })

  it('does not apply to a fully synthetic (zero real games) projection', () => {
    const v = projectVolume({ role: 'WR1', stats: null }, receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.synthetic).toBe(true)
    expect(v.shrinkage).toBeNull()
    expect(v.mean).toBe(68) // the prior itself, as before
  })

  it('shrinkage weight increases monotonically with more real games', () => {
    const weights = [1, 2, 4, 8, 16].map(
      (g) => projectVolume(wr1With(g, 70 * g), receivingYardsMarket, { teamPoints: 22, teamAverage: 22 }).shrinkage.weight
    )
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThan(weights[i - 1])
  })
})
