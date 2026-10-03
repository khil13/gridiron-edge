import { describe, it, expect, vi } from 'vitest'

// AAA allows well above league average on both sides; CCC well below.
// League-average receiving/game across AAA+BBB+CCC = (300+200+100)/3 = 200.
vi.mock('../data/generated/team-defense.json', () => ({
  default: {
    latestSeason: 2026,
    seasons: {
      2026: {
        AAA: { receivingYardsAllowed: 900, receivingTdsAllowed: 6, rushingYardsAllowed: 600, rushingTdsAllowed: 4, games: 3, ranks: { receivingYardsAllowed: 1, rushingYardsAllowed: 1, receivingTdsAllowed: 1, rushingTdsAllowed: 1 } },
        BBB: { receivingYardsAllowed: 600, receivingTdsAllowed: 3, rushingYardsAllowed: 300, rushingTdsAllowed: 1, games: 3, ranks: { receivingYardsAllowed: 2, rushingYardsAllowed: 2, receivingTdsAllowed: 2, rushingTdsAllowed: 2 } },
        CCC: { receivingYardsAllowed: 300, receivingTdsAllowed: 1, rushingYardsAllowed: 150, rushingTdsAllowed: 0, games: 3, ranks: { receivingYardsAllowed: 3, rushingYardsAllowed: 3, receivingTdsAllowed: 3, rushingTdsAllowed: 3 } }
      }
    }
  }
}))

const { projectVolume, GAME_SCRIPT_MAX_SWING, GAME_SCRIPT_MARGIN_CAP } = await import('./props.js')

const receivingYardsMarket = { key: 'receivingYards', label: 'Receiving yards', stat: 'receivingYards', positions: ['WR'] }
const receptionsMarket = { key: 'receptions', label: 'Receptions', stat: 'receptions', positions: ['WR'] }
const rushingYardsMarket = { key: 'rushingYards', label: 'Rushing yards', stat: 'rushingYards', positions: ['RB'] }

const player = { stats: { games: 8, receivingYards: 640 } } // 80 yds/g, no environment shift
const rusher = { stats: { games: 8, rushingYards: 640 } }

describe('projectVolume — opponent defense adjustment', () => {
  it('scales a projection up against a defense that allows well above league average', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'AAA' })
    expect(v.defense).not.toBeNull()
    expect(v.defense.rank).toBe(1)
    expect(v.defense.factor).toBeGreaterThan(1)
    expect(v.mean).toBeGreaterThan(v.perGame)
  })

  it('scales a projection down against a stingy defense', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'CCC' })
    expect(v.defense.factor).toBeLessThan(1)
    expect(v.mean).toBeLessThan(v.perGame)
  })

  it('damps the adjustment rather than passing the full ratio through', () => {
    // AAA allows 300/g receiving vs league avg 200/g -> raw ratio 1.5.
    // A damped, clamped factor should land well short of that.
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'AAA' })
    expect(v.defense.factor).toBeLessThan(1.5)
    expect(v.defense.factor).toBeLessThanOrEqual(1.25) // the documented clamp
  })

  it('is left off when no opponent is given', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.defense).toBeNull()
    expect(v.mean).toBe(v.perGame)
  })

  it('is left off for a market team-defense.json does not cover (receptions)', () => {
    const p = { stats: { games: 8, receptions: 48 } }
    const v = projectVolume(p, receptionsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'AAA' })
    expect(v.defense).toBeNull()
  })

  it('is left off for an opponent with no usable defense data', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, opponent: 'NOBODY' })
    expect(v.defense).toBeNull()
    expect(v.mean).toBe(v.perGame)
  })

  it('combines with the environment adjustment rather than replacing it', () => {
    // Team projected well above its own average AND a generous defense:
    // both factors should apply, so the combined mean exceeds either alone.
    const envOnly = projectVolume(player, receivingYardsMarket, { teamPoints: 30, teamAverage: 22 })
    const combined = projectVolume(player, receivingYardsMarket, { teamPoints: 30, teamAverage: 22, opponent: 'AAA' })
    expect(combined.mean).toBeGreaterThan(envOnly.mean)
  })
})

describe('projectVolume — game script adjustment', () => {
  it('scales a trailing team\'s passing volume up', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: -14 })
    expect(v.gameScript).not.toBeNull()
    expect(v.gameScript.factor).toBeGreaterThan(1)
    expect(v.mean).toBeGreaterThan(v.perGame)
  })

  it('scales a trailing team\'s rushing volume down', () => {
    const v = projectVolume(rusher, rushingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: -14 })
    expect(v.gameScript.factor).toBeLessThan(1)
    expect(v.mean).toBeLessThan(v.perGame)
  })

  it('scales a leading team the opposite way: passing down, rushing up', () => {
    const pass = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: 14 })
    const rush = projectVolume(rusher, rushingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: 14 })
    expect(pass.gameScript.factor).toBeLessThan(1)
    expect(rush.gameScript.factor).toBeGreaterThan(1)
  })

  it('caps the swing at the documented maximum even for a lopsided margin', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: -35 })
    expect(v.gameScript.factor).toBeCloseTo(1 + GAME_SCRIPT_MAX_SWING, 5)
    // A margin beyond the cap should land at exactly the same factor as the cap itself.
    const atCap = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: -GAME_SCRIPT_MARGIN_CAP })
    expect(v.gameScript.factor).toBeCloseTo(atCap.gameScript.factor, 5)
  })

  it('is left off for a close game (zero margin)', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22, marginForTeam: 0 })
    expect(v.gameScript.factor).toBe(1)
  })

  it('is left off entirely when no margin is given', () => {
    const v = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    expect(v.gameScript).toBeNull()
  })

  it('combines with the defense and environment adjustments', () => {
    const base = projectVolume(player, receivingYardsMarket, { teamPoints: 22, teamAverage: 22 })
    const all = projectVolume(player, receivingYardsMarket, {
      teamPoints: 22, teamAverage: 22, opponent: 'AAA', marginForTeam: -14
    })
    expect(all.defense).not.toBeNull()
    expect(all.gameScript).not.toBeNull()
    expect(all.mean).toBeGreaterThan(base.mean)
  })
})
