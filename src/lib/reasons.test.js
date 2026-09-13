import { describe, it, expect, vi } from 'vitest'

vi.mock('../data/generated/team-defense.json', () => ({
  default: {
    latestSeason: 2026,
    seasons: {
      2026: {}, // nothing played yet this season in this fixture
      2025: {
        CIN: {
          rushingYardsAllowed: 2500, rushingTdsAllowed: 18,
          receivingYardsAllowed: 4175, receivingTdsAllowed: 33,
          games: 17, ranks: { rushingYardsAllowed: 1, rushingTdsAllowed: 11, receivingYardsAllowed: 8, receivingTdsAllowed: 3 }
        }
      }
    }
  }
}))

const { reasonsForTouchdownPick, reasonsForVolumePick, reasonsForPick } = await import('./reasons.js')

const game = { home: 'DET', away: 'CIN' }

describe('reasonsForTouchdownPick', () => {
  it('cites real season TDs, rostered role, and opponent defense context', () => {
    const pick = {
      game,
      entry: {
        team: 'DET',
        model: {
          role: 'WR1', depthKnown: true, statsPriorSeason: false,
          stats: { games: 16, tds: 8 }
        }
      }
    }
    const bullets = reasonsForTouchdownPick(pick)
    expect(bullets).toContain('8 TDs in 16 games this season (0.5/game).')
    expect(bullets).toContain("Rostered as the team's WR1.")
    expect(bullets.some((b) => b.includes('CIN has allowed'))).toBe(true)
    expect(bullets.some((b) => b.includes('receiving'))).toBe(true)
  })

  it('says "last season" when the stats came from the prior season', () => {
    const pick = {
      game,
      entry: {
        team: 'DET',
        model: { role: 'RB1', depthKnown: true, statsPriorSeason: true, stats: { games: 17, tds: 11 } }
      }
    }
    const bullets = reasonsForTouchdownPick(pick)
    expect(bullets[0]).toMatch(/last season/)
  })

  it('flags an unpublished depth chart honestly instead of implying a real rank', () => {
    const pick = {
      game,
      entry: {
        team: 'DET',
        model: { role: 'WR', depthKnown: false, stats: { games: 0, tds: 0 } }
      }
    }
    const bullets = reasonsForTouchdownPick(pick)
    expect(bullets.some((b) => b.includes('not published yet'))).toBe(true)
  })

  it('omits the season-stats bullet when there is nothing real to cite', () => {
    const pick = {
      game,
      entry: { team: 'DET', model: { role: 'WR3', depthKnown: true, stats: { games: 0, tds: 0 } } }
    }
    const bullets = reasonsForTouchdownPick(pick)
    expect(bullets.some((b) => /TDs? in \d+ games/.test(b))).toBe(false)
  })

  it('picks the rushing side of a defense for a running back', () => {
    const pick = {
      game: { home: 'CIN', away: 'DET' },
      entry: { team: 'DET', model: { role: 'RB1', depthKnown: true, stats: { games: 10, tds: 5 } } }
    }
    const bullets = reasonsForTouchdownPick(pick)
    expect(bullets.some((b) => b.includes('rushing'))).toBe(true)
    expect(bullets.some((b) => b.includes('receiving'))).toBe(false)
  })
})

describe('reasonsForVolumePick', () => {
  it('cites the real per-game rate, opponent context, and injury status', () => {
    const pick = {
      game,
      entry: {
        team: 'DET', role: 'WR1', injury: 'Questionable', games: 17, perGame: 74.3,
        marketLabel: 'Receiving yards', statsPriorSeason: false
      }
    }
    const bullets = reasonsForVolumePick(pick)
    expect(bullets).toContain('74.3 receiving yards/game over 17 games this season.')
    expect(bullets).toContain('Injury status: Questionable.')
    expect(bullets.some((b) => b.includes('CIN has allowed'))).toBe(true)
  })

  it('omits the injury bullet for an active player', () => {
    const pick = {
      game,
      entry: { team: 'DET', role: 'WR1', injury: 'Active', games: 17, perGame: 74.3, marketLabel: 'Receiving yards' }
    }
    const bullets = reasonsForVolumePick(pick)
    expect(bullets.some((b) => b.startsWith('Injury status'))).toBe(false)
  })
})

describe('reasonsForPick', () => {
  it('dispatches by kind', () => {
    const tdPick = { kind: 'td', game, entry: { team: 'DET', model: { role: 'QB', depthKnown: true, stats: { games: 0, tds: 0 } } } }
    const volPick = { kind: 'volume', game, entry: { team: 'DET', role: 'RB1', games: 0, perGame: 0, marketLabel: 'Rushing yards' } }
    expect(reasonsForPick(tdPick)).toEqual(reasonsForTouchdownPick(tdPick))
    expect(reasonsForPick(volPick)).toEqual(reasonsForVolumePick(volPick))
  })
})
