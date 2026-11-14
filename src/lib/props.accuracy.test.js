import { describe, it, expect, vi } from 'vitest'

vi.mock('../data/generated/team-defense.json', () => ({ default: { latestSeason: 2026, seasons: {} } }))

const {
  projectVolume, projectAnytimeTouchdowns, touchdownShare, sampleWeight, touchdownRate,
  ROLE_PRIORS, VOLUME_PRIORS, PLAYER_PRIOR_K, PRIOR_SEASON_K, VOLUME_SHRINKAGE_K, TD_SHRINKAGE_K, ENVIRONMENT_DAMPING
} = await import('./props.js')

const recYards = { key: 'receivingYards', label: 'Receiving yards', stat: 'receivingYards', positions: ['WR'] }
const rushYards = { key: 'rushingYards', label: 'Rushing yards', stat: 'rushingYards', positions: ['RB'] }
const neutral = { teamPoints: 22, teamAverage: 22 }

describe('projectVolume — a receiver regresses toward his own last season', () => {
  const lastSeason = { games: 17, receivingYards: 1530, receptions: 102 } // 90/g
  const hot = { role: 'WR1', stats: { games: 2, receivingYards: 60 }, priorStats: lastSeason } // 30/g so far

  it('uses last season\'s own rate as the anchor, not just the WR1 league average', () => {
    const withPrior = projectVolume(hot, recYards, neutral)
    const without = projectVolume({ ...hot, priorStats: undefined }, recYards, neutral)
    // A proven 90-yard receiver two quiet games into a season projects well
    // above what the role average alone would say.
    expect(withPrior.mean).toBeGreaterThan(without.mean + 10)
    expect(withPrior.shrinkage.ownPrior).toBe(true)
    expect(without.shrinkage.ownPrior).toBe(false)
  })

  it('pulls last season itself toward the role average, since roles change', () => {
    const v = projectVolume(hot, recYards, neutral)
    const role = VOLUME_PRIORS.WR1.receivingYards
    const prior = (17 * 90 + PRIOR_SEASON_K * role) / (17 + PRIOR_SEASON_K)
    const expected = (2 * 30 + PLAYER_PRIOR_K * prior) / (2 + PLAYER_PRIOR_K)
    expect(v.mean).toBeCloseTo(expected, 0)
  })

  it('never changes the displayed real rate', () => {
    expect(projectVolume(hot, recYards, neutral).perGame).toBe(30)
  })

  it('does not apply to rushing — measured as no gain there', () => {
    const back = { role: 'RB1', stats: { games: 2, rushingYards: 60 }, priorStats: { games: 17, rushingYards: 1700 } }
    const v = projectVolume(back, rushYards, neutral)
    const role = VOLUME_PRIORS.RB1.rushingYards
    const w = 2 / (2 + VOLUME_SHRINKAGE_K)
    expect(v.mean).toBeCloseTo(30 * w + role * (1 - w), 0)
    expect(v.shrinkage.ownPrior).toBe(false)
  })

  it('is skipped when the stats in use already ARE last season\'s', () => {
    const p = { role: 'WR1', statsPriorSeason: true, stats: lastSeason, priorStats: lastSeason }
    expect(projectVolume(p, recYards, neutral).shrinkage.ownPrior).toBe(false)
  })

  it('ignores an empty prior season', () => {
    const p = { ...hot, priorStats: { games: 0, receivingYards: 0 } }
    expect(projectVolume(p, recYards, neutral).shrinkage.ownPrior).toBe(false)
  })
})

describe('projectVolume — environment and script', () => {
  const wr = { role: 'WR1', stats: { games: 16, receivingYards: 1280 } }

  it('moves a projection only slightly for a big swing in expected scoring', () => {
    const base = projectVolume(wr, recYards, neutral).mean
    const shootout = projectVolume(wr, recYards, { teamPoints: 33, teamAverage: 22 }).mean
    // +50% expected points moves the projection by 50% x the damping.
    expect(shootout / base).toBeCloseTo(1 + 0.5 * ENVIRONMENT_DAMPING, 2)
    expect(ENVIRONMENT_DAMPING).toBeLessThanOrEqual(0.3)
  })
})

describe('anytime touchdowns — per-game rates, each from the player\'s own sample', () => {
  const ctx = { AAA: { expectedTds: 2.5 } }

  it('weights by the player\'s own games at the documented constant', () => {
    expect(sampleWeight(0)).toBe(0)
    expect(sampleWeight(TD_SHRINKAGE_K)).toBeCloseTo(0.5, 6)
    expect(sampleWeight(4)).toBeCloseTo(4 / (4 + TD_SHRINKAGE_K), 6)
  })

  it('falls back to the role prior with no games or no team rate', () => {
    expect(touchdownShare(0.5, 2, 0, 'RB1')).toBe(ROLE_PRIORS.RB1)
    expect(touchdownShare(0.5, 0, 8, 'RB1')).toBe(ROLE_PRIORS.RB1)
  })

  it('does not let a teammate\'s 17-game total from last season swamp a 3-game total from this one', () => {
    // Same real scoring pace (1 per game) from two very different samples.
    // Summing raw totals — 3 vs 17 — used to hand the second player almost
    // the entire team share; per-game rates see them as the same pace.
    const players = [
      { name: 'This Season', team: 'AAA', role: 'RB1', tds: 3, stats: { games: 3 } },
      { name: 'Last Season', team: 'AAA', role: 'RB2', tds: 17, stats: { games: 17 } }
    ]
    expect(touchdownRate(players[0])).toBe(touchdownRate(players[1]))
    const [a, b] = ['This Season', 'Last Season'].map((n) => projectAnytimeTouchdowns(players, ctx).find((p) => p.name === n))
    // The larger sample earns more trust in its observed share, but the
    // thin one is nowhere near wiped out.
    expect(a.lambda).toBeGreaterThan(b.lambda * 0.5)
  })

  it('regresses a hot start most of the way back to the role prior', () => {
    // Two touchdowns in one game is not a two-a-week scorer.
    const players = [
      { name: 'Hot', team: 'AAA', role: 'WR3', tds: 2, stats: { games: 1 } },
      { name: 'Steady', team: 'AAA', role: 'RB1', tds: 0, stats: { games: 1 } }
    ]
    const hot = projectAnytimeTouchdowns(players, ctx).find((p) => p.name === 'Hot')
    // Observed share is 100%; the blended share stays close to the WR3 prior.
    expect(hot.share).toBeLessThan(ROLE_PRIORS.WR3 + 0.1)
    expect(hot.share).toBeGreaterThan(ROLE_PRIORS.WR3)
  })

  it('still uses a flat share when the depth chart is unknown', () => {
    const players = [{ name: 'Unranked', team: 'AAA', role: 'WR', flatShare: 0.05, tds: 4, stats: { games: 4 } }]
    expect(projectAnytimeTouchdowns(players, ctx)[0].share).toBe(0.05)
  })
})
