import { describe, it, expect } from 'vitest'
import { restDaysFor, teamRecord } from './ratings.js'

describe('restDaysFor', () => {
  // Clean same-time-of-day kickoffs so day gaps are exact integers, not
  // rounded fractions.
  const history = [
    { gameId: 'g1', kickoff: '2026-09-07T20:00:00Z', home: 'DET', away: 'GB' },
    // DET on a short week: only 3 days after g1.
    { gameId: 'g2', kickoff: '2026-09-10T20:00:00Z', home: 'CIN', away: 'DET' }
  ]

  it('computes the gap since a team\'s most recent prior game', () => {
    const days = restDaysFor('CIN', '2026-09-17T20:00:00Z', history)
    expect(days).toBe(7)
  })

  it('finds the most recent game when a team appears more than once in history', () => {
    // DET's next game should measure from the Thursday game (g2), not the
    // earlier Sunday one (g1) nine days back.
    const days = restDaysFor('DET', '2026-09-16T20:00:00Z', history)
    expect(days).toBe(6)
  })

  it('defaults to a neutral 7 days for a team\'s first game with no prior history', () => {
    expect(restDaysFor('SEA', '2026-09-07T20:00:00Z', history)).toBe(7)
  })

  it('defaults to 7 when there is no history at all (preseason/bundled slate)', () => {
    expect(restDaysFor('DET', '2026-09-07T20:00:00Z', [])).toBe(7)
    expect(restDaysFor('DET', '2026-09-07T20:00:00Z', null)).toBe(7)
  })

  it('ignores games on or after the kickoff in question', () => {
    // At g2's own kickoff, only the earlier g1 counts as rest context.
    const days = restDaysFor('DET', '2026-09-10T20:00:00Z', history)
    expect(days).toBe(3)
  })
})

describe('teamRecord', () => {
  const rating = { wins: 11, losses: 6, w: 6, l: 3, t: 0 }

  it('uses this season\'s replayed record once any of its games have been applied', () => {
    expect(teamRecord(rating, 137)).toEqual({ text: '6-3', lastSeason: false })
  })

  it('includes ties', () => {
    expect(teamRecord({ ...rating, t: 1 }, 137)).toEqual({ text: '6-3-1', lastSeason: false })
  })

  it('falls back to last season\'s final record, flagged as such, before any results are in', () => {
    // applyResults() seeds w/l at 0-0 before the first game — that is not a record worth showing.
    expect(teamRecord({ wins: 11, losses: 6, w: 0, l: 0, t: 0 }, 0)).toEqual({ text: '11-6', lastSeason: true })
    expect(teamRecord({ wins: 11, losses: 6 }, undefined)).toEqual({ text: '11-6', lastSeason: true })
  })

  it('returns null rather than inventing a record', () => {
    expect(teamRecord(undefined, 10)).toBeNull()
    expect(teamRecord({ elo: 1500 }, 10)).toBeNull()
  })
})
