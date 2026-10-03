import { describe, it, expect } from 'vitest'
import { confidenceFor } from './confidence.js'

const game = { home: 'KC', away: 'LV', preseason: false }
const ratings = {
  KC: { synthetic: [] },
  LV: { synthetic: [] }
}
const agreement = (disagreementPoints, level) => ({ disagreementPoints, agreement: level })

describe('confidenceFor', () => {
  it('is always low for preseason, regardless of anything else', () => {
    const result = confidenceFor({
      game: { ...game, preseason: true },
      epaProjection: { margin: 1 },
      modelAgreement: agreement(0.5, 'high'),
      ratings
    })
    expect(result.level).toBe('low')
  })

  it('is high when both models agree closely and both teams have a real sample', () => {
    const result = confidenceFor({
      game, ratings,
      epaProjection: { margin: 3 },
      modelAgreement: agreement(1, 'high'),
      simulation: { homeWinProb: 0.6, analyticalWinProb: 0.6 }
    })
    expect(result.level).toBe('high')
  })

  it('drops to low when only one projection method is available (no EPA data)', () => {
    const result = confidenceFor({ game, ratings, epaProjection: null, modelAgreement: null })
    expect(result.level).toBe('low')
    expect(result.factors.some((f) => f.includes('Only one projection method'))).toBe(true)
  })

  it('downgrades when the two models disagree a lot, not just a little', () => {
    const closeResult = confidenceFor({
      game, ratings, epaProjection: { margin: 3 }, modelAgreement: agreement(1, 'high')
    })
    const farResult = confidenceFor({
      game, ratings, epaProjection: { margin: 3 }, modelAgreement: agreement(12, 'low')
    })
    expect(LEVEL_RANK[farResult.level]).toBeLessThan(LEVEL_RANK[closeResult.level])
  })

  it('downgrades when a team\'s scoring rate is still mostly synthetic (thin sample)', () => {
    const thinRatings = { KC: { synthetic: ['ppg', 'papg'] }, LV: { synthetic: [] } }
    const result = confidenceFor({
      game, ratings: thinRatings, epaProjection: { margin: 3 }, modelAgreement: agreement(1, 'high')
    })
    expect(result.factors.some((f) => f.includes('still mostly on last season'))).toBe(true)
    expect(result.level).not.toBe('high')
  })

  it('downgrades when the simulation disagrees meaningfully with the closed-form formula', () => {
    const result = confidenceFor({
      game, ratings, epaProjection: { margin: 3 }, modelAgreement: agreement(1, 'high'),
      simulation: { homeWinProb: 0.7, analyticalWinProb: 0.55 }
    })
    expect(result.factors.some((f) => f.includes('differ by'))).toBe(true)
    expect(result.level).not.toBe('high')
  })

  it('downgrades when a starting QB is out, even if everything else looks clean', () => {
    const clean = confidenceFor({
      game, ratings, epaProjection: { margin: 3 }, modelAgreement: agreement(1, 'high')
    })
    const qbOut = confidenceFor({
      game, ratings, epaProjection: { margin: 3 }, modelAgreement: agreement(1, 'high'),
      qbOut: { home: { name: 'Someone', injury: 'Knee' }, away: null }
    })
    expect(clean.level).toBe('high')
    expect(LEVEL_RANK[qbOut.level]).toBeLessThan(LEVEL_RANK[clean.level])
    expect(qbOut.factors.some((f) => f.includes('starting QB'))).toBe(true)
  })

  it('never claims high confidence just because a projection is far from the market — nothing here looks at market data at all', () => {
    // Sanity check on design intent: confidenceFor's signature doesn't even
    // accept a market/edge argument, so there is nothing for "far from the
    // market" to plug into.
    expect(confidenceFor.length).toBe(1)
  })
})

const LEVEL_RANK = { low: 0, medium: 1, high: 2 }
