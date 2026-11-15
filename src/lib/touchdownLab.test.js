import { describe, it, expect, vi } from 'vitest'

vi.mock('../data/generated/team-defense.json', () => ({
  default: {
    latestSeason: 2026,
    seasons: {
      2026: {
        CIN: { rushingTdsAllowed: 12, receivingTdsAllowed: 6, games: 8, ranks: { rushingTdsAllowed: 2, receivingTdsAllowed: 20 } },
        BAL: { rushingTdsAllowed: 4, receivingTdsAllowed: 16, games: 8, ranks: { rushingTdsAllowed: 25, receivingTdsAllowed: 1 } }
      }
    }
  }
}))

const { touchdownBoard, twoPlusProbability, priceOutlook, rankScorers, SUSPICIOUS_TD_EV } = await import('./touchdownLab.js')

const game = { id: 'g1', home: 'BAL', away: 'CIN', kickoff: '2026-11-15T18:00:00Z' }
const proj = { homeTeamTotal: 27, awayTeamTotal: 21, margin: 6 }
const p = (over) => ({ injury: null, depthKnown: true, tds: 0, ...over })
const players = () => [
  p({ name: 'Home QB', team: 'BAL', position: 'QB', role: 'QB', tds: 2, stats: { games: 8 } }),
  p({ name: 'Home Back', team: 'BAL', position: 'RB', role: 'RB1', tds: 9, stats: { games: 8 } }),
  p({ name: 'Home Third Wideout', team: 'BAL', position: 'WR', role: 'WR3', tds: 1, stats: { games: 8 } }),
  p({ name: 'Away Wideout', team: 'CIN', position: 'WR', role: 'WR1', tds: 6, stats: { games: 8 } }),
  p({ name: 'Away Fullback', team: 'CIN', position: 'FB', role: 'RB2', tds: 0, stats: { games: 8 } })
]
const board = (list = players()) => touchdownBoard({ game, proj, rosters: { players: list } })
const find = (b, name) => b.find((r) => r.name === name)

describe('twoPlusProbability', () => {
  it('is the Poisson chance of two or more, always below the chance of one or more', () => {
    for (const lambda of [0.1, 0.5, 1]) {
      const one = 1 - Math.exp(-lambda)
      const two = twoPlusProbability(lambda)
      expect(two).toBeGreaterThan(0)
      expect(two).toBeLessThan(one)
    }
    expect(twoPlusProbability(1)).toBeCloseTo(1 - 2 / Math.E, 6)
    expect(twoPlusProbability(0)).toBe(0)
    expect(twoPlusProbability(null)).toBe(0)
  })
})

describe('touchdownBoard', () => {
  it('lists everyone who could score, not just the lead players, highest chance first', () => {
    const b = board()
    expect(b).toHaveLength(5)
    expect(find(b, 'Home Third Wideout')).toBeDefined()
    const probs = b.map((r) => r.prob)
    expect(probs).toEqual([...probs].sort((x, y) => y - x))
  })

  it('carries what the number is built from: season scoring, the team total, and who the opponent is', () => {
    const back = find(board(), 'Home Back')
    expect(back.tds).toBe(9)
    expect(back.games).toBe(8)
    expect(back.opponent).toBe('CIN')
    expect(back.home).toBe(true)
    expect(back.teamExpectedTds).toBeGreaterThan(find(board(), 'Away Wideout').teamExpectedTds)
    expect(back.twoPlus).toBeLessThan(back.prob)
  })

  it('shows the opponent\'s touchdowns allowed on the side of the ball the position scores from', () => {
    const b = board()
    // A back runs against CIN: 12 rushing TDs in 8 games, 2nd most.
    expect(find(b, 'Home Back').defense).toMatchObject({ side: 'rushing', perGame: 1.5, rank: 2 })
    // A receiver catches against BAL: 16 receiving TDs in 8 games, most in the league.
    expect(find(b, 'Away Wideout').defense).toMatchObject({ side: 'receiving', perGame: 2, rank: 1 })
    // A quarterback's own touchdowns are runs.
    expect(find(b, 'Home QB').defense.side).toBe('rushing')
  })

  it('folds a fullback into the backs', () => {
    expect(find(board(), 'Away Fullback').position).toBe('RB')
  })

  it('leaves off a player ruled Out and gives his share to teammates', () => {
    const out = board(players().map((x) => (x.name === 'Home Back' ? { ...x, injury: 'Out' } : x)))
    expect(find(out, 'Home Back')).toBeUndefined()
    expect(find(out, 'Home QB').prob).toBeGreaterThan(find(board(), 'Home QB').prob)
  })

  it('says so when a player has no games on record rather than showing zero touchdowns', () => {
    const b = board(players().map((x) => (x.name === 'Home Third Wideout' ? { ...x, stats: null, tds: null } : x)))
    expect(find(b, 'Home Third Wideout').tds).toBeNull()
    expect(find(b, 'Home Third Wideout').prob).toBeGreaterThan(0)
  })

  it('leaves the defense context off for an opponent with nothing on record', () => {
    const b = touchdownBoard({ game: { ...game, away: 'ZZZ' }, proj, rosters: { players: players().filter((x) => x.team === 'BAL') } })
    expect(b[0].defense).toBeNull()
  })

  it('flags a flat, depth-unknown estimate so its order is not over-read', () => {
    const b = board(players().map((x) => (x.name === 'Home Third Wideout' ? { ...x, depthKnown: false, flatShare: 0.05 } : x)))
    expect(find(b, 'Home Third Wideout').depthKnown).toBe(false)
    expect(find(b, 'Home Back').depthKnown).toBe(true)
  })
})

describe('priceOutlook', () => {
  it('returns nothing until a price is typed', () => {
    expect(priceOutlook(0.3, '')).toBeNull()
    expect(priceOutlook(0.3, undefined)).toBeNull()
  })

  it('reads the chance a price pays out at and the return if the model is right', () => {
    const o = priceOutlook(0.25, '+400') // pays out at 20%
    expect(o.price).toBe(400)
    expect(o.implied).toBeCloseTo(0.2, 6)
    expect(o.ev).toBeCloseTo(0.25 * 4 - 0.75, 6) // +25%
    expect(o.suspicious).toBe(false)
  })

  it('shows a losing price as a negative return', () => {
    const o = priceOutlook(0.2, '+250')
    expect(o.ev).toBeLessThan(0)
  })

  it('handles a favourite\'s minus price', () => {
    const o = priceOutlook(0.6, '-150')
    expect(o.implied).toBeCloseTo(0.6, 6)
    expect(o.ev).toBeCloseTo(0, 6)
  })

  it('flags an implausibly large edge instead of presenting it as value', () => {
    const o = priceOutlook(0.4, '+900')
    expect(o.ev).toBeGreaterThan(SUSPICIOUS_TD_EV)
    expect(o.suspicious).toBe(true)
  })

  it('rejects something that is not a price', () => {
    expect(priceOutlook(0.3, 'abc')).toEqual({ invalid: true })
    expect(priceOutlook(0.3, '12')).toEqual({ invalid: true })
  })
})

describe('rankScorers', () => {
  const rows = [
    { name: 'B', position: 'WR', prob: 0.3 },
    { name: 'A', position: 'RB', prob: 0.5 },
    { name: 'C', position: 'WR', prob: 0.04 },
    { name: 'D', position: 'TE', prob: 0.3 }
  ]

  it('orders by chance, then by name so equal chances do not shuffle', () => {
    expect(rankScorers(rows).map((r) => r.name)).toEqual(['A', 'B', 'D', 'C'])
  })

  it('narrows to a position', () => {
    expect(rankScorers(rows, { position: 'WR' }).map((r) => r.name)).toEqual(['B', 'C'])
  })

  it('can hide the long tail', () => {
    expect(rankScorers(rows, { minProb: 0.08 }).map((r) => r.name)).toEqual(['A', 'B', 'D'])
  })

  it('does not mutate its input', () => {
    const copy = [...rows]
    rankScorers(rows)
    expect(rows).toEqual(copy)
  })
})
