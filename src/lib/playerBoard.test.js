import { describe, it, expect, vi } from 'vitest'

vi.mock('../data/generated/team-defense.json', () => ({ default: { latestSeason: 2026, seasons: {} } }))

const { mainPlayerBoard, lineOutlook } = await import('./playerBoard.js')

const game = { id: 'g1', home: 'BAL', away: 'CIN' }
const proj = { homeTeamTotal: 26, awayTeamTotal: 22, margin: 4 }
const ratings = { BAL: { ppg: 25 }, CIN: { ppg: 23 } }

const player = (over) => ({ injury: null, depthKnown: true, tds: 0, ...over })
const roster = () => [
  player({ name: 'Home QB', team: 'BAL', position: 'QB', role: 'QB', tds: 2, stats: { games: 8, passingYards: 1920, rushingYards: 360, rushingAttempts: 60 } }),
  player({ name: 'Home Back', team: 'BAL', position: 'RB', role: 'RB1', tds: 9, stats: { games: 8, rushingYards: 800, rushingAttempts: 160, receivingYards: 120, receptions: 16 } }),
  player({ name: 'Home Backup', team: 'BAL', position: 'RB', role: 'RB2', tds: 1, stats: { games: 8, rushingYards: 200, rushingAttempts: 50 } }),
  player({ name: 'Home Wideout', team: 'BAL', position: 'WR', role: 'WR1', tds: 4, stats: { games: 8, receivingYards: 640, receptions: 48 } }),
  player({ name: 'Away QB', team: 'CIN', position: 'QB', role: 'QB', tds: 0, stats: { games: 8, passingYards: 2160, rushingYards: 24, rushingAttempts: 12 } }),
  player({ name: 'Away Wideout', team: 'CIN', position: 'WR', role: 'WR1', tds: 6, stats: { games: 8, receivingYards: 720, receptions: 56 } }),
  player({ name: 'Away Tight End', team: 'CIN', position: 'TE', role: 'TE1', tds: 2, stats: { games: 8, receivingYards: 320, receptions: 32 } })
]
const board = (players = roster()) => mainPlayerBoard({ game, proj, rosters: { players }, ratings })
const find = (b, name) => b.find((p) => p.name === name)

describe('mainPlayerBoard', () => {
  it('lists every main player on both teams, home first, and no one else', () => {
    const b = board()
    expect(b.map((p) => p.name)).toEqual([
      'Home QB', 'Home Back', 'Home Wideout', 'Away QB', 'Away Wideout', 'Away Tight End'
    ])
    expect(find(b, 'Home Backup')).toBeUndefined()
  })

  it('gives each role the stat lines people look up for it', () => {
    const b = board()
    expect(find(b, 'Home QB').lines.map((l) => l.market)).toEqual(['passingYards', 'rushingYards'])
    expect(find(b, 'Home Back').lines.map((l) => l.market)).toEqual(['rushingYards', 'receivingYards'])
    expect(find(b, 'Away Wideout').lines.map((l) => l.market)).toEqual(['receivingYards', 'receptions'])
  })

  it('drops a line too small to mean anything — a pocket passer\'s rushing yards', () => {
    expect(board().find((p) => p.name === 'Away QB').lines.map((l) => l.market)).toEqual(['passingYards'])
  })

  it('brackets each projection with a likely range', () => {
    for (const p of board()) {
      for (const l of p.lines) {
        expect(l.low).toBeLessThan(l.mean)
        expect(l.high).toBeGreaterThan(l.mean * 0.9)
        expect(l.high).toBeGreaterThan(l.low)
      }
    }
  })

  it('carries a touchdown probability for every listed player, highest for the lead back', () => {
    const b = board()
    for (const p of b) {
      expect(p.tdProb).toBeGreaterThan(0)
      expect(p.tdProb).toBeLessThan(1)
    }
    const home = b.filter((p) => p.team === 'BAL')
    expect(Math.max(...home.map((p) => p.tdProb))).toBe(find(b, 'Home Back').tdProb)
  })

  it('leaves off a player ruled Out, but keeps a Questionable one', () => {
    const out = roster().map((p) => (p.name === 'Home Back' ? { ...p, injury: 'Out' } : p))
    expect(find(board(out), 'Home Back')).toBeUndefined()
    const q = roster().map((p) => (p.name === 'Home Back' ? { ...p, injury: 'Questionable' } : p))
    expect(find(board(q), 'Home Back').injury).toBe('Questionable')
  })

  it('never shows a league-average stand-in as a player\'s projection', () => {
    // A main player with no stats on record still gets a touchdown chance
    // from his role, but no yardage line is invented for him.
    const rookie = roster().map((p) => (p.name === 'Home Wideout' ? { ...p, stats: null, tds: null } : p))
    const entry = find(board(rookie), 'Home Wideout')
    expect(entry.lines).toEqual([])
    expect(entry.tdProb).toBeGreaterThan(0)
  })

  it('notes when a line is built on last season\'s numbers', () => {
    const b = board(roster().map((p) => (p.name === 'Home Wideout' ? { ...p, statsPriorSeason: true } : p)))
    expect(find(b, 'Home Wideout').lines.every((l) => l.priorSeason)).toBe(true)
    expect(find(b, 'Home Back').lines.every((l) => !l.priorSeason)).toBe(true)
  })
})

describe('lineOutlook — the model against a line the user typed', () => {
  it('returns nothing until something is typed', () => {
    expect(lineOutlook('rushingYards', 90, '')).toBeNull()
    expect(lineOutlook('rushingYards', 90, undefined)).toBeNull()
    expect(lineOutlook('rushingYards', 90, '   ')).toBeNull()
  })

  it('gives over and under chances that sum to one on a half-point line', () => {
    const o = lineOutlook('rushingYards', 90, '84.5')
    expect(o.line).toBe(84.5)
    expect(o.over + o.under).toBeCloseTo(1, 6)
    expect(o.push).toBe(0)
  })

  it('leans under at a line set at the projection, because yardage is right-skewed', () => {
    // The mean sits above the median: a few huge games pull it up.
    const o = lineOutlook('receivingYards', 70, '70')
    expect(o.under).toBeGreaterThan(o.over)
  })

  it('moves the right way as the line moves', () => {
    const low = lineOutlook('receivingYards', 70, '49.5')
    const high = lineOutlook('receivingYards', 70, '94.5')
    expect(low.over).toBeGreaterThan(0.6)
    expect(high.over).toBeLessThan(0.3)
  })

  it('accounts for a push on a whole-number receptions line', () => {
    const o = lineOutlook('receptions', 5.2, '5')
    expect(o.push).toBeGreaterThan(0.05)
    expect(o.over + o.under + o.push).toBeCloseTo(1, 6)
  })

  it('flags something that is not a believable line rather than computing on it', () => {
    expect(lineOutlook('rushingYards', 90, 'abc')).toEqual({ invalid: true })
    expect(lineOutlook('rushingYards', 90, '-5')).toEqual({ invalid: true })
    expect(lineOutlook('rushingYards', 90, '0')).toEqual({ invalid: true })
    expect(lineOutlook('receptions', 5, '845')).toEqual({ invalid: true }) // a yardage number typed into receptions
  })
})
