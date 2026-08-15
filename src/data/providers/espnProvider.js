/**
 * ESPN's public scoreboard. No key, no docs, no guarantees — but it is what
 * every hobby project uses and it returns live scores and clock.
 *
 * Endpoint: site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
 */

/**
 * Two hosts serve the same scoreboard payload. site.api has been returning
 * permission errors for some callers since around August 2026, and the
 * community fix is the site.web.api host — so try that first and keep the
 * original as a fallback rather than betting the feature on either one.
 */
const ENDPOINTS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
]

// ESPN uses three abbreviations the rest of this app does not.
const ABBR = { WSH: 'WAS', LAR: 'LA', JAX: 'JAC' }
const norm = (a) => ABBR[a] || a

/** Try each host in turn; surface the last error only if all of them fail. */
async function fetchScoreboard(signal) {
  let lastError
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`returned ${res.status}`)
      return await res.json()
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  throw new Error(`ESPN scoreboard unreachable (${lastError?.message ?? 'unknown error'})`)
}

export async function fetchSlate({ signal } = {}) {
  const json = await fetchScoreboard(signal)

  const games = (json.events || []).map((event) => {
    const comp = event.competitions?.[0] || {}
    const home = comp.competitors?.find((c) => c.homeAway === 'home')
    const away = comp.competitors?.find((c) => c.homeAway === 'away')
    const state = event.status?.type?.state

    // ESPN's seasontype: 1 = preseason, 2 = regular, 3 = post.
    // Without this the preseason shrink never fires on live-loaded games
    // and every edge looks bigger than it is.
    const seasonType = json.season?.type ?? event.season?.type ?? 2

    return {
      id: event.id,
      week: json.week?.number ?? null,
      preseason: seasonType === 1,
      postseason: seasonType === 3,
      kickoff: event.date,
      home: norm(home?.team?.abbreviation),
      away: norm(away?.team?.abbreviation),
      homeScore: home?.score != null ? Number(home.score) : undefined,
      awayScore: away?.score != null ? Number(away.score) : undefined,
      status: state === 'in' ? 'live' : state === 'post' ? 'final' : 'scheduled',
      period: event.status?.period,
      clock: event.status?.displayClock,
      statusDetail: event.status?.type?.shortDetail,
      venue: comp.venue?.fullName,
      neutral: !!comp.neutralSite,
      broadcast: comp.broadcasts?.[0]?.names?.[0]
    }
  })

  const typeName = { 1: 'preseason', 2: 'regular season', 3: 'postseason' }[
    json.season?.type ?? 2
  ] || ''

  return {
    source: 'espn',
    label: `Live · ESPN ${json.season?.year ?? ''} ${typeName} week ${json.week?.number ?? '—'}`
      .replace(/\s+/g, ' ')
      .trim(),
    games: games.filter((g) => g.home && g.away),
    history: []
  }
}
