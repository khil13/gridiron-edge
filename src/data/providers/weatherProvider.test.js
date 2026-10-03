import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchGameWeather, describeWeatherCode } from './weatherProvider.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

const hourlyResponse = (times, overrides = {}) => ({
  ok: true,
  json: async () => ({
    hourly: {
      time: times,
      temperature_2m: times.map((_, i) => 45 + i),
      wind_speed_10m: times.map((_, i) => 8 + i),
      precipitation_probability: times.map((_, i) => 10 * i),
      weather_code: times.map(() => 61),
      ...overrides
    }
  })
})

describe('fetchGameWeather', () => {
  it('returns the forecast for the hour nearest kickoff', async () => {
    const times = ['2026-09-14T17:00:00Z', '2026-09-14T18:00:00Z', '2026-09-14T19:00:00Z']
    vi.stubGlobal('fetch', vi.fn(async () => hourlyResponse(times)))

    const result = await fetchGameWeather({ lat: 39.1, lon: -84.5, kickoff: '2026-09-14T18:05:00Z' })

    expect(result.forecastFor).toBe('2026-09-14T18:00:00Z')
    expect(result.tempF).toBe(46)
    expect(result.windMph).toBe(9)
    expect(result.precipProbability).toBe(10)
    expect(result.condition).toBe('Light rain') // weather_code 61
    expect(result.source).toBe('open-meteo')
  })

  it('returns null when the kickoff falls outside the forecast\'s real coverage', async () => {
    const times = ['2026-09-14T17:00:00Z', '2026-09-14T18:00:00Z']
    vi.stubGlobal('fetch', vi.fn(async () => hourlyResponse(times)))

    // Three weeks away — nowhere near the returned hourly window.
    const result = await fetchGameWeather({ lat: 39.1, lon: -84.5, kickoff: '2026-10-05T18:00:00Z' })
    expect(result).toBeNull()
  })

  it('returns null without fetching when coordinates or kickoff are missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchGameWeather({ lat: null, lon: -84.5, kickoff: '2026-09-14T18:00:00Z' })).toBeNull()
    expect(await fetchGameWeather({})).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a real error when the API responds with a bad status, rather than returning fake data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(
      fetchGameWeather({ lat: 39.1, lon: -84.5, kickoff: '2026-09-14T18:00:00Z' })
    ).rejects.toThrow('503')
  })
})

describe('describeWeatherCode', () => {
  it('maps known WMO codes to plain-language conditions', () => {
    expect(describeWeatherCode(0)).toBe('Clear')
    expect(describeWeatherCode(95)).toBe('Thunderstorm')
  })

  it('returns null for an unrecognised code rather than guessing', () => {
    expect(describeWeatherCode(999)).toBeNull()
  })
})
