/**
 * playerData.js — rosters and touchdown counts.
 *
 * The props model needs two things per player: what role they play and how
 * many touchdowns they have scored. ESPN's roster endpoint gives the first
 * reliably and the second only sometimes, depending on what it decides to
 * include.
 *
 * So this returns whatever it can and says what is missing. When touchdown
 * counts are absent the model falls back to positional priors on its own —
 * sampleWeight(0) is zero, so the observed share simply carries no weight.
 * Nothing is invented to fill the gap.
 */

const HOSTS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl',
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
]

const ABBR = { WSH: 'WAS', LAR: 'LA', JAX: 'JAC' }
const norm = (a) => ABBR[a] || a

/** Positions that can plausibly score. Everyone else is noise on this board. */
const SCORING_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE'])

/**
 * Roster statuses that mean a player cannot suit up this week at all —
 * confirmed live: ESPN's roster feed lists practice-squad and injured-
 * reserve players in the same groups as the active 53, distinguished only
 * by this field. A weekly game-day designation (Questionable, Doubtful,
 * Out) is a different, separate field and is deliberately left alone —
 * those players might still play, which is exactly what the injury badge
 * is for.
 */
const INACTIVE_ROSTER_STATUSES = new Set([
  'practice squad', 'injured reserve', 'reserve/injured', 'physically unable to perform',
  'reserve/pup', 'suspended', 'reserve/suspended', 'reserve/retired', 'reserve/did not report',
  'commissioner exempt', 'exempt list', 'reserve/covid-19'
])

export async function fetchRoster(teamAbbr, { signal, season } = {}) {
  const slug = teamAbbr === 'LA' ? 'lar' : teamAbbr === 'WAS' ? 'wsh' : teamAbbr === 'JAC' ? 'jax' : teamAbbr.toLowerCase()

  let json = null
  let lastError
  for (const host of HOSTS) {
    try {
      const query = season ? `?season=${season}&enable=stats` : '?enable=stats'
      const res = await fetch(`${host}/teams/${slug}/roster${query}`, { signal })
      if (!res.ok) throw new Error(`returned ${res.status}`)
      json = await res.json()
      break
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  if (!json) throw new Error(`Roster unavailable (${lastError?.message ?? 'unknown'})`)

  const players = []
  for (const group of json.athletes ?? []) {
    for (const a of group.items ?? []) {
      const position = a.position?.abbreviation
      if (!SCORING_POSITIONS.has(position)) continue
      // A player who isn't on the active roster can't play this week at
      // all — projecting him is worse than the "not dressed" case the
      // injury badge exists for, since he isn't even a game-day question.
      // ESPN's roster feed lists these players right alongside the active
      // 53, distinguished only by this status field.
      const rosterStatus = String(a.status?.name || '').toLowerCase()
      if (INACTIVE_ROSTER_STATUSES.has(rosterStatus)) continue
      players.push({
        id: String(a.id),
        name: a.displayName || a.fullName || '',
        shortName: a.shortName || a.displayName || '',
        team: norm(teamAbbr),
        position,
        jersey: a.jersey,
        // Injury status is the single biggest failure mode for these props:
        // an edge on a player who is not dressed is not an edge.
        injury: a.injuries?.[0]?.status || a.status?.name || null,
        stats: statsFrom(a),
        tds: statsFrom(a)?.tds ?? null
      })
    }
  }

  const withStats = players.filter((p) => p.stats?.games).length
  return {
    team: norm(teamAbbr),
    players,
    season: season ?? null,
    hasTouchdownData: players.some((p) => p.tds != null),
    hasSeasonStats: withStats > 0,
    note: withStats > 0
      ? null
      : 'No per-player season statistics in this feed, so yardage markets cannot be projected.'
  }
}

/**
 * Dig touchdowns out of whatever stat shape the feed returned.
 *
 * ESPN nests season statistics differently depending on the endpoint and the
 * time of year, so this looks in the places it is known to appear and gives
 * up quietly rather than guessing.
 */
function statsFrom(athlete) {
  const buckets = athlete?.statistics?.splits?.categories
    ?? athlete?.statistics?.categories
    ?? null
  if (!Array.isArray(buckets)) return null

  const found = {}
  for (const cat of buckets) {
    for (const stat of cat.stats ?? []) {
      const name = String(stat.name || stat.abbreviation || '')
      const v = Number(stat.value ?? stat.displayValue)
      if (Number.isFinite(v)) found[name] = v
    }
  }
  if (!Object.keys(found).length) return null

  const pick = (...names) => {
    for (const n of names) if (found[n] != null) return found[n]
    return null
  }

  const games = pick('gamesPlayed', 'GP')
  return {
    games,
    // Receiving and rushing touchdowns count toward anytime scoring;
    // passing touchdowns belong to the arm, not the scorer.
    tds: sumDefined(pick('rushingTouchdowns'), pick('receivingTouchdowns')),
    receivingYards: pick('receivingYards'),
    receptions: pick('receptions'),
    targets: pick('receivingTargets', 'targets'),
    rushingYards: pick('rushingYards'),
    rushingAttempts: pick('rushingAttempts'),
    passingYards: pick('passingYards'),
    passingTouchdowns: pick('passingTouchdowns'),
    passingAttempts: pick('passingAttempts')
  }
}

const sumDefined = (...xs) => {
  const vals = xs.filter((v) => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null
}

/**
 * Assign roles, and be honest when the depth chart is unknown.
 *
 * Two things went wrong in the first version, both visible on opening week:
 *
 *   1. Fullbacks were grouped separately from running backs and then
 *      relabelled, so a team could show two different "RB1"s — one the
 *      actual back, one a blocking fullback.
 *
 *   2. Before any games are played nobody has scored, so ranking by
 *      touchdowns ranks nothing. The order that survived was ESPN's roster
 *      order, which is not a depth chart, and a fourth-string back was
 *      confidently labelled RB1 and handed a starter's share.
 *
 * So: positions are folded to a base group first, and depth is only claimed
 * when there is something real to rank on. Without that, every player in a
 * group shares the group's expected touchdowns evenly. Less pointed, but
 * true — and the UI says so rather than implying a depth chart exists.
 */

/** Share of a team's touchdowns by position group, used when depth is unknown. */
export const GROUP_SHARE = { RB: 0.33, WR: 0.38, TE: 0.13, QB: 0.06 }

const baseOf = (position) => (position === 'FB' ? 'RB' : position)

export function assignRoles(players, depthRanks = null) {
  const byGroup = {}
  for (const p of players) (byGroup[baseOf(p.position)] ??= []).push(p)

  const out = []
  for (const [group, list] of Object.entries(byGroup)) {
    // A published depth chart beats inferring from touchdowns, and is the
    // only thing available before any games have been played.
    const charted = depthRanks && list.some((p) => depthRanks.has(String(p.id)))
    const signal = charted || list.some((p) => (p.tds ?? 0) > 0)

    if (!signal) {
      // No basis for a depth chart. Split the group's share evenly rather
      // than inventing an order, and mark it so the UI can be plain about it.
      const share = (GROUP_SHARE[group] ?? 0.05) / Math.max(1, list.length)
      for (const p of list) {
        out.push({ ...p, role: group, flatShare: share, depthKnown: false, depth: null })
      }
      continue
    }

    // Depth ranks are published per listed position, so the first fullback
    // and the first running back both come back as rank 1. Folding them into
    // one group without adjusting for that lets a blocking fullback outrank
    // the starting back and inherit his share.
    const rankOf = (p) => {
      const raw = depthRanks?.get(String(p.id)) ?? 99
      return p.position === 'FB' ? raw + 50 : raw
    }

    const ranked = charted
      ? [...list].sort((a, b) => rankOf(a) - rankOf(b) || (b.tds ?? 0) - (a.tds ?? 0))
      : [...list].sort((a, b) => (b.tds ?? 0) - (a.tds ?? 0))

    ranked.forEach((p, i) => {
      const role =
        group === 'QB' ? 'QB'
          : i === 0 ? `${group}1`
          : i === 1 ? `${group}2`
          : i === 2 && group === 'WR' ? 'WR3'
          : group
      out.push({ ...p, role, depthKnown: true, depth: i + 1, depthSource: charted ? 'chart' : 'scoring' })
    })
  }
  return out
}

/** Both rosters for a game, with roles assigned. */
export async function fetchGameRosters(game, { signal, season, statsProxyUrl } = {}) {
  // Depth charts are best-effort: a failure there degrades the ranking, it
  // does not break the page.
  let [home, away, homeDepth, awayDepth] = await Promise.all([
    fetchRoster(game.home, { signal }),
    fetchRoster(game.away, { signal }),
    fetchDepthChart(game.home, { signal }).catch(() => null),
    fetchDepthChart(game.away, { signal }).catch(() => null)
  ])

  // Whether anyone has a rate worth projecting from, not merely whether the
  // feed returned a statistics object. A roster full of zeros satisfied the
  // old check and still produced nothing.
  const usable = (roster) => roster.players.some((p) => (p.stats?.games ?? 0) >= 1)

  const statsSeason = season ?? new Date().getFullYear()
  let usedPriorSeason = false
  let statsNote = null

  if (statsProxyUrl) {
    // fetchAthleteStats() has real per-player data and a parser verified
    // against it, but is confirmed CORS-blocked when called directly from
    // the browser (live-tested: 88/88 requests rejected, "no Access-
    // Control-Allow-Origin header"). A configured proxy runs the same
    // request server-side, where that policy does not apply. Only a
    // roster that does not already carry usable stats pays for this — the
    // ESPN roster feed itself sometimes embeds season stats, and re-asking
    // per player when it already has would just be the same answer slower.
    const [homeFetched, awayFetched] = await Promise.all([
      usable(home) ? { players: home.players, merged: 0, priorSeason: false } : proxyStats(home.players, statsProxyUrl, statsSeason, signal),
      usable(away) ? { players: away.players, merged: 0, priorSeason: false } : proxyStats(away.players, statsProxyUrl, statsSeason, signal)
    ])
    home = { ...home, players: homeFetched.players }
    away = { ...away, players: awayFetched.players }
    usedPriorSeason = homeFetched.priorSeason || awayFetched.priorSeason

    if (!usable(home) && !usable(away)) {
      statsNote = `The stats proxy at ${statsProxyUrl} returned no usable data for either roster, ` +
        'so yardage markets use a positional average instead of real per-game rates.'
    }
  } else if (!usable(home) && !usable(away)) {
    // No proxy configured, so this goes straight to the positional-average
    // fallback in props.js rather than attempting the doomed direct fetch —
    // that cost every Props load ~80 requests' worth of latency for no
    // benefit the last time it was tried. See fetchAthleteStats() above.
    statsNote = "ESPN's per-athlete stats feed is unreachable from the browser (blocked by its CORS policy), " +
      'so yardage markets use a positional average instead of real per-game rates. ' +
      'Configure a stats proxy in Model Lab to use real rates instead (see worker/README.md).'
  }

  const players = [
    ...assignRoles(home.players, homeDepth),
    ...assignRoles(away.players, awayDepth)
  ]
  return {
    players,
    hasTouchdownData: home.hasTouchdownData && away.hasTouchdownData,
    depthKnown: players.some((p) => p.depthKnown),
    depthSource: players.find((p) => p.depthSource)?.depthSource ?? null,
    hasSeasonStats: players.some((p) => (p.stats?.games ?? 0) >= 1),
    statsSeason,
    usedPriorSeason,
    statsNote,
    notes: [home.note, away.note].filter(Boolean)
  }
}

/**
 * Fetch and merge real per-player season rates through a stats proxy.
 *
 * Tries the current season first, then last season for a player with
 * nothing yet this year (opening weeks, or a rookie's first snap) — real
 * data from a year ago is a better starting point than a league-wide
 * average, provided it is labelled honestly, which is what `priorSeason`
 * on the return value is for.
 *
 * A player who fails or comes back empty simply keeps no stats: props.js
 * already treats that as "fall back to the positional prior," so nothing
 * needs to be invented here.
 */
async function proxyStats(players, proxyUrl, season, signal) {
  const results = await Promise.allSettled(
    players.map((p) => fetchAthleteStats(p.id, { signal, proxyUrl }))
  )

  let merged = 0
  let priorSeason = false
  const withStats = results.map((r, i) => {
    if (r.status !== 'fulfilled') return players[i]
    const current = statsForSeason(r.value, season)
    const stats = current ?? statsForSeason(r.value, season - 1)
    if (!stats) return players[i]
    merged++
    if (!current) priorSeason = true
    return { ...players[i], stats, tds: stats.tds }
  })

  return { players: withStats, merged, priorSeason }
}

/* ------------------------------------------------------------------ */
/* Depth charts — so week one is not a guess.                          */
/* ------------------------------------------------------------------ */

/**
 * Fetch a team's published depth chart.
 *
 * Ranking players by touchdowns works from about week four onward, but on
 * opening weekend nobody has scored and the fallback was roster order, which
 * is not a depth chart. This is the real thing.
 *
 * The payload is undocumented and its shape varies, so several plausible
 * layouts are tried and anything unrecognised yields null rather than a
 * confident wrong answer.
 */
/**
 * Special-teams-only slots. These share the depth chart's athlete/rank
 * shape with offense, but a punt or kick returner's rank says nothing about
 * a receiver or back's offensive role — see the reasoning in readPositions
 * below, where this is used to exclude them.
 */
const SPECIAL_TEAMS_POSITIONS = new Set(['PR', 'KR', 'P', 'PK', 'LS', 'H'])

export async function fetchDepthChart(teamAbbr, { signal } = {}) {
  const slug = teamAbbr === 'LA' ? 'lar' : teamAbbr === 'WAS' ? 'wsh' : teamAbbr === 'JAC' ? 'jax' : teamAbbr.toLowerCase()

  let json = null
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/teams/${slug}/depthcharts`, { signal })
      if (!res.ok) throw new Error(String(res.status))
      json = await res.json()
      break
    } catch (err) {
      if (signal?.aborted) throw err
    }
  }
  if (!json) return null

  // athleteId -> rank within its position, lower is closer to starting.
  const ranks = new Map()

  const readPositions = (positions) => {
    if (!positions) return
    for (const [key, entry] of Object.entries(positions)) {
      // ESPN's depth chart lists special-teams slots (punt/kick returner,
      // holder, long snapper, placekicker) in the same shape as offense, and
      // an athlete keeps whichever ID he was listed under in both. A
      // journeyman receiver who is also the team's #1 punt returner would
      // otherwise inherit that rank-1 and outrank the actual starting
      // receivers — confirmed live: exactly this made a depth WR read as a
      // team's WR1. A returner's rank has nothing to do with offensive
      // depth, so those slots are skipped entirely.
      const posAbbr = String(entry?.position?.abbreviation ?? key ?? '').toUpperCase()
      if (SPECIAL_TEAMS_POSITIONS.has(posAbbr)) continue
      const athletes = entry?.athletes
      if (!Array.isArray(athletes)) continue
      athletes.forEach((a, i) => {
        const id = String(a?.athlete?.id ?? a?.id ?? idFromRef(a?.athlete?.$ref) ?? '')
        if (!id) return
        const rank = Number(a?.rank ?? i + 1)
        // A player can appear in more than one formation; keep the best.
        const existing = ranks.get(id)
        if (existing == null || rank < existing) ranks.set(id, rank)
      })
    }
  }

  for (const group of json.items ?? json.depthchart ?? []) {
    readPositions(group?.positions)
    for (const sub of group?.items ?? []) readPositions(sub?.positions)
  }

  return ranks.size ? ranks : null
}

const idFromRef = (ref) => {
  if (!ref) return null
  const m = String(ref).match(/athletes\/(\d+)/)
  return m ? m[1] : null
}

/* ------------------------------------------------------------------ */
/* Per-athlete season statistics                                       */
/* ------------------------------------------------------------------ */

/**
 * One athlete's full career stat history, broken out by season and
 * category (passing/rushing/receiving/scoring/...).
 *
 * This has real per-player data and a parser (statsForSeason, below)
 * verified against it — but is confirmed CORS-blocked when called
 * directly from a browser (live-tested: 88/88 requests rejected, no
 * Access-Control-Allow-Origin header). Visiting the URL directly works
 * fine; a fetch() from a different origin does not, and that is a static
 * server-side policy on ESPN's end, not a flaky per-request failure, so
 * it will not start working without either ESPN changing it or the
 * request running somewhere CORS does not apply.
 *
 * Passing `proxyUrl` (a deployed instance of worker/espn-proxy.js — see
 * worker/README.md) routes the request through there instead: the worker
 * makes the same call server-side and re-serves it with the header the
 * browser needs. Without one, this falls back to asking ESPN directly,
 * which is known to fail from the browser but is kept for completeness —
 * a Node script, a test, or a future environment without that restriction
 * can still use it. fetchGameRosters() only ever calls this when a proxy
 * is configured, precisely to avoid repeating the doomed direct attempt on
 * every Props load — that cost ~80 requests' worth of latency for no
 * benefit the last time it was tried.
 *
 * This replaces an even earlier approach that asked for the whole
 * league's stats in one request
 * (`.../statistics/byathlete?season=Y&category=passing`). ESPN rejects
 * that with a 400 — confirmed live: the category parameter no longer
 * accepts a category name at all, and the error it returns names an
 * internal path shaped like `.../statistics/{id}/byathlete`, implying
 * category is now expected to be a numeric id it doesn't document
 * anywhere. Dropping the parameter avoids the 400, but "succeeds" by
 * silently returning a tiny, unrelated 4-player leaderboard instead of
 * the league.
 */
export async function fetchAthleteStats(athleteId, { signal, proxyUrl } = {}) {
  if (proxyUrl) {
    const res = await fetch(`${proxyUrl.replace(/\/+$/, '')}/athletes/${athleteId}/stats`, { signal })
    if (!res.ok) throw new Error(`Stats proxy returned ${res.status}`)
    return res.json()
  }

  let json = null
  let lastError
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/athletes/${athleteId}/stats`, { signal })
      if (!res.ok) throw new Error(`returned ${res.status}`)
      json = await res.json()
      break
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  if (!json) throw new Error(`Athlete stats unavailable (${lastError?.message ?? 'unknown'})`)
  return json
}

/**
 * Pull one season's stats out of an athlete's full history, in the shape
 * the props model expects.
 *
 * Each category ('passing', 'rushing', ...) lists its field names once in
 * `names` and then one row per season played in `statistics`, with that
 * season's values as a parallel array of display strings ("1,374", "-").
 * A player who has never done something (a QB with no receptions) simply
 * has no `receiving` category at all, so every lookup here is optional —
 * a missing category or season yields null rather than a confident zero.
 */
export function statsForSeason(json, year) {
  const categories = json?.categories
  if (!Array.isArray(categories)) return null

  const pick = (categoryName, fieldName) => {
    const cat = categories.find((c) => c.name === categoryName)
    const row = cat?.statistics?.find((s) => s.season?.year === year)
    const idx = cat?.names?.indexOf(fieldName)
    if (row == null || idx == null || idx < 0) return null
    const raw = row.stats?.[idx]
    if (raw == null || raw === '-') return null
    const n = Number(String(raw).replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }

  const games = pick('passing', 'gamesPlayed') ?? pick('rushing', 'gamesPlayed')
    ?? pick('receiving', 'gamesPlayed') ?? pick('scoring', 'gamesPlayed')
  if (!games) return null

  // The scoring category already totals rushing/receiving touchdowns in
  // one place, so anytime-scoring TDs don't have to be summed across two
  // categories that might not even carry matching season rows.
  const rushTd = pick('scoring', 'rushingTouchdowns') ?? pick('rushing', 'rushingTouchdowns') ?? 0
  const recTd = pick('scoring', 'receivingTouchdowns') ?? pick('receiving', 'receivingTouchdowns') ?? 0

  return {
    games,
    tds: rushTd + recTd,
    receivingYards: pick('receiving', 'receivingYards'),
    receptions: pick('receiving', 'receptions'),
    targets: pick('receiving', 'receivingTargets'),
    rushingYards: pick('rushing', 'rushingYards'),
    rushingAttempts: pick('rushing', 'rushingAttempts'),
    passingYards: pick('passing', 'passingYards'),
    passingTouchdowns: pick('passing', 'passingTouchdowns'),
    passingAttempts: pick('passing', 'passingAttempts')
  }
}
