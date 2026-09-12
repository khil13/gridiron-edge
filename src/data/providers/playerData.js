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
export async function fetchGameRosters(game, { signal, season } = {}) {
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

  let statsSeason = season ?? new Date().getFullYear()
  let usedPriorSeason = false
  let statsNote = null

  if (!usable(home) && !usable(away)) {
    // Try this season league-wide first, then last season. The roster
    // endpoint ignores a season parameter; this one does not.
    const attempts = []
    for (const candidate of [statsSeason, statsSeason - 1]) {
      const result = await fetchSeasonStatIndex(candidate, { signal }).catch((err) => ({
        index: new Map(), ok: false, season: candidate, failed: [err.message], rowsSeen: 0
      }))
      attempts.push(result)
      if (!result.ok) continue

      const applied = applyIndex([home, away], result.index)
      if (applied > 0) {
        statsSeason = candidate
        usedPriorSeason = candidate !== (season ?? new Date().getFullYear())
        statsNote = `${applied} players matched from ${candidate} season statistics.`
        break
      }
    }
    if (!statsNote) {
      // Three genuinely different failures were collapsing into one silent
      // "no data" message: the feed being unreachable, answering with
      // nothing, or answering with plenty of rows that just never matched
      // a rostered player's ID. Telling those apart is the difference
      // between "ESPN is down" and "our two feeds use different IDs".
      const reached = attempts.some((a) => a.ok)
      const rowsSeen = attempts.reduce((s, a) => s + (a.rowsSeen ?? 0), 0)
      if (!reached) {
        const reasons = [...new Set(attempts.flatMap((a) => a.failed ?? []))]
        statsNote = reasons.length
          ? `ESPN's season-stats feed errored (${reasons.slice(0, 2).join('; ')}), so yardage markets are unavailable.`
          : "ESPN's season-stats feed returned no rows for this season or last, so yardage markets are unavailable."
      } else {
        statsNote = `ESPN's season-stats feed returned ${rowsSeen} player-rows league-wide, but none matched either roster by ID, so yardage markets are unavailable.`
      }
    }
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
    for (const entry of Object.values(positions)) {
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
/* League-wide season statistics                                       */
/* ------------------------------------------------------------------ */

/**
 * Season statistics for every player, in one request.
 *
 * The roster endpoint quietly ignores a season parameter, so asking it for
 * last year returns this year — which is why yardage markets stayed empty on
 * opening weekend even after a "fall back to last season" fix. This endpoint
 * actually honours the season, and returns the whole league at once rather
 * than one athlete at a time.
 *
 * The response shape is undocumented and varies by category, so parsing is
 * defensive throughout and an unrecognised payload yields an empty index
 * rather than a confidently wrong one.
 */
const BYATHLETE = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete'

/** Categories worth pulling. Each is a separate request. */
const STAT_CATEGORIES = ['passing', 'rushing', 'receiving']

/**
 * @returns {{index: Map, ok: boolean, season: number, failed: string[], rowsSeen: number}}
 *   `failed` names any category whose request itself errored, so a caller
 *   can tell "the feed is unreachable" apart from "it answered but had
 *   nothing in it" apart from "it had rows, they just didn't match anyone" —
 *   three very different problems that used to collapse into one silent
 *   empty index.
 */
export async function fetchSeasonStatIndex(season, { signal, seasontype = 2 } = {}) {
  const index = new Map()
  const failed = []
  let rowsSeen = 0

  const results = await Promise.allSettled(
    STAT_CATEGORIES.map(async (category) => {
      const url = `${BYATHLETE}?season=${season}&seasontype=${seasontype}&category=${category}&limit=300`
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(String(res.status))
      return { category, json: await res.json() }
    })
  )

  for (const [i, result] of results.entries()) {
    if (result.status !== 'fulfilled') {
      failed.push(`${STAT_CATEGORIES[i]}: ${result.reason?.message ?? 'failed'}`)
      continue
    }
    rowsSeen += absorb(index, result.value.json)
  }

  return { index, ok: failed.length < STAT_CATEGORIES.length && index.size > 0, season, failed, rowsSeen }
}

/** Merge one category payload into the athlete index. Returns rows seen. */
function absorb(index, json) {
  const rows = json?.athletes ?? json?.items ?? []
  if (!Array.isArray(rows)) return 0

  for (const row of rows) {
    const athlete = row?.athlete ?? row
    const id = String(athlete?.id ?? '')
    if (!id) continue

    const entry = index.get(id) ?? { id, name: athlete?.displayName ?? '', stats: {} }

    // Stats arrive either as labelled categories or as parallel
    // names/values arrays, depending on the category.
    for (const cat of row?.categories ?? []) {
      const names = cat?.names ?? cat?.labels ?? []
      const values = cat?.values ?? cat?.displayValues ?? []
      names.forEach((name, i) => {
        const v = Number(values[i])
        if (Number.isFinite(v)) entry.stats[name] = v
      })
      for (const s of cat?.stats ?? []) {
        const v = Number(s?.value ?? s?.displayValue)
        if (s?.name && Number.isFinite(v)) entry.stats[s.name] = v
      }
    }
    for (const s of row?.stats ?? []) {
      const v = Number(s?.value ?? s?.displayValue ?? s)
      const name = s?.name ?? s?.abbreviation
      if (name && Number.isFinite(v)) entry.stats[name] = v
    }

    index.set(id, entry)
  }
  return rows.length
}

/** Map an index entry onto the shape the props model expects. */
export function statsFromIndex(entry) {
  if (!entry) return null
  const s = entry.stats
  const pick = (...names) => {
    for (const n of names) {
      if (s[n] != null) return s[n]
      // Feeds mix camelCase and abbreviations.
      const lower = Object.keys(s).find((k) => k.toLowerCase() === n.toLowerCase())
      if (lower) return s[lower]
    }
    return null
  }

  const games = pick('gamesPlayed', 'GP')
  if (!games) return null

  const rushTd = pick('rushingTouchdowns', 'rushTD') ?? 0
  const recTd = pick('receivingTouchdowns', 'recTD') ?? 0

  return {
    games,
    tds: rushTd + recTd,
    receivingYards: pick('receivingYards', 'recYds'),
    receptions: pick('receptions', 'rec'),
    targets: pick('receivingTargets', 'targets'),
    rushingYards: pick('rushingYards', 'rushYds'),
    rushingAttempts: pick('rushingAttempts', 'rushAtt', 'carries'),
    passingYards: pick('passingYards', 'passYds'),
    passingTouchdowns: pick('passingTouchdowns', 'passTD'),
    passingAttempts: pick('passingAttempts', 'passAtt')
  }
}

/** Attach league-wide stats onto rostered players. Returns how many matched. */
function applyIndex(rosters, index) {
  let applied = 0
  for (const roster of rosters) {
    for (const player of roster.players) {
      const entry = index.get(String(player.id))
      const stats = statsFromIndex(entry)
      if (!stats) continue
      player.stats = stats
      player.tds = stats.tds ?? player.tds
      applied++
    }
  }
  return applied
}
