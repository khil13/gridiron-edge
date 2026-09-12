import { describe, it, expect } from 'vitest'
import {
  eloExpected, updateElo, regressToMean, eloToPoints, projectGame,
  powerRankings, ELO_BASE, DEFAULT_SETTINGS, minutesRemaining,
  liveWinProbability
} from './model.js'

describe('eloExpected', () => {
  it('is a coin flip with no rating difference', () => {
    expect(eloExpected(0)).toBeCloseTo(0.5, 6)
  })

  it('favours the higher-rated side', () => {
    expect(eloExpected(200)).toBeGreaterThan(0.5)
    expect(eloExpected(-200)).toBeLessThan(0.5)
  })
})

describe('updateElo', () => {
  it('conserves total rating (zero-sum)', () => {
    const { home, away } = updateElo(1550, 1450, 27, 20, DEFAULT_SETTINGS)
    expect(home + away).toBeCloseTo(1550 + 1450, 6)
  })

  it('rewards the winner and penalises the loser', () => {
    const { home, away, shift } = updateElo(1500, 1500, 24, 10, DEFAULT_SETTINGS)
    expect(shift).toBeGreaterThan(0)
    expect(home).toBeGreaterThan(1500)
    expect(away).toBeLessThan(1500)
  })

  it('moves ratings less for an upset-proof favourite blowout than an even one', () => {
    // Margin-of-victory multiplier includes an autocorrelation term that
    // damps the shift when the win was already expected.
    const favoriteBlowout = updateElo(1700, 1300, 40, 10, DEFAULT_SETTINGS)
    const evenBlowout = updateElo(1500, 1500, 40, 10, DEFAULT_SETTINGS)
    expect(Math.abs(favoriteBlowout.shift)).toBeLessThan(Math.abs(evenBlowout.shift))
  })
})

describe('regressToMean', () => {
  it('pulls a rating toward the Elo base', () => {
    expect(regressToMean(1700, 0.25)).toBeCloseTo(ELO_BASE + 200 * 0.75, 6)
  })

  it('leaves the base rating unchanged', () => {
    expect(regressToMean(ELO_BASE, 0.25)).toBeCloseTo(ELO_BASE, 6)
  })
})

describe('eloToPoints', () => {
  it('divides by the conversion constant', () => {
    expect(eloToPoints(75, DEFAULT_SETTINGS)).toBeCloseTo(3, 6)
  })
})

describe('projectGame', () => {
  const ratings = {
    AAA: { elo: 1600, ppg: 26, papg: 20 },
    BBB: { elo: 1500, ppg: 22, papg: 22 }
  }

  it('favours the higher-rated home team', () => {
    const p = projectGame({ home: 'AAA', away: 'BBB' }, ratings, DEFAULT_SETTINGS)
    expect(p.margin).toBeGreaterThan(0)
    expect(p.homeWinProb).toBeGreaterThan(0.5)
    expect(p.homeWinProb + p.awayWinProb).toBeCloseTo(1, 6)
  })

  it('returns null when a team has no rating', () => {
    expect(projectGame({ home: 'AAA', away: 'ZZZ' }, ratings, DEFAULT_SETTINGS)).toBeNull()
  })

  it('team totals reconstruct the game total and margin', () => {
    const p = projectGame({ home: 'AAA', away: 'BBB' }, ratings, DEFAULT_SETTINGS)
    // Each team total is independently rounded to the nearest half-point, so
    // the reconstructed total/margin can be off by up to that rounding step.
    expect(p.homeTeamTotal + p.awayTeamTotal).toBeCloseTo(p.total, 0)
    expect(p.homeTeamTotal - p.awayTeamTotal).toBeCloseTo(p.margin, 0)
  })

  it('shifts the total down for a preseason game', () => {
    const regular = projectGame({ home: 'AAA', away: 'BBB' }, ratings, DEFAULT_SETTINGS)
    const preseason = projectGame(
      { home: 'AAA', away: 'BBB', preseason: true }, ratings, DEFAULT_SETTINGS
    )
    expect(preseason.total).toBeLessThan(regular.total)
  })

  it('gives no home field advantage on a neutral site', () => {
    const home = projectGame({ home: 'AAA', away: 'BBB' }, ratings, DEFAULT_SETTINGS)
    const neutral = projectGame(
      { home: 'AAA', away: 'BBB', neutral: true }, ratings, DEFAULT_SETTINGS
    )
    expect(neutral.margin).toBeLessThan(home.margin)
  })
})

describe('powerRankings', () => {
  it('ranks teams from highest to lowest rating', () => {
    const rows = powerRankings({ AAA: { elo: 1400 }, BBB: { elo: 1600 }, CCC: { elo: 1500 } })
    expect(rows.map((r) => r.abbr)).toEqual(['BBB', 'CCC', 'AAA'])
    expect(rows[0].rank).toBe(1)
  })
})

describe('minutesRemaining', () => {
  it('is 60 before kickoff', () => {
    expect(minutesRemaining(null, null)).toBe(60)
  })

  it('counts down within a quarter', () => {
    expect(minutesRemaining(1, '10:00')).toBeCloseTo(55, 6)
    expect(minutesRemaining(4, '2:00')).toBeCloseTo(2, 6)
  })

  it('never goes negative in overtime', () => {
    expect(minutesRemaining(5, '0:00')).toBe(0)
  })
})

describe('liveWinProbability', () => {
  it('converges toward certainty as time runs out on a lead', () => {
    const early = liveWinProbability(14, 7, 1, '10:00', 0, DEFAULT_SETTINGS)
    const late = liveWinProbability(14, 7, 4, '0:30', 0, DEFAULT_SETTINGS)
    expect(late.home).toBeGreaterThan(early.home)
  })

  it('flags low confidence in a close game inside two minutes', () => {
    const { lowConfidence } = liveWinProbability(20, 17, 4, '1:30', 0, DEFAULT_SETTINGS)
    expect(lowConfidence).toBe(true)
  })

  it('does not flag low confidence outside two minutes', () => {
    const { lowConfidence } = liveWinProbability(20, 17, 4, '5:00', 0, DEFAULT_SETTINGS)
    expect(lowConfidence).toBe(false)
  })

  it('keeps home and away probabilities complementary', () => {
    const { home, away } = liveWinProbability(10, 24, 3, '5:00', -2, DEFAULT_SETTINGS)
    expect(home + away).toBeCloseTo(1, 6)
  })
})
