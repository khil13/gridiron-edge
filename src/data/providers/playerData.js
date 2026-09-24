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

import { normPropName } from '../../lib/props.js'
import PLAYER_STATS_META from '../generated/player-stats-meta.json'

// Loaded lazily and cached: the snapshot is a few hundred KB and only ever
// needed once a game's rosters are actually being fetched, not on every
// page load (scores, standings, etc. never touch it).
let playerStatsPromise = null
const loadPlayerStats = () =>
  (playerStatsPromise ??= import('../generated/player-stats.json').then((m) => m.default))

// Next Gen Stats — separation, YAC over expectation, rush yards over
// expected. A genuinely separate nflverse release on its own publishing
// schedule, so it is its own small file with its own real season number
// rather than being forced into the season key the totals above landed on.
let playerNgsPromise = null
const loadPlayerNgs = () =>
  (playerNgsPromise ??= import('../generated/player-ngs.json').then((m) => m.default))

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
    //
    // QB is excluded from the touchdown fallback specifically: a starting
    // job there is a discrete coaching decision, not a share of touches, so
    // a benched former starter's cumulative touchdowns from before the
    // benching would still outrank a brand-new starter with only a start or
    // two — confidently naming the wrong QB rather than admitting the role
    // is unknown. Every other group's scoring is still a reasonable stand-in
    // for a missing chart.
    const charted = depthRanks && list.some((p) => depthRanks.has(String(p.id)))
    const signal = charted || (group !== 'QB' && list.some((p) => (p.tds ?? 0) > 0))

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
      // Every rostered QB used to get the same 'QB' role regardless of
      // depth, so isMainPlayer() (card.js) treated a third-string arm as
      // just as "main" as the actual starter — any backup with a real
      // recorded stat line from an earlier start was just as eligible for a
      // priced pick as whoever is starting now. Only the top of the ranking
      // is the starter here; everyone behind him gets a backup role that
      // isMainPlayer() correctly excludes.
      const role =
        group === 'QB' ? (i === 0 ? 'QB' : 'QB2')
          : i === 0 ? `${group}1`
          : i === 1 ? `${group}2`
          : i === 2 && group === 'WR' ? 'WR3'
          : group
      out.push({ ...p, role, depthKnown: true, depth: i + 1, depthSource: charted ? 'chart' : 'scoring' })
    })
  }
  return out
}

/**
 * A player's real season rate from the bundled nflverse snapshot (see
 * scripts/fetch-player-stats.mjs), keyed by name and position since two
 * different players occasionally share a name.
 *
 * Tries the requested season first, then the one before it for a player
 * with nothing yet this year (opening weeks, or a rookie's first snap) —
 * real data from a year ago is a better starting point than a league-wide
 * average, provided it is labelled honestly, which is what the returned
 * `priorSeason` flag is for.
 */
async function staticStats(name, position, season) {
  const playerStats = await loadPlayerStats()
  const key = `${normPropName(name)}|${position === 'FB' ? 'RB' : position}`
  // A player can appear in the current season's file with zero games (on a
  // bye, inactive, or simply not yet played this early in the season) —
  // that row exists but carries no real rate, and would otherwise shadow a
  // perfectly good prior-season number with an empty one.
  const current = playerStats.seasons?.[season]?.[key]
  if (current?.games > 0) return { stats: current, priorSeason: false }
  const prior = playerStats.seasons?.[season - 1]?.[key]
  return prior?.games > 0 ? { stats: prior, priorSeason: true } : null
}

/**
 * A player's Next Gen Stats — separation, YAC over expectation, rush yards
 * over expected — from the bundled nflverse snapshot.
 *
 * Deliberately independent of staticStats()'s own season and prior-season
 * fallback: NGS is published on its own schedule and has already been
 * confirmed to lag behind the season totals by more than one year at
 * times, so there is exactly one season bundled (whichever nflverse has
 * actually published), and its own real year travels with it rather than
 * inheriting whatever season word the totals happen to be using.
 */
async function staticNgs(name, position) {
  const playerNgs = await loadPlayerNgs()
  const key = `${normPropName(name)}|${position === 'FB' ? 'RB' : position}`
  return playerNgs.players?.[key] ?? null
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

  // The wall-clock year is the wrong default here: nflverse's release lags
  // real time by however long its own pipeline takes, and the app's build
  // can be older than the browser loading it. Anchoring to the newest
  // season the bundled snapshot actually has keeps this correct regardless
  // of any clock skew — confirmed live: with the clock year instead, every
  // player on every roster missed the snapshot outright (bug, not a real
  // name-matching gap), since neither the current nor the prior wall-clock
  // year existed as a key at all.
  const statsSeason = season ?? PLAYER_STATS_META.latestSeason ?? new Date().getFullYear()
  let usedPriorSeason = false
  let statsNote = null

  // The ESPN roster feed itself sometimes embeds season stats already; the
  // bundled snapshot only needs to fill in players who don't have any.
  // Next Gen Stats is attached regardless — it is not part of what makes a
  // roster "usable" (ESPN's feed never carries it), so it would otherwise
  // never reach a player whose season totals came from ESPN's own feed.
  const withStatic = async (roster) => {
    const skipTotals = usable(roster)
    let priorSeason = false
    const players = await Promise.all(roster.players.map(async (p) => {
      const ngs = await staticNgs(p.name, p.position)
      const withNgs = ngs ? { ...p, ngs } : p
      if (skipTotals) return withNgs
      const found = await staticStats(p.name, p.position, statsSeason)
      if (!found) return withNgs
      if (found.priorSeason) priorSeason = true
      return { ...withNgs, stats: found.stats, tds: found.stats.tds, statsPriorSeason: found.priorSeason }
    }))
    if (priorSeason) usedPriorSeason = true
    return { ...roster, players }
  }
  ;[home, away] = await Promise.all([withStatic(home), withStatic(away)])

  if (!usable(home) && !usable(away)) {
    statsNote = "No player in either roster matched this season's bundled stats snapshot, " +
      'so yardage markets use a positional average instead of real per-game rates.'
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
