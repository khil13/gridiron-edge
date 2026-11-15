import { describe, it, expect } from 'vitest'
import { SPREAD, DISPERSION, cvFor, overProbabilityFor, quantileFor } from './distributions.js'

describe('cvFor — spread scales with the size of the projection', () => {
  it('gives a small projection a proportionally wider spread than a big one', () => {
    // Measured against real 2025-26 results: a 15-yard projection carries a
    // CV near 1.2, an 80-yard one near 0.5. One fixed CV cannot be both.
    expect(cvFor('receivingYards', 15)).toBeGreaterThan(1.1)
    expect(cvFor('receivingYards', 80)).toBeLessThan(0.55)
    expect(cvFor('rushingYards', 30)).toBeGreaterThan(cvFor('rushingYards', 90))
  })

  it('keeps variance proportional to the projection', () => {
    for (const mean of [10, 40, 90]) {
      const cv = cvFor('rushingYards', mean)
      expect((cv * mean) ** 2 / mean).toBeCloseTo(SPREAD.rushingYards, 6)
    }
  })

  it('returns null for a count market or an unusable projection', () => {
    expect(cvFor('receptions', 5)).toBeNull()
    expect(cvFor('rushingYards', 0)).toBeNull()
    expect(cvFor('rushingYards', null)).toBeNull()
  })
})

describe('overProbabilityFor', () => {
  it('is less sure about clearing a low line on a small projection than the old fixed spread was', () => {
    // Line at 60% of a 25-yard rushing projection. A fixed 0.58 CV called
    // this ~75%; real outcomes at this projection size clear it far less
    // often, which is exactly the over-confidence the calibration check found.
    const p = overProbabilityFor('rushingYards', 25, 15).win
    expect(p).toBeGreaterThan(0.5)
    expect(p).toBeLessThan(0.68)
  })

  it('is tighter around a large projection than around a small one at the same relative line', () => {
    const small = overProbabilityFor('receivingYards', 20, 30).win // line at 1.5x
    const big = overProbabilityFor('receivingYards', 80, 120).win // line at 1.5x
    expect(big).toBeLessThan(small)
  })

  it('treats rush attempts as more spread out than receptions', () => {
    expect(DISPERSION.rushingAttempts).toBeGreaterThan(DISPERSION.receptions)
    // Same mean, same line well above it: the wider count leaves more room for the big day.
    const carries = overProbabilityFor('rushingAttempts', 12, 17.5).win
    const catches = overProbabilityFor('receptions', 12, 17.5).win
    expect(carries).toBeGreaterThan(catches)
  })

  it('still sums to one across win, push and lose', () => {
    for (const [market, mean, line] of [['receptions', 5.2, 5], ['rushingAttempts', 14, 14], ['passingYards', 240, 229.5]]) {
      const o = overProbabilityFor(market, mean, line)
      expect(o.win + o.push + o.lose).toBeCloseTo(1, 6)
    }
  })

  it('returns null without a usable projection', () => {
    expect(overProbabilityFor('rushingYards', 0, 10)).toBeNull()
    expect(overProbabilityFor('rushingYards', NaN, 10)).toBeNull()
  })
})

describe('quantileFor — the range the probabilities imply', () => {
  it('is the inverse of overProbabilityFor for yardage', () => {
    for (const [market, mean] of [['rushingYards', 90], ['receivingYards', 55], ['passingYards', 240]]) {
      const q25 = quantileFor(market, mean, 0.25)
      const q75 = quantileFor(market, mean, 0.75)
      expect(overProbabilityFor(market, mean, q25).win).toBeCloseTo(0.75, 3)
      expect(overProbabilityFor(market, mean, q75).win).toBeCloseTo(0.25, 3)
      expect(q25).toBeLessThan(mean)
      expect(q75).toBeGreaterThan(q25)
    }
  })

  it('puts the median below the mean, because yardage is right-skewed', () => {
    expect(quantileFor('receivingYards', 60, 0.5)).toBeLessThan(60)
  })

  it('returns whole numbers for count markets, bracketing the projection', () => {
    const lo = quantileFor('receptions', 5.2, 0.25)
    const hi = quantileFor('receptions', 5.2, 0.75)
    expect(Number.isInteger(lo)).toBe(true)
    expect(Number.isInteger(hi)).toBe(true)
    expect(lo).toBeLessThan(5.2)
    expect(hi).toBeGreaterThan(5.2)
  })

  it('returns null for an unusable projection or quantile', () => {
    expect(quantileFor('rushingYards', 0, 0.5)).toBeNull()
    expect(quantileFor('rushingYards', 80, 0)).toBeNull()
    expect(quantileFor('rushingYards', 80, 1)).toBeNull()
  })
})
