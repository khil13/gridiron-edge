import { describe, it, expect } from 'vitest'
import { simulateGame } from './simulation.js'

describe('simulateGame', () => {
  it('returns null when there is nothing real to simulate from', () => {
    expect(simulateGame(null)).toBeNull()
    expect(simulateGame({})).toBeNull()
    expect(simulateGame({ homeTeamTotal: 24 })).toBeNull() // no away total
  })

  it('produces win probabilities that sum to 1 and favor the higher-projected side', () => {
    const result = simulateGame({ homeTeamTotal: 27, awayTeamTotal: 17, margin: 10 }, { iterations: 4000 })
    expect(result.homeWinProb + result.awayWinProb + result.pushProb).toBeCloseTo(1, 5)
    expect(result.homeWinProb).toBeGreaterThan(result.awayWinProb)
    expect(result.homeWinProb).toBeGreaterThan(0.7) // a 10-point projected margin should be a clear favorite
  })

  it('is deterministic for the same projection (same seed every time, not reshuffled per render)', () => {
    const proj = { homeTeamTotal: 23.5, awayTeamTotal: 20.5, margin: 3 }
    const a = simulateGame(proj, { iterations: 2000 })
    const b = simulateGame(proj, { iterations: 2000 })
    expect(a.homeWinProb).toBe(b.homeWinProb)
    expect(a.margin.mean).toBe(b.margin.mean)
  })

  it('produces only realistic discrete NFL scores (multiples of field goals and touchdowns), never fractional or arbitrary values', () => {
    const result = simulateGame({ homeTeamTotal: 24, awayTeamTotal: 21, margin: 3 }, { iterations: 1000 })
    for (const bin of result.homeScore.histogram) {
      expect(Number.isInteger(bin.lo)).toBe(true)
    }
  })

  it('the simulated mean score roughly tracks the projected team totals', () => {
    const result = simulateGame({ homeTeamTotal: 30, awayTeamTotal: 14, margin: 16 }, { iterations: 6000 })
    expect(result.homeScore.mean).toBeGreaterThan(20)
    expect(result.awayScore.mean).toBeLessThan(24)
  })

  it('a pick\'em projection produces roughly symmetric, close-to-50/50 win probabilities', () => {
    const result = simulateGame({ homeTeamTotal: 22, awayTeamTotal: 22, margin: 0 }, { iterations: 8000 })
    expect(result.homeWinProb).toBeGreaterThan(0.35)
    expect(result.homeWinProb).toBeLessThan(0.65)
  })

  it('carries the analytical (closed-form Normal) win probability alongside the simulated one for comparison', () => {
    const result = simulateGame({ homeTeamTotal: 27, awayTeamTotal: 17, margin: 10 })
    expect(result.analyticalWinProb).not.toBeNull()
    expect(result.analyticalWinProb).toBeGreaterThan(0.5)
  })

  it('each distribution summary carries sensible ordered percentiles', () => {
    const result = simulateGame({ homeTeamTotal: 24, awayTeamTotal: 20, margin: 4 }, { iterations: 3000 })
    for (const dist of [result.homeScore, result.awayScore, result.margin, result.total]) {
      expect(dist.p10).toBeLessThanOrEqual(dist.p25)
      expect(dist.p25).toBeLessThanOrEqual(dist.median)
      expect(dist.median).toBeLessThanOrEqual(dist.p75)
      expect(dist.p75).toBeLessThanOrEqual(dist.p90)
    }
  })
})
