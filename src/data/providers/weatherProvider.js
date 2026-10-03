/**
 * weatherProvider.js — real forecast data from Open-Meteo.
 *
 * Open-Meteo is free, keyless, and CORS-enabled, which matters here: this
 * app deploys as a static site with no backend, so any weather source has
 * to be callable straight from the browser. No API key means nothing to
 * leak in a client bundle either.
 *
 * Only ever called for outdoor/retractable-roof venues — see stadiums.js —
 * and only when a kickoff actually falls inside the forecast's real range,
 * never extrapolated past it.
 */

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'

/** Minimal WMO weather-code buckets — https://open-meteo.com/en/docs */
const WEATHER_CODES = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail'
}

export const describeWeatherCode = (code) => WEATHER_CODES[code] ?? null

/**
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lon
 * @param {string} opts.kickoff  ISO timestamp
 * @returns {Promise<object|null>} null when the kickoff falls outside the
 *          forecast's real coverage — not an error, just nothing honest to
 *          show (a game next month has no real forecast yet)
 */
export async function fetchGameWeather({ lat, lon, kickoff, signal } = {}) {
  if (lat == null || lon == null || !kickoff) return null

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,weather_code',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'UTC',
    forecast_days: '16',
    past_days: '1'
  })

  const res = await fetch(`${FORECAST_BASE}?${params}`, { signal })
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`)
  const json = await res.json()

  const times = json?.hourly?.time
  if (!Array.isArray(times) || !times.length) throw new Error('Open-Meteo returned no hourly data')

  const target = new Date(kickoff).getTime()
  let bestIdx = -1
  let bestDiffMs = Infinity
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - target)
    if (diff < bestDiffMs) { bestDiffMs = diff; bestIdx = i }
  })
  if (bestIdx < 0) return null

  // Hourly data exists for every hour inside the requested window, so a
  // real match is always within an hour of the target. A gap bigger than
  // that means the kickoff is outside what Open-Meteo actually forecast —
  // showing the nearest point anyway would be passing off today's weather
  // as a forecast for a game weeks away.
  if (bestDiffMs > 90 * 60 * 1000) return null

  const h = json.hourly
  return {
    tempF: numOrNull(h.temperature_2m?.[bestIdx]),
    windMph: numOrNull(h.wind_speed_10m?.[bestIdx]),
    precipProbability: numOrNull(h.precipitation_probability?.[bestIdx]),
    weatherCode: h.weather_code?.[bestIdx] ?? null,
    condition: describeWeatherCode(h.weather_code?.[bestIdx]),
    forecastFor: times[bestIdx],
    source: 'open-meteo'
  }
}

const numOrNull = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
