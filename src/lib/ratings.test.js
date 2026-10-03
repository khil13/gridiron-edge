import { describe, it, expect } from 'vitest'
import { restDaysFor } from './ratings.js'

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
