/**
 * teamDefense.js — real, bundled opponent-defense context, shared by
 * reasons.js (the Card's "why" bullets) and props.js (matchup-adjusted
 * volume projections).
 *
 * Both read the same nflverse snapshot (team-defense.json) through the
 * same season-selection rule, so a projection and the sentence explaining
 * it are always talking about the same real games.
 */

import TEAM_DEFENSE from '../data/generated/team-defense.json'

/** A team's allowed-production stats for this game, preferring this season, falling back one year. */
export function defenseStatsFor(team) {
  const current = TEAM_DEFENSE.seasons?.[TEAM_DEFENSE.latestSeason]?.[team]
  if (current?.games > 0) return { data: current, isPrior: false, season: TEAM_DEFENSE.latestSeason }
  const prior = TEAM_DEFENSE.seasons?.[TEAM_DEFENSE.latestSeason - 1]?.[team]
  return prior?.games > 0 ? { data: prior, isPrior: true, season: TEAM_DEFENSE.latestSeason - 1 } : null
}

const STAT_KEY = { rushing: 'rushingYardsAllowed', receiving: 'receivingYardsAllowed' }

/** Mean allowed-yards-per-game across every team with real data for a season, one side of the ball. */
function leagueAverageAllowedPerGame(season, statKey) {
  const teams = Object.values(TEAM_DEFENSE.seasons?.[season] ?? {}).filter((t) => t.games > 0)
  if (!teams.length) return null
  const perGameRates = teams.map((t) => t[statKey] / t.games)
  return perGameRates.reduce((s, v) => s + v, 0) / perGameRates.length
}

// Computed once per season+side rather than on every projectVolume() call —
// a Props tab render can ask this for a dozen players across one game.
const leagueAverageCache = new Map()
function cachedLeagueAverage(season, statKey) {
  const cacheKey = `${season}:${statKey}`
  if (!leagueAverageCache.has(cacheKey)) {
    leagueAverageCache.set(cacheKey, leagueAverageAllowedPerGame(season, statKey))
  }
  return leagueAverageCache.get(cacheKey)
}

/**
 * How this specific opponent's real defense compares with league average on
 * one side of the ball — rushing or receiving yards allowed per game.
 *
 * Returns null when there isn't enough real data to compare against yet
 * (an opponent with no games recorded in either season), rather than
 * guessing. `ratio` above 1 means this opponent allows more than average on
 * that side — an easier matchup than a typical week.
 */
export function allowedYardsRatio(opponent, side) {
  const statKey = STAT_KEY[side]
  if (!statKey) return null
  const found = defenseStatsFor(opponent)
  if (!found) return null
  const leagueAvg = cachedLeagueAverage(found.season, statKey)
  if (!leagueAvg) return null
  const perGame = found.data[statKey] / found.data.games
  return {
    ratio: perGame / leagueAvg,
    rank: found.data.ranks?.[statKey] ?? null,
    isPrior: found.isPrior,
    season: found.season
  }
}
