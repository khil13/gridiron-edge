import { describe, it, expect } from 'vitest'
import { starterQbOut, applyInjuryAdjustment, QB_OUT_POINTS } from './injuries.js'

describe('starterQbOut', () => {
  it('reads the build-time-verified starter directly', () => {
    const report = { starterQbOut: { CHI: { name: 'Caleb Williams', injury: 'Hamstring' } } }
    expect(starterQbOut('CHI', report)).toEqual({ name: 'Caleb Williams', injury: 'Hamstring' })
  })

  it('returns null for a team with no entry, or a missing/unchecked report', () => {
    expect(starterQbOut('CHI', { starterQbOut: {} })).toBeNull()
    expect(starterQbOut('CHI', { starterQbOut: null })).toBeNull()
    expect(starterQbOut('CHI', null)).toBeNull()
  })
})

describe('applyInjuryAdjustment', () => {
  const game = { home: 'CHI', away: 'GB' }
  const projection = { margin: 1, homeWinProb: 0.52, awayWinProb: 0.48, total: 44, modelSpreadHome: -1, modelSpreadAway: 1 }
  const settings = { marginSigma: 13.2 }

  it('passes a projection through unchanged (but annotated) when neither starter is out', () => {
    const report = { starterQbOut: {} }
    const result = applyInjuryAdjustment(game, projection, report, settings)
    expect(result.margin).toBe(1)
    expect(result.qbOut).toEqual({ home: null, away: null })
  })

  it('shifts the margin away from the home team when the home starter is out', () => {
    const report = { starterQbOut: { CHI: { name: 'Caleb Williams', injury: 'Hamstring' } } }
    const result = applyInjuryAdjustment(game, projection, report, settings)
    expect(result.margin).toBe(1 - QB_OUT_POINTS)
    expect(result.homeWinProb).toBeLessThan(projection.homeWinProb)
    expect(result.qbOut.home).toEqual({ name: 'Caleb Williams', injury: 'Hamstring' })
    expect(result.qbOut.away).toBeNull()
  })

  it('shifts the margin toward the home team when the away starter is out', () => {
    const report = { starterQbOut: { GB: { name: 'Jordan Love', injury: 'Shoulder' } } }
    const result = applyInjuryAdjustment(game, projection, report, settings)
    expect(result.margin).toBe(1 + QB_OUT_POINTS)
    expect(result.homeWinProb).toBeGreaterThan(projection.homeWinProb)
  })

  it('keeps home and away probabilities complementary and totals consistent with the game total', () => {
    const report = { starterQbOut: { CHI: { name: 'Caleb Williams', injury: null } } }
    const result = applyInjuryAdjustment(game, projection, report, settings)
    expect(result.homeWinProb + result.awayWinProb).toBeCloseTo(1, 6)
    expect(result.homeTeamTotal + result.awayTeamTotal).toBeCloseTo(projection.total, 1)
  })

  it('returns a falsy projection unchanged', () => {
    expect(applyInjuryAdjustment(game, null, { starterQbOut: {} }, settings)).toBeNull()
  })
})
