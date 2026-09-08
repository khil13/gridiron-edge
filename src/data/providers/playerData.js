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

export async function fetchRoster(teamAbbr, { signal } = {}) {
  const slug = teamAbbr === 'LA' ? 'lar' : teamAbbr === 'WAS' ? 'wsh' : teamAbbr === 'JAC' ? 'jax' : teamAbbr.toLowerCase()

  let json = null
  let lastError
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/teams/${slug}/roster?enable=stats`, { signal })
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
        tds: touchdownsFrom(a)
      })
    }
  }

  const withTds = players.filter((p) => p.tds != null).length
  return {
    team: norm(teamAbbr),
    players,
    hasTouchdownData: withTds > 0,
    note: withTds > 0
      ? null
      : 'No touchdown counts in this feed, so shares fall back to positional priors.'
  }
}

/**
 * Dig touchdowns out of whatever stat shape the feed returned.
 *
 * ESPN nests season statistics differently depending on the endpoint and the
 * time of year, so this looks in the places it is known to appear and gives
 * up quietly rather than guessing.
 */
function touchdownsFrom(athlete) {
  const buckets = athlete?.statistics?.splits?.categories
    ?? athlete?.statistics?.categories
    ?? null
  if (!Array.isArray(buckets)) return null

  let total = 0
  let found = false
  for (const cat of buckets) {
    for (const stat of cat.stats ?? []) {
      const name = String(stat.name || stat.abbreviation || '').toLowerCase()
      // Receiving and rushing touchdowns count; passing touchdowns belong to
      // the quarterback's arm, not his anytime-scorer chances.
      if (name === 'rushingtouchdowns' || name === 'receivingtouchdowns') {
        const v = Number(stat.value ?? stat.displayValue)
        if (Number.isFinite(v)) { total += v; found = true }
      }
    }
  }
  return found ? total : null
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

export function assignRoles(players) {
  const byGroup = {}
  for (const p of players) (byGroup[baseOf(p.position)] ??= []).push(p)

  const out = []
  for (const [group, list] of Object.entries(byGroup)) {
    // Something to rank on means at least one player in the group has scored.
    const signal = list.some((p) => (p.tds ?? 0) > 0)

    if (!signal) {
      // No basis for a depth chart. Split the group's share evenly rather
      // than inventing an order, and mark it so the UI can be plain about it.
      const share = (GROUP_SHARE[group] ?? 0.05) / Math.max(1, list.length)
      for (const p of list) {
        out.push({ ...p, role: group, flatShare: share, depthKnown: false, depth: null })
      }
      continue
    }

    const ranked = [...list].sort((a, b) => (b.tds ?? 0) - (a.tds ?? 0))
    ranked.forEach((p, i) => {
      const role =
        group === 'QB' ? 'QB'
          : i === 0 ? `${group}1`
          : i === 1 ? `${group}2`
          : i === 2 && group === 'WR' ? 'WR3'
          : group
      out.push({ ...p, role, depthKnown: true, depth: i + 1 })
    })
  }
  return out
}

/** Both rosters for a game, with roles assigned. */
export async function fetchGameRosters(game, { signal } = {}) {
  const [home, away] = await Promise.all([
    fetchRoster(game.home, { signal }),
    fetchRoster(game.away, { signal })
  ])
  const players = [...assignRoles(home.players), ...assignRoles(away.players)]
  return {
    players,
    hasTouchdownData: home.hasTouchdownData && away.hasTouchdownData,
    depthKnown: players.some((p) => p.depthKnown),
    notes: [home.note, away.note].filter(Boolean)
  }
}
