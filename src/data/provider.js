/**
 * Picks a data source from the environment and always returns something
 * renderable. Live sources are best-effort: if ESPN or The Odds API is
 * unreachable, the app falls back to the bundled dataset and says so.
 */

import * as mock from './providers/mockProvider.js'
import * as espn from './providers/espnProvider.js'
import * as oddsApi from './providers/oddsApiProvider.js'

const env = import.meta.env || {}
// Live by default: ESPN's scoreboard needs no key, and every failure path
// below already falls back to the bundled slate with a visible warning.
// Set VITE_DATA_SOURCE=mock to force the bundled data.
const wantsLive = (env.VITE_DATA_SOURCE || 'live') !== 'mock'
const espnEnabled = (env.VITE_ENABLE_ESPN || 'true') !== 'false'
const oddsKey = env.VITE_ODDS_API_KEY || ''
const oddsBooks = env.VITE_ODDS_BOOKS || ''

export const dataMode = {
  live: wantsLive,
  espn: wantsLive && espnEnabled,
  odds: Boolean(oddsKey)
}

/** How often to re-poll live scores. Games change roughly every play. */
export const REFRESH_MS = 45000

export async function loadSlate({ signal } = {}) {
  const warnings = []

  let slate
  if (dataMode.espn) {
    try {
      slate = await espn.fetchSlate({ signal })
      if (!slate.games.length) {
        warnings.push('ESPN returned no games for this week. Showing the bundled slate.')
        slate = await mock.fetchSlate()
      }
    } catch (err) {
      warnings.push(`Live scores unavailable (${err.message}). Showing the bundled slate.`)
      slate = await mock.fetchSlate()
    }
  } else {
    slate = await mock.fetchSlate()
  }

  let markets = null
  if (dataMode.odds) {
    try {
      markets = await oddsApi.fetchMarkets({ apiKey: oddsKey, books: oddsBooks, signal })
    } catch (err) {
      warnings.push(`${err.message} Falling back to simulated prices.`)
    }
  }

  return { ...slate, markets, warnings }
}
