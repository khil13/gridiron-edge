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

/** Depth-chart role from position and ordering within it. */
export function assignRoles(players) {
  const byPosition = {}
  for (const p of players) (byPosition[p.position] ??= []).push(p)

  const out = []
  for (const [position, list] of Object.entries(byPosition)) {
    // Ranked by touchdowns where known, else left in roster order, which
    // ESPN roughly sorts by depth already.
    const ranked = list.every((p) => p.tds == null)
      ? list
      : [...list].sort((a, b) => (b.tds ?? 0) - (a.tds ?? 0))

    ranked.forEach((p, i) => {
      const base = position === 'FB' ? 'RB' : position
      const role =
        base === 'QB' ? 'QB'
          : i === 0 ? `${base}1`
          : i === 1 ? `${base}2`
          : i === 2 && base === 'WR' ? 'WR3'
          : base
      out.push({ ...p, role, depth: i + 1 })
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
  return {
    players: [...assignRoles(home.players), ...assignRoles(away.players)],
    hasTouchdownData: home.hasTouchdownData && away.hasTouchdownData,
    notes: [home.note, away.note].filter(Boolean)
  }
}
