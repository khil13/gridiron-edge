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

/* ------------------------------------------------------------------ */
/* Per-game detail: box score, quarters, and the live situation.        */
/* ------------------------------------------------------------------ */

const SUMMARY_PATHS = ENDPOINTS.map((e) => e.replace('/scoreboard', '/summary'))

/**
 * Fetch one game's box score.
 *
 * This is an undocumented endpoint whose shape changes without notice, so
 * everything below is read defensively: any field that is missing yields
 * null and the UI simply omits that block rather than throwing.
 */
export async function fetchGameSummary(eventId, { signal } = {}) {
  if (!eventId) return null

  let json = null
  let lastError
  for (const base of SUMMARY_PATHS) {
    try {
      const res = await fetch(`${base}?event=${encodeURIComponent(eventId)}`, { signal })
      if (!res.ok) throw new Error(`returned ${res.status}`)
      json = await res.json()
      break
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  if (!json) throw new Error(`Game detail unavailable (${lastError?.message ?? 'unknown'})`)

  return {
    teamStats: parseTeamStats(json),
    linescores: parseLinescores(json),
    situation: parseSituation(json),
    lastPlay: json?.situation?.lastPlay?.text ?? null,
    leaders: parseLeaders(json)
  }
}

/** boxscore.teams[] -> one row per stat, aligned away/home. */
function parseTeamStats(json) {
  const teams = json?.boxscore?.teams
  if (!Array.isArray(teams) || teams.length < 2) return null

  const side = (t) => norm(t?.team?.abbreviation)
  const statsOf = (t) => {
    const map = {}
    for (const s of t?.statistics ?? []) {
      if (!s?.name) continue
      map[s.name] = { value: s.displayValue ?? s.value, label: s.label || s.name }
    }
    return map
  }

  const a = statsOf(teams[0])
  const b = statsOf(teams[1])
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  if (!names.length) return null

  return {
    teams: [side(teams[0]), side(teams[1])],
    rows: names.map((name) => ({
      name,
      label: a[name]?.label || b[name]?.label || name,
      values: [a[name]?.value ?? '—', b[name]?.value ?? '—']
    }))
  }
}

/** Points by quarter, if the feed carries them. */
function parseLinescores(json) {
  const comp = json?.header?.competitions?.[0]
  const competitors = comp?.competitors
  if (!Array.isArray(competitors) || competitors.length < 2) return null

  const row = (c) => ({
    abbr: norm(c?.team?.abbreviation),
    homeAway: c?.homeAway,
    total: c?.score != null ? Number(c.score) : null,
    periods: (c?.linescores ?? []).map((l) =>
      l?.displayValue != null ? Number(l.displayValue) : Number(l?.value ?? 0)
    )
  })

  const rows = competitors.map(row)
  if (!rows.some((r) => r.periods.length)) return null
  // Away first, to match how the rest of the app lists a matchup.
  return rows.sort((x, y) => (x.homeAway === 'away' ? -1 : 1))
}

/** Down, distance and possession for a game in progress. */
function parseSituation(json) {
  const s = json?.situation
  const comp = json?.header?.competitions?.[0]
  if (!s && !comp?.situation) return null
  const src = s || comp.situation

  const possessionId = src?.possession ?? src?.possessionText
  const possessing = comp?.competitors?.find(
    (c) => String(c?.id) === String(possessionId) || String(c?.team?.id) === String(possessionId)
  )

  return {
    downDistance: src?.shortDownDistanceText || src?.downDistanceText || null,
    fieldPosition: src?.possessionText || null,
    possession: possessing ? norm(possessing.team?.abbreviation) : null,
    isRedZone: !!src?.isRedZone
  }
}

/** Top performer per category, when the feed provides them. */
function parseLeaders(json) {
  const groups = json?.leaders
  if (!Array.isArray(groups)) return null
  const out = []
  for (const teamGroup of groups) {
    const abbr = norm(teamGroup?.team?.abbreviation)
    for (const cat of teamGroup?.leaders ?? []) {
      const top = cat?.leaders?.[0]
      if (!top) continue
      out.push({
        team: abbr,
        category: cat.displayName || cat.name,
        athlete: top.athlete?.shortName || top.athlete?.displayName || '',
        line: top.displayValue || ''
      })
    }
  }
  return out.length ? out : null
}
