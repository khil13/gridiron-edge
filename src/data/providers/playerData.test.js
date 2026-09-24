import { describe, it, expect, vi, afterEach } from 'vitest'

const LATEST_SEASON = 2025

vi.mock('../generated/player-stats-meta.json', () => ({
  default: { generatedAt: '2026-01-01T00:00:00.000Z', latestSeason: LATEST_SEASON, playerCount: 2 }
}))

vi.mock('../generated/player-stats.json', () => ({
  default: {
    generatedAt: '2026-01-01T00:00:00.000Z',
    latestSeason: LATEST_SEASON,
    seasons: {
      [LATEST_SEASON]: {
        'cin star wr|WR': { games: 8, tds: 6, receivingYards: 900, receptions: 60, targets: 90, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 },
        'det star wr|WR': { games: 8, tds: 3, receivingYards: 500, receptions: 40, targets: 60, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 }
      },
      [LATEST_SEASON - 1]: {
        'cin star wr|WR': { games: 17, tds: 9, receivingYards: 1200, receptions: 95, targets: 140, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 },
        'det star wr|WR': { games: 17, tds: 5, receivingYards: 800, receptions: 70, targets: 100, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 }
      }
    }
  }
}))

vi.mock('../generated/player-ngs.json', () => ({
  default: {
    generatedAt: '2026-01-01T00:00:00.000Z',
    latestSeason: 2024,
    players: {
      'cin star wr|WR': { season: 2024, avgSeparation: 3.3, yacAboveExpectation: 4.2 }
    }
  }
}))

const { fetchGameRosters, assignRoles } = await import('./playerData.js')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const rosterJson = (players) => ({
  athletes: [{
    items: players.map((p, i) => ({
      id: String(p.id ?? i + 1),
      displayName: p.name,
      position: { abbreviation: p.position ?? 'WR' },
      status: { name: 'Active' }
    }))
  }]
})

function mockFetchRouter(routes) {
  return vi.fn(async (url) => {
    for (const [pattern, respond] of routes) {
      if (pattern.test(String(url))) return respond(String(url))
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

describe('fetchGameRosters with the bundled stats snapshot', () => {
  const game = { id: 'g1', home: 'CIN', away: 'DET' }

  it('merges real per-player stats from the bundled snapshot without needing an explicit season', async () => {
    // No `season` option passed — this should anchor to the snapshot's own
    // latestSeason rather than the wall-clock year, which is the whole
    // point of the fix (a clock/data-currency mismatch previously made
    // every lookup miss).
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game)

    expect(result.statsSeason).toBe(LATEST_SEASON)
    expect(result.hasSeasonStats).toBe(true)
    expect(result.usedPriorSeason).toBe(false)
    expect(result.statsNote).toBeNull()
    const cinStar = result.players.find((p) => p.name === 'Cin Star WR')
    expect(cinStar.stats.receivingYards).toBe(900)
  })

  it('falls back to last season for a player with nothing yet this year', async () => {
    vi.doMock('../generated/player-stats.json', () => ({
      default: {
        latestSeason: LATEST_SEASON,
        seasons: {
          // Only a prior-season row exists for either player.
          [LATEST_SEASON - 1]: {
            'cin star wr|WR': { games: 17, tds: 9, receivingYards: 1200, receptions: 95, targets: 140, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 },
            'det star wr|WR': { games: 17, tds: 5, receivingYards: 800, receptions: 70, targets: 100, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 }
          }
        }
      }
    }))
    vi.resetModules()
    const { fetchGameRosters: fetchGameRostersFresh } = await import('./playerData.js')

    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRostersFresh(game)

    expect(result.usedPriorSeason).toBe(true)
    expect(result.players.every((p) => p.stats?.games)).toBe(true)
  })

  it('falls back to last season when the current season has a zero-games row (bye, inactive, or too early)', async () => {
    vi.doMock('../generated/player-stats.json', () => ({
      default: {
        latestSeason: LATEST_SEASON,
        seasons: {
          [LATEST_SEASON]: {
            // On file for this season, but hasn't recorded a snap yet.
            'cin star wr|WR': { games: 0, tds: 0, receivingYards: 0, receptions: 0, targets: 0, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 }
          },
          [LATEST_SEASON - 1]: {
            'cin star wr|WR': { games: 17, tds: 9, receivingYards: 1200, receptions: 95, targets: 140, rushingYards: 0, rushingAttempts: 0, passingYards: 0, passingAttempts: 0, passingTouchdowns: 0 }
          }
        }
      }
    }))
    vi.resetModules()
    const { fetchGameRosters: fetchGameRostersFresh } = await import('./playerData.js')

    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRostersFresh(game)

    const cinStar = result.players.find((p) => p.name === 'Cin Star WR')
    expect(cinStar.stats.games).toBe(17)
    expect(cinStar.stats.receivingYards).toBe(1200)
    expect(result.usedPriorSeason).toBe(true)
  })

  it('notes the coverage gap when no roster matches the snapshot', async () => {
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Nobody On File' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Also Unlisted' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game)

    expect(result.hasSeasonStats).toBe(false)
    expect(result.statsNote).toMatch(/bundled stats snapshot/)
  })

  it('skips the snapshot lookup for a roster that already has usable embedded stats', async () => {
    const withStats = {
      athletes: [{
        items: [{
          id: '10', displayName: 'Cin Star WR', position: { abbreviation: 'WR' }, status: { name: 'Active' },
          statistics: {
            categories: [{
              name: 'receiving',
              stats: [{ name: 'gamesPlayed', value: 8 }, { name: 'receivingYards', value: 700 }]
            }]
          }
        }]
      }]
    }
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => withStats })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game)

    // CIN's embedded stats should win rather than being overwritten by the snapshot.
    const cinStar = result.players.find((p) => p.name === 'Cin Star WR')
    expect(cinStar.stats.receivingYards).toBe(700)
    const detStar = result.players.find((p) => p.name === 'Det Star WR')
    expect(detStar.stats.receivingYards).toBe(500)

    // Next Gen Stats is a separate lookup from the season totals, and must
    // still reach this player even though the roster's own embedded stats
    // short-circuited the bundled-snapshot lookup above — ESPN's roster
    // feed never carries NGS itself, so this is the only place it can come
    // from regardless of which branch supplied the season totals.
    expect(cinStar.ngs).toEqual({ season: 2024, avgSeparation: 3.3, yacAboveExpectation: 4.2 })
  })

  it('attaches Next Gen Stats via the bundled-snapshot branch too', async () => {
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game)

    const cinStar = result.players.find((p) => p.name === 'Cin Star WR')
    expect(cinStar.ngs).toEqual({ season: 2024, avgSeparation: 3.3, yacAboveExpectation: 4.2 })
    // Det has real season totals but no row in the NGS fixture at all.
    const detStar = result.players.find((p) => p.name === 'Det Star WR')
    expect(detStar.ngs).toBeUndefined()
  })
})

describe('assignRoles', () => {
  const qb = (id, name, tds) => ({ id, name, position: 'QB', tds, stats: { games: 8 } })

  it('marks only the depth chart\'s top QB as the main "QB" role; the rest are backups', () => {
    const players = [qb(1, 'Backup Arm', 9), qb(2, 'Current Starter', 1), qb(3, 'Third String', 0)]
    // The current starter is rank 1 on the real chart despite having fewer
    // touchdowns than the benched former starter — a real depth chart must
    // win over touchdown count for who counts as the starter.
    const depthRanks = new Map([['2', 1], ['1', 2], ['3', 3]])

    const roles = assignRoles(players, depthRanks)
    const byName = Object.fromEntries(roles.map((p) => [p.name, p]))
    expect(byName['Backup Arm'].role).toBe('QB2') // ranked 2nd despite more TDs
    expect(byName['Current Starter'].role).toBe('QB') // ranked 1st on the chart
    expect(byName['Third String'].role).toBe('QB2') // ranked 3rd
    expect(byName['Current Starter'].depthKnown).toBe(true)
  })

  it('never ranks QBs by touchdown count when no real depth chart is available', () => {
    // A benched former starter (Dillon-Gabriel-shaped: real touchdowns from
    // earlier starts) alongside a new starter with none yet. Without a real
    // chart, ranking by touchdowns would confidently name the wrong guy.
    const players = [qb(1, 'Benched Former Starter', 6), qb(2, 'New Starter', 0)]

    const roles = assignRoles(players, null)
    expect(roles.every((p) => p.role === 'QB')).toBe(true)
    expect(roles.every((p) => p.depthKnown === false)).toBe(true)
    expect(roles.every((p) => p.flatShare != null)).toBe(true)
  })

  it('still ranks other position groups by touchdown count when no chart is available', () => {
    // Unlike QB, a running back's touchdown share is a reasonable stand-in
    // for depth when no chart has been published — this is existing,
    // unaffected behavior worth guarding against regression.
    const players = [
      { id: 1, name: 'Lead Back', position: 'RB', tds: 5, stats: { games: 8 } },
      { id: 2, name: 'Change of Pace', position: 'RB', tds: 1, stats: { games: 8 } }
    ]

    const roles = assignRoles(players, null)
    const byName = Object.fromEntries(roles.map((p) => [p.name, p]))
    expect(byName['Lead Back'].role).toBe('RB1')
    expect(byName['Change of Pace'].role).toBe('RB2')
    expect(byName['Lead Back'].depthKnown).toBe(true)
    expect(byName['Lead Back'].depthSource).toBe('scoring')
  })
})
