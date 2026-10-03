import { describe, it, expect } from 'vitest'
import { projectGameEpa, leagueAverages, blendTeamEfficiency, blendedSeasonEfficiency } from './epaModel.js'

const efficiency = {
  KC: { epaPerPlayOff: 0.15, epaPerPlayDef: -0.10, playsPerGame: 65 },
  LV: { epaPerPlayOff: -0.15, epaPerPlayDef: 0.10, playsPerGame: 63 },
  AVG1: { epaPerPlayOff: 0, epaPerPlayDef: 0, playsPerGame: 64 },
  AVG2: { epaPerPlayOff: 0, epaPerPlayDef: 0, playsPerGame: 64 }
}

describe('leagueAverages', () => {
  it('averages offensive and defensive EPA/play and plays per game across all teams', () => {
    const l = leagueAverages(efficiency)
    expect(l.offEpa).toBeCloseTo(0, 5) // (0.15 - 0.15 + 0 + 0) / 4
    expect(l.defEpa).toBeCloseTo(0, 5)
    expect(l.playsPerGame).toBeCloseTo((65 + 63 + 64 + 64) / 4, 5)
  })

  it('falls back to a reasonable default plays/game when the table is empty', () => {
    expect(leagueAverages({}).playsPerGame).toBe(64)
    expect(leagueAverages(null).playsPerGame).toBe(64)
  })
})

describe('projectGameEpa', () => {
  it('returns null when either team is missing from the efficiency table', () => {
    expect(projectGameEpa({ home: 'KC', away: 'ZZZ' }, efficiency)).toBeNull()
    expect(projectGameEpa({ home: 'ZZZ', away: 'KC' }, efficiency)).toBeNull()
  })

  it('favors the team with better offensive and defensive efficiency', () => {
    const proj = projectGameEpa({ home: 'KC', away: 'LV' }, efficiency, { homeField: 1.6 })
    expect(proj.margin).toBeGreaterThan(0)
    expect(proj.homeWinProb).toBeGreaterThan(0.5)
    expect(proj.homeWinProb + proj.awayWinProb).toBeCloseTo(1, 10)
  })

  it('two perfectly league-average teams project to roughly a pick\'em plus home field', () => {
    const proj = projectGameEpa({ home: 'AVG1', away: 'AVG2' }, efficiency, { homeField: 1.6 })
    expect(proj.margin).toBeCloseTo(1.6, 5) // pure home-field, no efficiency edge either way
  })

  it('a neutral-site game applies no home-field adjustment', () => {
    const proj = projectGameEpa({ home: 'AVG1', away: 'AVG2', neutral: true }, efficiency, { homeField: 1.6 })
    expect(proj.margin).toBeCloseTo(0, 5)
  })

  it('never looks at margin/result data — rebuilding efficiency with the sides swapped flips the projection symmetrically', () => {
    const a = projectGameEpa({ home: 'KC', away: 'LV' }, efficiency, { homeField: 0 })
    const b = projectGameEpa({ home: 'LV', away: 'KC' }, efficiency, { homeField: 0 })
    expect(a.margin).toBeCloseTo(-b.margin, 5)
  })
})

describe('blendTeamEfficiency', () => {
  it('weights fully toward current season once a team has played 8+ games', () => {
    const current = { games: 8, epaPerPlayOff: 0.2, epaPerPlayDef: -0.1, playsPerGame: 65 }
    const prior = { games: 17, epaPerPlayOff: -0.1, epaPerPlayDef: 0.1, playsPerGame: 60 }
    const blended = blendTeamEfficiency(current, prior)
    expect(blended.epaPerPlayOff).toBeCloseTo(0.2, 5)
  })

  it('weights mostly toward last season when only a couple games are in', () => {
    const current = { games: 2, epaPerPlayOff: 0.4, epaPerPlayDef: -0.1, playsPerGame: 65 }
    const prior = { games: 17, epaPerPlayOff: 0.0, epaPerPlayDef: 0.0, playsPerGame: 60 }
    const blended = blendTeamEfficiency(current, prior)
    // w = 2/8 = 0.25, so mostly the prior-season number should show through.
    expect(blended.epaPerPlayOff).toBeCloseTo(0.4 * 0.25, 5)
  })

  it('falls back to whichever season actually has data', () => {
    expect(blendTeamEfficiency(undefined, { games: 17, epaPerPlayOff: 0.1 }).epaPerPlayOff).toBe(0.1)
    expect(blendTeamEfficiency({ games: 3, epaPerPlayOff: 0.1 }, undefined).epaPerPlayOff).toBe(0.1)
    expect(blendTeamEfficiency(undefined, undefined)).toBeNull()
  })
})

describe('blendedSeasonEfficiency', () => {
  it('blends every team present in either season', () => {
    const seasons = {
      2026: { KC: { games: 3, epaPerPlayOff: 0.3, playsPerGame: 65 } },
      2025: { KC: { games: 17, epaPerPlayOff: 0.0, playsPerGame: 60 }, LV: { games: 17, epaPerPlayOff: -0.2, playsPerGame: 62 } }
    }
    const table = blendedSeasonEfficiency(seasons, 2026)
    expect(Object.keys(table).sort()).toEqual(['KC', 'LV'])
    // LV has no current-season row at all, so it should fall straight through to last season's.
    expect(table.LV.epaPerPlayOff).toBe(-0.2)
  })
})
