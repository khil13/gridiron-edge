import { describe, it, expect } from 'vitest'
import {
  isDivisional, pairKey, decodeHistory, meetings, headToHead, bettingTrends, divisionalRecord, recentDivisional,
  matchupPatterns, meetingWeight, pairSignal, shrink, fitDivisionalModel, divisionalAdjustment,
  applyDivisionalAdjustment, assessBets, lineFor, atsResidFor, totalResid, roleFor, MAX_MARGIN_SHIFT
} from './divisional.js'
import divisionModel from '../data/generated/division-model.json'

// spread = points the home team is favoured by (nflverse's convention)
const g = (season, date, home, away, hs, as, spread = null, total = null, extra = {}) => ({
  season, postseason: false, week: 1, date, home, away, homeScore: hs, awayScore: as, spread, total,
  homeML: null, awayML: null, homeQb: null, awayQb: null, homeCoach: null, awayCoach: null, overtime: false, neutral: false, ...extra
})

describe('who is a division rival', () => {
  it('matches same conference and division only', () => {
    expect(isDivisional('PIT', 'BAL')).toBe(true)
    expect(isDivisional('KC', 'LV')).toBe(true)
    expect(isDivisional('NYG', 'NYJ')).toBe(false) // same city, different conference
    expect(isDivisional('PIT', 'PIT')).toBe(false)
    expect(isDivisional('PIT', 'XXX')).toBe(false)
  })
  it('keys a rivalry the same way from either side', () => {
    expect(pairKey('PIT', 'BAL')).toBe(pairKey('BAL', 'PIT'))
  })
})

describe('perspective helpers', () => {
  const game = g(2025, '2025-10-01', 'PIT', 'BAL', 24, 20, 3, 41.5)
  it('scores the spread from either side', () => {
    expect(atsResidFor(game, 'PIT')).toBe(1) // won by 4, laid 3
    expect(atsResidFor(game, 'BAL')).toBe(-1)
    expect(totalResid(game)).toBe(2.5)
    expect(roleFor(game, 'PIT')).toBe('fav')
    expect(roleFor(game, 'BAL')).toBe('dog')
  })
  it('returns null rather than inventing a line that was not recorded', () => {
    const noLine = g(2025, '2025-10-01', 'PIT', 'BAL', 24, 20)
    expect(atsResidFor(noLine, 'PIT')).toBeNull()
    expect(totalResid(noLine)).toBeNull()
    expect(roleFor(noLine, 'PIT')).toBeNull()
  })
})

const RIVALRY = [
  g(2021, '2021-11-01', 'PIT', 'BAL', 20, 17, -1, 44),
  g(2022, '2022-10-01', 'BAL', 'PIT', 27, 10, 6, 45),
  g(2022, '2023-01-14', 'PIT', 'BAL', 17, 20, 3, 37, { postseason: true, week: 19 }),
  g(2023, '2023-10-01', 'PIT', 'BAL', 13, 13, 0, 40),
  g(2024, '2024-11-01', 'BAL', 'PIT', 35, 31, 3.5, 46),
  g(2025, '2025-09-14', 'PIT', 'BAL', 21, 10, null, null)
]

describe('head to head', () => {
  const list = meetings(RIVALRY, 'PIT', 'BAL')
  it('lists meetings newest first', () => {
    expect(list[0].date).toBe('2025-09-14')
    expect(list.at(-1).date).toBe('2021-11-01')
  })
  it('counts the record, home/away splits and averages from the first team\'s side', () => {
    const h = headToHead(list, 'PIT', 'BAL')
    expect(h.all.record).toEqual({ w: 2, l: 3, t: 1 })
    expect(h.all.aHome).toEqual({ w: 2, l: 1, t: 1 })
    expect(h.all.aAway).toEqual({ w: 0, l: 2, t: 0 })
    expect(h.all.avgCombined).toBeCloseTo((37 + 37 + 37 + 26 + 66 + 31) / 6, 1)
    expect(h.last.date).toBe('2025-09-14')
    expect(h.last5.games).toBe(5)
  })
  it('keeps playoff meetings apart from the regular season', () => {
    const h = headToHead(list, 'PIT', 'BAL')
    expect(h.regular.games).toBe(5)
    expect(h.playoffs.games).toBe(1)
    expect(h.playoffs.record).toEqual({ w: 0, l: 1, t: 0 })
  })
  it('measures winning margin over decided games only', () => {
    const h = headToHead(list, 'PIT', 'BAL')
    expect(h.all.avgWinMargin).toBeCloseTo((3 + 17 + 3 + 4 + 11) / 5, 1)
  })
})

describe('betting trends', () => {
  const t = bettingTrends(meetings(RIVALRY, 'PIT', 'BAL'), 'PIT', 'BAL')
  it('leaves games with no recorded line out, and says how many', () => {
    expect(t.withSpread).toBe(5)
    expect(t.missingSpread).toBe(1)
    expect(t.missingTotal).toBe(1)
  })
  it('scores ATS for each team, home and road', () => {
    // PIT: +4 (won by 3 getting 1), -11, -6 (lost by 3 laying 3), push 0, -0.5 (lost by 4 getting 3.5)
    expect(t.ats.PIT).toEqual({ w: 1, l: 3, p: 1 })
    expect(t.ats.BAL).toEqual({ w: 3, l: 1, p: 1 })
    expect(t.homeAts.w + t.homeAts.l + t.homeAts.p).toBe(5)
  })
  it('scores favourites and underdogs, leaving pick\'ems out', () => {
    expect(t.pickem).toBe(1)
    expect(t.favorite.n).toBe(4)
    expect(t.favorite.su.w + t.underdog.su.w + t.favorite.su.t).toBe(4)
  })
  it('splits each team into home/road favourite/underdog', () => {
    expect(t.roles.PIT.homeDog.n).toBe(1) // 2021, PIT home getting 1
    expect(t.roles.PIT.homeFav.n).toBe(1) // 2023 playoff, PIT laying 3
    expect(t.roles.PIT.roadDog.n).toBe(2)
  })
  it('compares closing totals with combined points', () => {
    // 37 v 44, 37 v 45, 37 v 37 (push), 26 v 40, 66 v 46
    expect(t.ou).toEqual({ o: 1, u: 3, p: 1 })
    expect(t.avgTotal).toBeCloseTo((44 + 45 + 37 + 40 + 46) / 5, 1)
  })
})

describe('record against the whole division', () => {
  const games = [
    ...RIVALRY,
    g(2025, '2025-10-05', 'CLE', 'PIT', 10, 30, -2, 40),
    g(2025, '2025-10-12', 'PIT', 'KC', 10, 30, -2, 40) // not a division game
  ]
  it('counts regular-season division games only', () => {
    const r = divisionalRecord(games, 'PIT', 2025, 2025)
    expect(r.games).toBe(2)
    expect(r.record).toEqual({ w: 2, l: 0, t: 0 })
    expect(r.withSpread).toBe(1)
    expect(r.pointsFor).toBe(51)
  })
  it('gives this season, last season and the last three', () => {
    const r = recentDivisional(games, 'PIT', 2025)
    expect(r.previous.games).toBe(1)
    expect(r.last3.games).toBe(4) // the 2023 tie, 2024, and both 2025 games; the 2023 playoff game is left out
  })
})

describe('patterns', () => {
  const list = Array.from({ length: 8 }, (_, i) => g(2018 + i, `${2018 + i}-10-01`, i % 2 ? 'PIT' : 'BAL', i % 2 ? 'BAL' : 'PIT', i % 2 ? 10 : 27, i % 2 ? 24 : 13, 0, 40)).reverse()
  it('calls out a team that keeps losing to a rival, with the sample size', () => {
    const p = matchupPatterns(list, 'PIT', 'BAL', list, 2025)
    const s = p.find((x) => x.kind === 'struggles')
    expect(s.team).toBe('PIT')
    expect(s.n).toBe(8)
  })
  it('stays quiet with too few meetings', () => {
    expect(matchupPatterns(list.slice(0, 3), 'PIT', 'BAL', [], 2025)).toEqual([])
  })
})

describe('weighting old meetings', () => {
  const m = g(2023, '2023-10-01', 'PIT', 'BAL', 20, 17, 3, 40, { homeQb: 'Old QB', awayQb: 'Lamar Jackson', homeCoach: 'Coach A', awayCoach: 'John Harbaugh' })
  it('halves every two seasons', () => {
    expect(meetingWeight(m, 2025)).toBeCloseTo(0.5)
  })
  it('counts a meeting less when a side has a different starting QB or coach now', () => {
    const now = { PIT: { qb: 'New QB', coach: 'Coach A' }, BAL: { qb: 'Lamar Jackson', coach: 'John Harbaugh' } }
    expect(meetingWeight(m, 2025, now)).toBeCloseTo(0.5 * 0.6)
    const both = { PIT: { qb: 'New QB', coach: 'Coach B' }, BAL: { qb: 'Lamar Jackson', coach: 'John Harbaugh' } }
    expect(meetingWeight(m, 2025, both)).toBeCloseTo(0.5 * 0.6 * 0.8)
  })
  it('needs at least three meetings with a line before giving a signal', () => {
    expect(pairSignal(meetings(RIVALRY, 'PIT', 'BAL').slice(0, 3), 'PIT', 2025).atsResid).toBeNull()
    expect(pairSignal(meetings(RIVALRY, 'PIT', 'BAL'), 'PIT', 2025).atsResid).not.toBeNull()
  })
})

describe('fitting what history is worth', () => {
  it('shrinks noise to nearly nothing and keeps most of a clear effect', () => {
    expect(shrink(0.05, 0.065)).toBeLessThan(0.02)
    expect(shrink(-0.66, 0.34)).toBeCloseTo(-0.52, 1)
    expect(shrink(0.5, null)).toBe(0)
  })

  it('measures the division home-field gap against other games', () => {
    // Division home teams always 2 short of the line, others always on it.
    const games = []
    for (let i = 0; i < 60; i++) {
      games.push({ ...g(2010, `2010-09-${String(10 + (i % 18)).padStart(2, '0')}`, 'PIT', 'BAL', 20 + (i % 3), 20, 1 + (i % 3) + 2, 40), divisional: true })
      games.push({ ...g(2010, `2010-09-${String(10 + (i % 18)).padStart(2, '0')}`, 'PIT', 'KC', 20 + (i % 3), 20, i % 3, 40), divisional: false })
    }
    const fit = fitDivisionalModel(games)
    expect(fit.homeField.divisionalHomeResid).toBeCloseTo(-3, 1)
    expect(fit.homeField.otherHomeResid).toBeCloseTo(0, 1)
    expect(fit.homeField.n).toBe(60)
  })

  it('the bundled fit is current and found the effects reported to the user', () => {
    expect(divisionModel.divisionGames).toBeGreaterThan(2300)
    expect(divisionModel.fit.homeField.applied).toBeLessThan(0)
    // Head-to-head ATS and team form carry little or no weight.
    expect(Math.abs(divisionModel.fit.teamForm.applied)).toBeLessThan(0.05)
    expect(Math.abs(divisionModel.fit.h2hSpread.applied)).toBeLessThan(0.1)
  })
})

describe('the projection adjustment', () => {
  const model = {
    fit: { homeField: { applied: -0.5 }, h2hSpread: { applied: 0.05 }, teamForm: { applied: 0 }, h2hTotal: { applied: -0.1 } },
    pairs: { 'BAL|PIT': { team: 'BAL', atsResid: 6, totalResid: 8, n: 10 } },
    teamForm: {}
  }
  const game = { home: 'PIT', away: 'BAL', kickoff: '2026-12-06T18:00:00Z' }
  const proj = { margin: 2, total: 44, homeWinProb: 0.56, awayWinProb: 0.44, homeTeamTotal: 23, awayTeamTotal: 21, qbOut: { home: false, away: false } }

  it('adds the measured pieces from the home team\'s side', () => {
    const adj = divisionalAdjustment(game, model)
    // home field -0.5; BAL +6 vs line -> PIT -6 -> 0.05 * -6 = -0.3
    expect(adj.marginShift).toBeCloseTo(-0.8)
    expect(adj.totalShift).toBeCloseTo(-0.8)
  })
  it('caps how far history can move the spread', () => {
    const big = { ...model, fit: { ...model.fit, homeField: { applied: -5 } } }
    expect(divisionalAdjustment(game, big).marginShift).toBe(-MAX_MARGIN_SHIFT)
  })
  it('leaves non-division, preseason and neutral-site home field alone', () => {
    expect(divisionalAdjustment({ home: 'PIT', away: 'KC' }, model)).toBeNull()
    expect(divisionalAdjustment({ ...game, preseason: true }, model)).toBeNull()
    expect(divisionalAdjustment({ ...game, neutral: true }, model).parts.find((p) => p.key === 'homeField')).toBeUndefined()
  })
  it('moves margin, total, team totals and win chance together, and keeps the QB adjustment', () => {
    const p = applyDivisionalAdjustment(game, proj, model)
    expect(p.margin).toBeCloseTo(1.2)
    expect(p.homeWinProb).toBeLessThan(proj.homeWinProb)
    expect(p.total).toBe(43)
    expect(p.homeTeamTotal + p.awayTeamTotal).toBeCloseTo(p.total, 0)
    expect(p.qbOut).toEqual(proj.qbOut)
    expect(p.divisional.parts.length).toBe(3)
  })
})

describe('bets', () => {
  const model = { upcoming: [{ home: 'PIT', away: 'BAL', date: '2026-12-06', spread: -3, total: 41.5, homeML: 140, awayML: -165 }] }
  const game = { home: 'PIT', away: 'BAL', kickoff: '2026-12-06T18:00:00Z' }

  it('uses the posted line, never the simulated market', () => {
    const line = lineFor({ ...game, market: { simulated: true, consensus: { spreadHome: 7, total: 50 } } }, model)
    expect(line.spread).toBe(-3)
    expect(line.source).toMatch(/nflverse/)
    const live = lineFor({ ...game, market: { simulated: false, consensus: { spreadHome: 2.5, total: 42 } } }, model)
    expect(live.spread).toBe(-2.5)
    expect(live.total).toBe(42)
  })
  it('says there is no line rather than inventing one', () => {
    expect(lineFor({ home: 'PIT', away: 'BAL', kickoff: '2026-12-20T18:00:00Z' }, model)).toBeNull()
    const bets = assessBets({ game, projection: { margin: 1, total: 44, homeWinProb: 0.53 }, line: null, list: [], model: {} })
    expect(bets.spread.level).toBe('no line')
    expect(bets.total.level).toBe('no line')
    expect(bets.moneyline.level).toBe('no line')
  })
  it('gives each market its own confidence, capped by the game\'s', () => {
    const line = lineFor(game, model)
    const projection = { margin: 2, total: 47, homeWinProb: 0.56 }
    const bets = assessBets({ game, projection, line, list: meetings(RIVALRY, 'PIT', 'BAL'), model: {}, baseLevel: 'high' })
    expect(bets.spread.pick).toBe('PIT') // model PIT by 2, line BAL by 3
    expect(bets.spread.edge).toBeCloseTo(5)
    expect(bets.spread.level).toBe('high')
    expect(bets.total.pick).toBe('over')
    expect(bets.total.level).toBe('high')
    const capped = assessBets({ game, projection, line, list: [], model: {}, baseLevel: 'low' })
    expect(capped.spread.level).toBe('low')
  })
  it('reports whether the head-to-head record agrees, without changing confidence', () => {
    const line = lineFor(game, model)
    const projection = { margin: 2, total: 47, homeWinProb: 0.56 }
    const list = meetings(RIVALRY, 'PIT', 'BAL')
    const a = assessBets({ game, projection, line, list, model: {}, baseLevel: 'high' })
    expect(['supports', 'contradicts', 'neutral', 'none']).toContain(a.spread.history.lean)
    expect(a.spread.history.text).toMatch(/PIT is \d+-\d+/)
    expect(a.total.history.text).toMatch(/went over 1 and under 3/)
  })
})

describe('decoding the bundled file', () => {
  it('turns rows back into games, with names restored', () => {
    const file = {
      columns: ['season', 'type', 'week', 'date', 'home', 'away', 'hs', 'as', 'spread', 'total', 'hml', 'aml', 'hqb', 'aqb', 'hc', 'ac', 'ot', 'neutral'],
      names: ['A', 'B'],
      games: [[2024, 'P', 19, '2025-01-11', 'PIT', 'BAL', 14, 28, -9.5, 44, null, null, 0, 1, -1, -1, 0, 0]]
    }
    expect(decodeHistory(file)[0]).toMatchObject({ postseason: true, homeQb: 'A', awayQb: 'B', homeCoach: null, spread: -9.5 })
  })
})
