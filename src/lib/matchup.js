/**
 * matchup.js — what each defense gives up, by position, and who on the
 * other side gets to face it.
 *
 * Every number is a real per-game average from the bundled nflverse
 * snapshots (team-defense.json for what each defense allowed, by the
 * position of the player who produced it; team-efficiency.json for
 * red-zone trips), ranked against the rest of the league.
 *
 * How much these rankings are worth is measured, not assumed. Walk-forward
 * over 2025 and 2026, comparing each lead player's real result against this
 * app's projection: against the five defenses that had allowed the most
 * rushing yards to running backs, lead backs beat their projection by about
 * 6-10 yards more than against the five that had allowed the least, in both
 * seasons; tight end receiving yards showed a similar small effect. Every
 * other spot (quarterback passing, wide receivers, receptions) was near zero
 * and flipped direction between seasons. `mattered` marks the two that held
 * up — the rest are context, not a reason on their own.
 */

import TEAM_DEFENSE from '../data/generated/team-defense.json' with { type: 'json' }
import TEAM_EFFICIENCY from '../data/generated/team-efficiency.json' with { type: 'json' }

/** Every position-and-stat a defense is ranked on, and which of the offense's lead players it pairs with. */
export const SPOTS = [
  { key: 'QB.passingYards', position: 'QB', stat: 'passingYards', label: 'Pass yards', to: 'quarterbacks', role: 'QB' },
  { key: 'QB.rushingYards', position: 'QB', stat: 'rushingYards', label: 'Rush yards', to: 'quarterbacks', role: 'QB' },
  { key: 'RB.rushingYards', position: 'RB', stat: 'rushingYards', label: 'Rush yards', to: 'running backs', role: 'RB1', mattered: true },
  { key: 'RB.receivingYards', position: 'RB', stat: 'receivingYards', label: 'Receiving yards', to: 'running backs', role: 'RB1' },
  { key: 'RB.receptions', position: 'RB', stat: 'receptions', label: 'Receptions', to: 'running backs', role: 'RB1' },
  { key: 'WR.receivingYards', position: 'WR', stat: 'receivingYards', label: 'Receiving yards', to: 'wide receivers', role: 'WR1' },
  { key: 'WR.receptions', position: 'WR', stat: 'receptions', label: 'Receptions', to: 'wide receivers', role: 'WR1' },
  { key: 'TE.receivingYards', position: 'TE', stat: 'receivingYards', label: 'Receiving yards', to: 'tight ends', role: 'TE1', mattered: true },
  { key: 'TE.receptions', position: 'TE', stat: 'receptions', label: 'Receptions', to: 'tight ends', role: 'TE1' }
]

/**
 * This season's defense record, or last season's when a team has none yet
 * (opening week). The positional splits are only in snapshots generated
 * after they were added, so a season without them counts as having none.
 */
function defenseSeason(team, source = TEAM_DEFENSE) {
  const latest = source.latestSeason
  const current = source.seasons?.[latest]?.[team]
  if (current?.games > 0 && current.byPosition) return { data: current, season: latest, isPrior: false }
  const prior = source.seasons?.[latest - 1]?.[team]
  if (prior?.games > 0 && prior.byPosition) return { data: prior, season: latest - 1, isPrior: true }
  return null
}

const round1 = (n) => Math.round(n * 10) / 10

/**
 * Every spot for one defense with its per-game average and league rank
 * (1 = allows the most), softest first.
 *
 * @returns {{ season, isPrior, games, spots: Array<{...spot, perGame, rank}> } | null}
 */
export function defenseSpots(team, { source = TEAM_DEFENSE } = {}) {
  const found = defenseSeason(team, source)
  if (!found) return null
  const { data } = found
  const spots = SPOTS
    .map((spot) => {
      const total = data.byPosition?.[spot.position]?.[spot.stat]
      const rank = data.ranks?.[spot.key]
      if (total == null || rank == null) return null
      return { ...spot, perGame: round1(total / data.games), rank }
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || b.perGame - a.perGame)
  return { season: found.season, isPrior: found.isPrior, games: data.games, spots }
}

/** Red-zone trips allowed per game and its league rank (1 = allowed the most), from team-efficiency.json. */
function redZone(team, source) {
  const latest = source.latestSeason
  for (const season of [latest, latest - 1]) {
    const table = source.seasons?.[season]
    const value = table?.[team]?.redZoneTripsAllowedPerGame
    if (value == null) continue
    const all = Object.values(table).map((t) => t.redZoneTripsAllowedPerGame).filter((v) => v != null)
    return { perGame: value, rank: 1 + all.filter((v) => v > value).length, season }
  }
  return null
}

/**
 * The four whole-defense numbers under each table. Ranks run 1 = most:
 * for sacks that is good for the defense, for the rest it is bad.
 *
 * @returns {Array<{ key, label, perGame, rank, goodForOffenseWhen: 'high'|'low' }>}
 */
export function defenseExtras(team, { source = TEAM_DEFENSE, efficiency = TEAM_EFFICIENCY } = {}) {
  const found = defenseSeason(team, source)
  const out = []
  if (found) {
    const { data } = found
    const stat = (key, label, field, goodForOffenseWhen) => {
      if (data[field] == null || data.ranks?.[field] == null) return
      out.push({ key, label, perGame: round1(data[field] / data.games), rank: data.ranks[field], goodForOffenseWhen })
    }
    stat('sacks', 'Sacks a game', 'sacks', 'low')
    stat('bigPasses', 'Completions of 20+ allowed', 'bigPassesAllowed', 'high')
    stat('bigRuns', 'Runs of 10+ allowed', 'bigRunsAllowed', 'high')
  }
  const rz = redZone(team, efficiency)
  if (rz) out.push({ key: 'redZone', label: 'Red-zone trips allowed', perGame: rz.perGame, rank: rz.rank, goodForOffenseWhen: 'high' })
  return out
}

/**
 * Whether a rank favours the offense facing it. Thresholds are a third of
 * the league either way: 1-10 is a real "soft" or "tough" signal on the
 * season's numbers, 11-22 is the middle.
 */
export function rankTone(rank, goodForOffenseWhen = 'high') {
  if (rank == null) return null
  const high = rank <= 10
  const low = rank >= 23
  if (!high && !low) return null
  const favoursOffense = goodForOffenseWhen === 'high' ? high : low
  return favoursOffense ? 'pos' : 'neg'
}

/** A player's last few real values of one stat from player-recent.json, newest first. */
export function recentValues(recent, key, stat) {
  const games = recent?.players?.[key]
  if (!games?.length) return []
  return games.map((g) => ({ week: g.week, opp: g.opp, value: g[stat] ?? 0 }))
}
