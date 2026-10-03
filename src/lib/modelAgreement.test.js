import { describe, it, expect } from 'vitest'
import { combineProjections, agreementLevel } from './modelAgreement.js'

describe('agreementLevel', () => {
  it('buckets disagreement into high/medium/low with sensible thresholds', () => {
    expect(agreementLevel(1)).toBe('high')
    expect(agreementLevel(4)).toBe('medium')
    expect(agreementLevel(9)).toBe('low')
    expect(agreementLevel(null)).toBe('unknown')
  })
})

describe('combineProjections', () => {
  it('returns null when either model has no projection, rather than passing one model off as a consensus', () => {
    const epa = { margin: 3, homeWinProb: 0.6 }
    expect(combineProjections(null, epa)).toBeNull()
    expect(combineProjections(epa, null)).toBeNull()
    expect(combineProjections(null, null)).toBeNull()
  })

  it('averages the two models\' margins without forcing them to agree', () => {
    const elo = { margin: 4, homeWinProb: 0.6 }
    const epa = { margin: 2, homeWinProb: 0.55 }
    const result = combineProjections(elo, epa)
    expect(result.consensusMargin).toBe(3)
    expect(result.disagreementPoints).toBe(2)
    expect(result.models.elo.margin).toBe(4)
    expect(result.models.epa.margin).toBe(2)
  })

  it('flags a large gap between the two models as low agreement, not hidden inside a confident-looking average', () => {
    const elo = { margin: 10, homeWinProb: 0.75 }
    const epa = { margin: -2, homeWinProb: 0.45 }
    const result = combineProjections(elo, epa)
    expect(result.disagreementPoints).toBe(12)
    expect(result.agreement).toBe('low')
  })

  it('derives a consensus win probability from the consensus margin, not by averaging the two win probabilities directly', () => {
    const elo = { margin: 7, homeWinProb: 0.7 }
    const epa = { margin: 7, homeWinProb: 0.7 }
    const result = combineProjections(elo, epa, { marginSigma: 13.2 })
    expect(result.consensusWinProb).toBeCloseTo(elo.homeWinProb, 2)
  })
})
