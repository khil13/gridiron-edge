import { describe, it, expect, vi } from 'vitest'

vi.mock('../data/generated/team-defense.json', () => ({ default: { latestSeason: 2026, seasons: {} } }))

const { buildGradingCases, gradeProps, totalsOf } = await import('./propGrading.js')

const row = (over) => ({
  id: 'x', name: 'X', position: 'WR', week: 1, team: 'AAA', opp: 'BBB',
  passingYards: 0, passingAttempts: 0, passingTouchdowns: 0,
  rushingYards: 0, rushingAttempts: 0, rushTds: 0,
  receivingYards: 0, receptions: 0, targets: 0, recTds: 0,
  ...over
})

// A lead receiver (10 targets a game) and a depth receiver (2), four weeks.
const season = (leadYards = [80, 90, 70, 100]) => [1, 2, 3, 4].flatMap((week, i) => [
  row({ id: 'lead', name: 'Lead Wideout', week, receivingYards: leadYards[i], receptions: 6, targets: 10, recTds: week === 2 ? 1 : 0 }),
  row({ id: 'depth', name: 'Depth Wideout', week, receivingYards: 15, receptions: 1, targets: 2 }),
  row({ id: 'qb', name: 'The QB', position: 'QB', week, passingYards: 250, passingAttempts: 34 })
])

describe('totalsOf', () => {
  it('sums a player\'s rows into season totals, touchdowns as rushing + receiving', () => {
    const t = totalsOf([row({ receivingYards: 50, recTds: 1 }), row({ receivingYards: 70, rushTds: 1, recTds: 1 })])
    expect(t.games).toBe(2)
    expect(t.receivingYards).toBe(120)
    expect(t.tds).toBe(3)
  })
})

describe('buildGradingCases — only what was known before each week', () => {
  it('starts at week 2 and gives each player his totals from the weeks before', () => {
    const cases = buildGradingCases({ weeks: season() })
    expect(Math.min(...cases.map((c) => c.week))).toBe(2)
    const lead = (w) => cases.find((c) => c.week === w && c.name === 'Lead Wideout')
    expect(lead(2).stats.games).toBe(1)
    expect(lead(2).stats.receivingYards).toBe(80)
    expect(lead(4).stats.games).toBe(3)
    expect(lead(4).stats.receivingYards).toBe(240)
  })

  it('does not let a week\'s own result leak into that week\'s inputs', () => {
    const a = buildGradingCases({ weeks: season([80, 90, 70, 100]) })
    const b = buildGradingCases({ weeks: season([80, 90, 70, 300]) }) // only week 4 differs
    const inputs = (cases) => cases.filter((c) => c.week === 4).map((c) => [c.name, c.stats, c.role, c.priorStats])
    expect(inputs(b)).toEqual(inputs(a))
    expect(b.find((c) => c.week === 4 && c.name === 'Lead Wideout').actual.receivingYards).toBe(300)
  })

  it('ranks the lead player by opportunity over the weeks before, not by name or order', () => {
    const cases = buildGradingCases({ weeks: season() })
    for (const w of [2, 3, 4]) {
      expect(cases.find((c) => c.week === w && c.name === 'Lead Wideout').role).toBe('WR1')
      expect(cases.find((c) => c.week === w && c.name === 'Depth Wideout').role).toBe('WR2')
      expect(cases.find((c) => c.week === w && c.name === 'The QB').role).toBe('QB')
    }
  })

  it('falls back to last season for a player with nothing yet this season, and keeps it alongside afterwards', () => {
    const prior = Array.from({ length: 10 }, (_, i) => row({ id: 'new', name: 'Returning', week: i + 1, receivingYards: 60, targets: 8, receptions: 5 }))
    const weeks = [
      ...season(),
      row({ id: 'new', name: 'Returning', week: 3, receivingYards: 40, targets: 7, receptions: 4 }),
      row({ id: 'new', name: 'Returning', week: 4, receivingYards: 55, targets: 7, receptions: 4 })
    ]
    const cases = buildGradingCases({ weeks, priorWeeks: prior })
    const first = cases.find((c) => c.week === 3 && c.name === 'Returning')
    expect(first.statsPriorSeason).toBe(true)
    expect(first.stats.games).toBe(10)
    expect(first.priorStats).toBeUndefined()
    const second = cases.find((c) => c.week === 4 && c.name === 'Returning')
    expect(second.statsPriorSeason).toBe(false)
    expect(second.stats.games).toBe(1)
    expect(second.priorStats.games).toBe(10)
  })

  it('reads the team\'s expected points and margin from the game\'s pre-kickoff total and spread', () => {
    const games = [{ week: 2, home: 'AAA', away: 'BBB', homeScore: 27, awayScore: 20, total: 46, spread: 4 }]
    const c = buildGradingCases({ weeks: season(), games }).find((x) => x.week === 2 && x.name === 'Lead Wideout')
    expect(c.teamPoints).toBe(25) // 46/2 + 4/2 for the home favourite
    expect(c.marginForTeam).toBe(4)
  })

  it('stays neutral when a game has no market numbers', () => {
    const c = buildGradingCases({ weeks: season() }).find((x) => x.week === 2 && x.name === 'Lead Wideout')
    expect(c.teamPoints).toBe(c.teamAverage)
    expect(c.marginForTeam).toBeUndefined()
  })

  it('uses only earlier games for a team\'s usual scoring', () => {
    const games = [
      { week: 1, home: 'AAA', away: 'BBB', homeScore: 30, awayScore: 10, total: NaN, spread: NaN },
      { week: 3, home: 'AAA', away: 'BBB', homeScore: 3, awayScore: 10, total: NaN, spread: NaN }
    ]
    const cases = buildGradingCases({ weeks: season(), games })
    expect(cases.find((x) => x.week === 2 && x.name === 'Lead Wideout').teamAverage).toBe(30)
    expect(cases.find((x) => x.week === 3 && x.name === 'Lead Wideout').teamAverage).toBe(30) // week 3's own score not included
    expect(cases.find((x) => x.week === 4 && x.name === 'Lead Wideout').teamAverage).toBe(16.5)
  })
})

describe('gradeProps', () => {
  const report = gradeProps(buildGradingCases({ weeks: season() }))

  it('grades the lines the board shows for main players only', () => {
    // Lead wideout: receiving yards + receptions; QB: passing yards. Depth receiver is not graded.
    expect(Object.keys(report.markets).sort()).toEqual(['passingYards', 'receivingYards', 'receptions'])
    expect(report.markets.receivingYards.n).toBe(3) // weeks 2, 3, 4
    expect(report.markets.passingYards.n).toBe(3)
    expect(report.playerWeeks).toBe(6)
  })

  it('reports the average miss, the bias, and where results fell against the range', () => {
    const m = report.markets.passingYards
    // The QB threw for exactly 250 every week, so a projection near his own rate misses by little.
    expect(m.mae).toBeLessThan(15)
    expect(m.range.below + m.range.inside + m.range.above).toBeCloseTo(1, 2)
    expect(m.range.inside).toBe(1)
    expect(Number.isFinite(m.bias)).toBe(true)
  })

  it('scores touchdown chances for main players against who actually scored', () => {
    expect(report.touchdowns.n).toBe(6)
    expect(report.touchdowns.brier).toBeGreaterThan(0)
    expect(report.touchdowns.brier).toBeLessThan(0.5)
    expect(report.touchdowns.calibration.gap).toBeGreaterThanOrEqual(0)
  })

  it('also scores every player in the pool, for the Touchdown Lab\'s whole-roster ranking', () => {
    // Three players a week (lead, depth, QB) over weeks 2-4.
    expect(report.touchdownsAll.n).toBe(9)
    expect(report.touchdownsAll.n).toBeGreaterThan(report.touchdowns.n)
    expect(report.touchdownsAll.brier).toBeGreaterThan(0)
  })

  it('returns an empty report, not a crash, before week 2 exists', () => {
    const early = gradeProps(buildGradingCases({ weeks: season().filter((r) => r.week === 1) }))
    expect(early.playerWeeks).toBe(0)
    expect(early.markets).toEqual({})
    expect(early.touchdowns).toBeNull()
    expect(early.touchdownsAll).toBeNull()
  })
})
