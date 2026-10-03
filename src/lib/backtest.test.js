import { describe, it, expect } from 'vitest'
import { runBacktest, computeMetrics, calibrationBuckets } from './backtest.js'
import { SEASON_2025 } from '../data/season2025.js'
import { DEFAULT_SETTINGS } from './model.js'

describe('runBacktest', () => {
  it('never lets a game see its own result: a lopsided favourite still gets a real pregame number, not a certainty', () => {
    const games = [
      { id: 'g1', kickoff: '2025-09-07T17:00:00Z', home: 'KC', away: 'LV', homeScore: 31, awayScore: 10 }
    ]
    const { games: out } = runBacktest(games)
    expect(out).toHaveLength(1)
    // With no games played yet by either side, the model has nothing to go
    // on besides home field, so the pregame probability must be close to a
    // coin flip rather than already knowing KC wins by 21.
    expect(out[0].predictedHomeWinProb).toBeGreaterThan(0.4)
    expect(out[0].predictedHomeWinProb).toBeLessThan(0.65)
    expect(out[0].actualMargin).toBe(21)
    expect(out[0].correctWinner).toBe(true)
  })

  it('is deterministic: running it twice on the same input produces identical output', () => {
    const first = runBacktest(SEASON_2025.results)
    const second = runBacktest(SEASON_2025.results)
    expect(first).toEqual(second)
  })

  it('only scores games with a real, unambiguous winner', () => {
    const games = [
      { id: 'tie', kickoff: '2025-09-07T17:00:00Z', home: 'KC', away: 'LV', homeScore: 20, awayScore: 20 }
    ]
    const { games: out, metrics } = runBacktest(games)
    expect(out[0].correctWinner).toBeNull()
    expect(metrics).toBeNull()
  })

  it('updates each team\'s rating from a real result before the next game involving them', () => {
    const games = [
      { id: 'g1', kickoff: '2025-09-07T17:00:00Z', home: 'KC', away: 'LV', homeScore: 31, awayScore: 10 },
      { id: 'g2', kickoff: '2025-09-14T17:00:00Z', home: 'LV', away: 'KC', homeScore: 10, awayScore: 31 }
    ]
    const { games: out } = runBacktest(games)
    // Game 2: KC already has a dominant win behind it, LV a loss. The
    // model's projected margin should favour KC more than a neutral prior
    // would (home field alone), proving the first result actually moved
    // the ratings used for the second projection.
    expect(out[1].homeGamesSoFar).toBe(1)
    expect(out[1].awayGamesSoFar).toBe(1)
    expect(out[1].predictedMargin).toBeLessThan(0) // LV is home and still expected to lose
  })

  it('runs cleanly on the real bundled 2025 Week 18 + postseason results', () => {
    const { games, metrics } = runBacktest(SEASON_2025.results, {}, DEFAULT_SETTINGS)
    expect(games.length).toBe(SEASON_2025.results.length)
    expect(metrics).not.toBeNull()
    expect(metrics.n).toBeGreaterThan(0)
    expect(metrics.brier).toBeGreaterThanOrEqual(0)
    expect(metrics.brier).toBeLessThanOrEqual(1)
    expect(metrics.accuracy).toBeGreaterThanOrEqual(0)
    expect(metrics.accuracy).toBeLessThanOrEqual(1)
  })

  it('handles an empty or garbage game list without throwing', () => {
    expect(runBacktest([]).metrics).toBeNull()
    expect(runBacktest(null).metrics).toBeNull()
    expect(runBacktest([{ home: 'KC' }]).metrics).toBeNull()
  })
})

describe('computeMetrics', () => {
  it('is null with nothing to score', () => {
    expect(computeMetrics([])).toBeNull()
  })

  it('computes a sane Brier score for a perfectly confident, always-correct model', () => {
    const records = [
      { predictedHomeWinProb: 1, actualHomeWin: 1, marginError: 0, totalError: 0, correctWinner: true },
      { predictedHomeWinProb: 1, actualHomeWin: 1, marginError: 0, totalError: 0, correctWinner: true }
    ]
    const metrics = computeMetrics(records)
    expect(metrics.brier).toBe(0)
    expect(metrics.accuracy).toBe(1)
  })
})

describe('calibrationBuckets', () => {
  it('groups games by predicted probability and reports the real outcome rate in each bucket', () => {
    const records = [
      { predictedHomeWinProb: 0.62, actualHomeWin: 1, correctWinner: true },
      { predictedHomeWinProb: 0.68, actualHomeWin: 0, correctWinner: false },
      { predictedHomeWinProb: 0.21, actualHomeWin: 0, correctWinner: true }
    ]
    const buckets = calibrationBuckets(records, 0.1)
    const highBucket = buckets.find((b) => b.lo === 0.6)
    expect(highBucket.n).toBe(2)
    expect(highBucket.actualWinRate).toBe(0.5)
  })

  it('returns nothing for an empty or all-tie input', () => {
    expect(calibrationBuckets([])).toEqual([])
    expect(calibrationBuckets([{ correctWinner: null }])).toEqual([])
  })
})
