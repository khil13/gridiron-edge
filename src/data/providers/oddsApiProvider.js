/**
 * The Odds API (the-odds-api.com). Free tier covers a few hundred requests
 * a month, which is plenty for a personal build. Set VITE_ODDS_API_KEY.
 *
 * Returns markets keyed the same way the simulator does, so nothing
 * downstream has to know where the prices came from.
 */

import { TEAM_LIST } from '../teams.js'

const BASE = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds'

const NAME_TO_ABBR = TEAM_LIST.reduce((acc, t) => {
  acc[t.full.toLowerCase()] = t.abbr
  acc[t.name.toLowerCase()] = t.abbr
  return acc
}, {})

const toAbbr = (name) => NAME_TO_ABBR[String(name || '').toLowerCase()] || null

export async function fetchMarkets({ apiKey, books, signal } = {}) {
  if (!apiKey) return null

  const params = new URLSearchParams({
    apiKey,
    regions: 'us',
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american'
  })
  if (books) params.set('bookmakers', books)

  const res = await fetch(`${BASE}?${params}`, { signal })
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'The Odds API rejected that key.'
        : `The Odds API returned ${res.status}.`
    )
  }
  const events = await res.json()
  const markets = {}

  for (const ev of events) {
    const home = toAbbr(ev.home_team)
    const away = toAbbr(ev.away_team)
    if (!home || !away) continue

    const books = (ev.bookmakers || []).map((bm) => {
      const find = (key) => bm.markets?.find((m) => m.key === key)
      const spreads = find('spreads')
      const totals = find('totals')
      const h2h = find('h2h')

      const sh = spreads?.outcomes?.find((o) => toAbbr(o.name) === home)
      const sa = spreads?.outcomes?.find((o) => toAbbr(o.name) === away)
      const ov = totals?.outcomes?.find((o) => o.name === 'Over')
      const un = totals?.outcomes?.find((o) => o.name === 'Under')
      const mh = h2h?.outcomes?.find((o) => toAbbr(o.name) === home)
      const ma = h2h?.outcomes?.find((o) => toAbbr(o.name) === away)

      return {
        key: bm.key,
        name: bm.title,
        sharp: bm.key === 'pinnacle' || bm.key === 'circasports',
        spread: {
          home: { line: sh?.point ?? 0, price: sh?.price ?? -110 },
          away: { line: sa?.point ?? 0, price: sa?.price ?? -110 }
        },
        total: { line: ov?.point ?? 44.5, over: ov?.price ?? -110, under: un?.price ?? -110 },
        moneyline: { home: mh?.price ?? -110, away: ma?.price ?? -110 }
      }
    }).filter((b) => b.spread.home.line !== undefined)

    if (!books.length) continue

    const consensusSpread = median(books.map((b) => b.spread.home.line))
    markets[ev.id] = {
      gameId: ev.id,
      matchup: { home, away },
      commenceTime: ev.commence_time,
      consensus: { spreadHome: consensusSpread, total: median(books.map((b) => b.total.line)) },
      open: { spreadHome: consensusSpread },
      movement: [],
      books,
      simulated: false
    }
  }

  return markets
}

const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
