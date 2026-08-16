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
// A build-time key is supported but discouraged: this deploys as a static
// site, so anything baked in is readable by every visitor. The runtime key
// from app settings takes precedence.
const buildOddsKey = env.VITE_ODDS_API_KEY || ''
const oddsBooks = env.VITE_ODDS_BOOKS || ''

export const dataMode = {
  live: wantsLive,
  espn: wantsLive && espnEnabled
}

/** How often to re-poll live scores. Games change roughly every play. */
export const REFRESH_MS = 45000

export async function loadSlate({ signal, oddsKey: runtimeKey } = {}) {
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

  const oddsKey = runtimeKey || buildOddsKey
  let markets = null
  let oddsMeta = null

  if (oddsKey) {
    try {
      const result = await oddsApi.fetchMarkets({
        apiKey: oddsKey,
        books: oddsBooks,
        games: slate.games,
        signal
      })
      if (result && Object.keys(result.markets).length) {
        markets = result.markets
        oddsMeta = {
          quota: result.quota,
          matched: result.matched,
          unmatched: result.unmatched
        }
        if (result.unmatched) {
          warnings.push(
            `Live prices loaded for ${result.matched} games; ${result.unmatched} could not be matched to the slate and use simulated prices.`
          )
        }
      } else {
        warnings.push('The Odds API returned no games for this slate. Using simulated prices.')
      }
    } catch (err) {
      warnings.push(`${err.message} Using simulated prices.`)
    }
  }

  return { ...slate, markets, oddsMeta, warnings }
}
