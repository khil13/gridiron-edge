/**
 * The Odds API (the-odds-api.com).
 *
 * Returns markets in the same shape as the simulator, so nothing downstream
 * has to know where the prices came from.
 *
 * The key is supplied at runtime from app settings rather than baked in at
 * build time. That matters for two reasons: this app deploys as a static
 * site, so any build-time key would be readable by every visitor; and it
 * means changing keys does not require a rebuild.
 */

import { TEAM_LIST } from '../teams.js'

const BASE = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds'

const NAME_TO_ABBR = TEAM_LIST.reduce((acc, t) => {
  acc[t.full.toLowerCase()] = t.abbr
  acc[t.name.toLowerCase()] = t.abbr
  acc[`${t.location} ${t.name}`.toLowerCase()] = t.abbr
  return acc
}, {})

const toAbbr = (name) => NAME_TO_ABBR[String(name || '').toLowerCase()] || null

/** Books that post reduced juice. Flagged so the UI can mark them. */
const SHARP = new Set(['pinnacle', 'circasports', 'lowvig', 'betonlineag'])

/**
 * @param {object}   opts
 * @param {string}   opts.apiKey
 * @param {string}   [opts.books]  comma-separated bookmaker keys
 * @param {Array}    opts.games    our slate, used to match events to game ids
 * @returns {{ markets: object, quota: object, matched: number, unmatched: number }}
 */
export async function fetchMarkets({ apiKey, books, games = [], signal } = {}) {
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
    const body = await res.text().catch(() => '')
    throw new Error(
      res.status === 401
        ? 'The Odds API rejected that key.'
        : res.status === 429
          ? 'The Odds API quota is used up for this period.'
          : `The Odds API returned ${res.status}. ${body.slice(0, 120)}`
    )
  }

  // The API reports remaining quota in headers; surfacing it stops the free
  // tier running out invisibly.
  const quota = {
    remaining: numeric(res.headers.get('x-requests-remaining')),
    used: numeric(res.headers.get('x-requests-used'))
  }

  const events = await res.json()
  const markets = {}
  let matched = 0
  let unmatched = 0

  for (const ev of events) {
    const home = toAbbr(ev.home_team)
    const away = toAbbr(ev.away_team)
    if (!home || !away) { unmatched++; continue }

    // Match to OUR game id. The Odds API has its own ids that will never
    // line up with ESPN's, so pair on the two teams plus a kickoff within a
    // day — enough to be unambiguous without demanding the clocks agree.
    const game = matchGame(games, home, away, ev.commence_time)
    if (!game) { unmatched++; continue }
    matched++

    const parsedBooks = (ev.bookmakers || []).map((bm) => {
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

      // A book without a spread is not usable for the parts of the app that
      // matter, so drop it rather than substituting a fake number.
      if (sh?.point == null || sa?.point == null) return null

      return {
        key: bm.key,
        name: bm.title,
        sharp: SHARP.has(bm.key),
        spread: {
          home: { line: sh.point, price: sh.price ?? -110 },
          away: { line: sa.point, price: sa.price ?? -110 }
        },
        total: ov?.point != null
          ? { line: ov.point, over: ov.price ?? -110, under: un?.price ?? -110 }
          : null,
        moneyline: { home: mh?.price ?? null, away: ma?.price ?? null }
      }
    }).filter(Boolean)

    if (!parsedBooks.length) { unmatched++; continue }

    // Drop books missing a total so downstream code never sees a null line.
    const withTotals = parsedBooks.filter((b) => b.total)
    const usable = withTotals.length ? withTotals : parsedBooks.map((b) => ({
      ...b,
      total: { line: median(parsedBooks.map((x) => x.total?.line).filter((n) => n != null)) || 44.5, over: -110, under: -110 }
    }))

    const consensusSpread = median(usable.map((b) => b.spread.home.line))
    markets[game.id] = {
      gameId: game.id,
      commenceTime: ev.commence_time,
      consensus: {
        spreadHome: consensusSpread,
        total: median(usable.map((b) => b.total.line))
      },
      open: { spreadHome: consensusSpread },
      movement: [],
      books: usable,
      simulated: false
    }
  }

  return { markets, quota, matched, unmatched }
}

/** Same two teams, kickoff within 36 hours. */
function matchGame(games, home, away, commenceTime) {
  const t = commenceTime ? new Date(commenceTime).getTime() : null
  const candidates = games.filter((g) => g.home === home && g.away === away)
  if (!candidates.length) return null
  if (candidates.length === 1 || t == null) return candidates[0]
  return candidates
    .map((g) => ({ g, gap: Math.abs(new Date(g.kickoff).getTime() - t) }))
    .filter((c) => c.gap < 36 * 3600 * 1000)
    .sort((a, b) => a.gap - b.gap)[0]?.g ?? null
}

const numeric = (v) => (v == null || v === '' ? null : Number(v))

const median = (xs) => {
  const s = xs.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
