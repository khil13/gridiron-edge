import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchGameRosters, fetchAthleteStats } from './playerData.js'

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

const athleteStatsJson = (year, overrides = {}) => ({
  categories: [
    {
      name: 'receiving',
      names: ['gamesPlayed', 'receivingYards', 'receptions', 'receivingTargets', 'receivingTouchdowns'],
      statistics: [{
        season: { year },
        stats: [
          String(overrides.games ?? 8),
          String(overrides.receivingYards ?? 640),
          String(overrides.receptions ?? 48),
          String(overrides.targets ?? 70),
          String(overrides.tds ?? 4)
        ]
      }]
    }
  ]
})

function mockFetchRouter(routes) {
  return vi.fn(async (url) => {
    for (const [pattern, respond] of routes) {
      if (pattern.test(String(url))) return respond(String(url))
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

describe('fetchAthleteStats', () => {
  it('calls the configured proxy instead of ESPN directly', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).toBe('https://my-proxy.example/athletes/999/stats')
      return { ok: true, json: async () => ({ categories: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchAthleteStats('999', { proxyUrl: 'https://my-proxy.example' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when the proxy responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(fetchAthleteStats('1', { proxyUrl: 'https://my-proxy.example' }))
      .rejects.toThrow(/503/)
  })
})

describe('fetchGameRosters with a stats proxy', () => {
  const game = { id: 'g1', home: 'CIN', away: 'DET' }

  it('merges real per-player stats fetched through the proxy', async () => {
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })],
      [/\/athletes\/10\/stats/, async () => ({ ok: true, json: async () => athleteStatsJson(new Date().getFullYear(), { receivingYards: 900 }) })],
      [/\/athletes\/20\/stats/, async () => ({ ok: true, json: async () => athleteStatsJson(new Date().getFullYear(), { receivingYards: 500 }) })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game, { statsProxyUrl: 'https://my-proxy.example' })

    expect(result.hasSeasonStats).toBe(true)
    expect(result.usedPriorSeason).toBe(false)
    expect(result.statsNote).toBeNull()
    const cinStar = result.players.find((p) => p.name === 'Cin Star WR')
    expect(cinStar.stats.receivingYards).toBe(900)
  })

  it('falls back to last season for a player with nothing yet this year', async () => {
    const thisYear = new Date().getFullYear()
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })],
      // Only a prior-season row exists for either player.
      [/\/athletes\/(10|20)\/stats/, async () => ({ ok: true, json: async () => athleteStatsJson(thisYear - 1) })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game, { statsProxyUrl: 'https://my-proxy.example' })

    expect(result.usedPriorSeason).toBe(true)
    expect(result.players.every((p) => p.stats?.games)).toBe(true)
  })

  it('notes the CORS block when no proxy is configured', async () => {
    const fetchMock = mockFetchRouter([
      [/\/teams\/cin\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 10, name: 'Cin Star WR' }]) })],
      [/\/teams\/det\/roster/, async () => ({ ok: true, json: async () => rosterJson([{ id: 20, name: 'Det Star WR' }]) })],
      [/depthcharts/, async () => ({ ok: false, status: 404 })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchGameRosters(game, {})

    expect(result.hasSeasonStats).toBe(false)
    expect(result.statsNote).toMatch(/CORS/)
    // Never even attempted the per-athlete endpoint without a proxy.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/athletes/'))).toBe(false)
  })

  it('skips the proxy fetch for a roster that already has usable embedded stats', async () => {
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
      [/depthcharts/, async () => ({ ok: false, status: 404 })],
      [/\/athletes\/20\/stats/, async () => ({ ok: true, json: async () => athleteStatsJson(new Date().getFullYear()) })]
    ])
    vi.stubGlobal('fetch', fetchMock)

    await fetchGameRosters(game, { statsProxyUrl: 'https://my-proxy.example' })

    // CIN already had usable stats embedded, so athlete 10 should never be proxied.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/athletes/10/'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/athletes/20/'))).toBe(true)
  })
})
