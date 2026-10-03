/**
 * Loads the slate once, then re-derives every projection, price and edge
 * whenever model settings change. The heavy work is memoised on settings so
 * dragging a slider in Model Lab stays smooth.
 */

import { useEffect, useMemo, useState } from 'react'
import { loadSlate, dataMode, REFRESH_MS } from '../data/provider.js'
import { fetchGameSummary, fetchSeasonResults } from '../data/providers/espnProvider.js'
import { fetchGameWeather } from '../data/providers/weatherProvider.js'
import { stadiumFor } from '../data/stadiums.js'
import { applyResults, restDaysFor } from './ratings.js'
import { load, save } from './storage.js'
import { buildMarkets } from '../data/markets.js'
import { projectGame, powerRankings } from './model.js'
import { projectGameEpa, blendedSeasonEfficiency } from './epaModel.js'
import { combineProjections } from './modelAgreement.js'
import { simulateGame } from './simulation.js'
import { confidenceFor } from './confidence.js'
import { applyInjuryAdjustment } from './injuries.js'
import { computeEdges, consensusPlays } from './edges.js'
import { useStore } from './store.jsx'
import ratingsFile from '../data/generated/ratings.json'
import teamEfficiencyFile from '../data/generated/team-efficiency.json'
import injuryReportFile from '../data/generated/injury-report.json'

export function useSlate(oddsKey) {
  const [state, setState] = useState({ loading: true, games: [], warnings: [], source: 'bundled', label: '' })

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    let timer = null

    const pull = () => {
      loadSlate({ signal: controller.signal, oddsKey })
        .then((slate) => {
          if (!alive) return
          setState({ loading: false, ...slate })
          // Only keep polling when something is actually in progress. A
          // finished or future slate does not change minute to minute, and
          // hammering a public endpoint for no reason is rude.
          const anyLive = slate.games?.some((g) => g.status === 'live')
          if (anyLive && slate.source === 'espn') {
            timer = setTimeout(pull, REFRESH_MS)
          }
        })
        .catch((err) => {
          if (!alive) return
          setState({
            loading: false, games: [], source: 'none', label: '',
            warnings: [`Could not load any slate: ${err.message}`]
          })
        })
    }

    pull()
    return () => {
      alive = false
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [oddsKey])

  return state
}

export function useDataset() {
  const { settings, oddsKey } = useStore()
  const slate = useSlate(oddsKey)
  const season = slate.seasonYear || new Date().getFullYear()

  // Regular-season week from the feed. During the postseason ESPN restarts
  // the numbering, so those weeks are added on top of the eighteen.
  const throughWeek =
    slate.seasonType === 3 ? 18 + (slate.week ?? 1)
      : slate.seasonType === 2 ? (slate.week ?? 1)
      : 0

  const current = useCurrentRatings(ratingsFile.ratings, settings, slate.source, season, throughWeek)

  return useMemo(() => {
    // Ratings with the season replayed onto them when results are available,
    // opening ratings otherwise.
    const ratings = current.ratings || ratingsFile.ratings

    // Preseason results say little about a roster's real strength, so the
    // model deliberately pulls its own projections toward a pick'em.
    const project = (game) => {
      const history = current.history ?? []
      const homeRestDays = restDaysFor(game.home, game.kickoff, history)
      const awayRestDays = restDaysFor(game.away, game.kickoff, history)
      const projected = projectGame({ ...game, homeRestDays, awayRestDays }, ratings, settings)
      if (!projected) return null
      const base = { ...projected, homeRestDays, awayRestDays }
      if (!game.preseason) return base
      const k = 1 - (settings.preseasonShrink ?? 0)
      const margin = base.margin * k
      // Team totals must be rebuilt from the shrunk margin, or they would
      // still encode the unshrunk view of who is better.
      const homeTeamTotal = Math.round(((base.total + margin) / 2) * 2) / 2
      const awayTeamTotal = Math.round(((base.total - margin) / 2) * 2) / 2
      return {
        ...base,
        margin,
        modelSpreadHome: -margin,
        modelSpreadAway: margin,
        homeWinProb: 0.5 + (base.homeWinProb - 0.5) * k,
        awayWinProb: 0.5 - (base.homeWinProb - 0.5) * k,
        homeTeamTotal,
        awayTeamTotal,
        shrunk: true
      }
    }

    const markets = slate.markets || buildMarkets(slate.games, project)

    // A second, independent projection built entirely from real per-play
    // EPA (see epaModel.js) rather than the Elo model's win/loss margins —
    // genuinely different inputs, so where the two agree or disagree is a
    // real signal rather than one model quoting itself twice.
    const efficiencyTable = blendedSeasonEfficiency(teamEfficiencyFile.seasons, teamEfficiencyFile.latestSeason)
    const projectEpa = (game) => (game.preseason ? null : projectGameEpa(game, efficiencyTable, settings))

    const games = slate.games.map((game) => {
      // A real, bounded shift when a team's starting QB is ruled out (see
      // injuries.js) — applied before anything downstream (edges, the
      // simulation, confidence) reads the margin, so a QB-out game is
      // priced and simulated against the adjusted number, not the one
      // that ignores it.
      const projection = applyInjuryAdjustment(game, project(game), injuryReportFile, settings)
      const epaProjection = projectEpa(game)
      const modelAgreement = combineProjections(projection, epaProjection, settings)
      // Real Monte Carlo (see simulation.js) from the same team totals the
      // headline projection already produced — shows the distribution
      // around that number rather than just the number itself.
      const simulation = simulateGame(projection)
      const confidence = confidenceFor({ game, epaProjection, modelAgreement, simulation, ratings, qbOut: projection?.qbOut })
      const market = markets[game.id] || null
      const plays = market ? consensusPlays(game, market, projection, settings) : []
      const allPlays = market ? computeEdges(game, market, projection, settings) : []
      return {
        ...game,
        projection,
        epaProjection,
        modelAgreement,
        simulation,
        confidence,
        market,
        plays,
        topPlay: plays.find((p) => p.qualified) || plays[0] || null,
        allPlays
      }
    })

    const board = games
      .flatMap((g) => g.plays.map((p) => ({ ...p, game: g })))
      .filter((p) => p.ev > 0)
      .sort((a, b) => b.ev - a.ev)

    return {
      ...slate,
      games,
      markets,
      ratings,
      ratingsMeta: ratingsFile,
      ratingsState: {
        live: current.live,
        applied: current.applied,
        loading: current.loading,
        error: current.error,
        asOf: current.asOf
      },
      rankings: powerRankings(ratings),
      efficiencyTable,
      board,
      simulatedPrices: !slate.markets,
      oddsMeta: slate.oddsMeta ?? null,
      dataMode
    }
  }, [slate, settings, current])
}

/**
 * Live box score for one game.
 *
 * Fetched lazily when a game page is opened rather than for the whole slate,
 * and only when the score feed is actually live — the bundled dataset has no
 * box scores to fetch. Re-polls while the game is in progress.
 */
export function useGameSummary(game, source) {
  const [state, setState] = useState({ loading: false, summary: null, error: null })

  const eligible =
    source === 'espn' && game && (game.status === 'live' || game.status === 'final')

  useEffect(() => {
    if (!eligible) {
      setState({ loading: false, summary: null, error: null })
      return
    }

    const controller = new AbortController()
    let alive = true
    let timer = null
    setState((s) => ({ ...s, loading: true }))

    const pull = () => {
      fetchGameSummary(game.id, { signal: controller.signal })
        .then((summary) => {
          if (!alive) return
          setState({ loading: false, summary, error: null })
          if (game.status === 'live') timer = setTimeout(pull, REFRESH_MS)
        })
        .catch((err) => {
          if (!alive) return
          setState({ loading: false, summary: null, error: err.message })
        })
    }

    pull()
    return () => {
      alive = false
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [eligible, game?.id, game?.status])

  return state
}

/**
 * Real forecast for a game's venue, fetched lazily when a game page opens.
 *
 * Skipped entirely for a dome (weather is never a factor there) and for a
 * neutral-site game (stadiums.js has no source for where that actually is,
 * so there is nothing honest to fetch). A single fetch, not polled — a
 * forecast does not meaningfully change minute to minute the way a score
 * does, and Open-Meteo's own update cadence is hourly at best.
 */
export function useGameWeather(game) {
  const stadium = game?.home ? stadiumFor(game.home) : null
  const roof = stadium?.roof ?? null
  const eligible = !!game && !game.neutral && !!stadium && roof !== 'dome'

  const [state, setState] = useState({ loading: false, weather: null, error: null })

  useEffect(() => {
    if (!eligible) {
      setState({ loading: false, weather: null, error: null })
      return
    }

    const controller = new AbortController()
    let alive = true
    setState({ loading: true, weather: null, error: null })

    fetchGameWeather({ lat: stadium.lat, lon: stadium.lon, kickoff: game.kickoff, signal: controller.signal })
      .then((weather) => { if (alive) setState({ loading: false, weather, error: null }) })
      .catch((err) => { if (alive) setState({ loading: false, weather: null, error: err.message }) })

    return () => { alive = false; controller.abort() }
  }, [eligible, game?.id, game?.kickoff, stadium?.lat, stadium?.lon])

  return { ...state, roof }
}

/**
 * Current power ratings: opening ratings with the season replayed onto them.
 *
 * Fetching every week of a season on each page load would be wasteful, so
 * results are cached. The cache key includes the count of finished games, so
 * it invalidates itself the moment a new result lands rather than relying on
 * a timer that is either too eager or too slow.
 */
export function useCurrentRatings(opening, settings, source, season, throughWeek = 1) {
  // Only the fetch itself is state: the games actually played this season.
  // Replaying them onto `opening` is pure arithmetic (a few hundred games,
  // per the design note in ratings.js) and depends on `settings`, so it is
  // redone in the useMemo below rather than re-fetched here — otherwise
  // every drag of a Model Lab slider would re-hit ESPN for the whole season.
  const [fetchState, setFetchState] = useState({
    loading: false, games: null, error: null, live: false, asOf: null
  })

  useEffect(() => {
    if (source !== 'espn' || throughWeek < 1) {
      // Preseason or before kickoff: there is nothing to replay, and asking
      // would just be a round trip that returns nothing.
      setFetchState({ loading: false, games: null, error: null, live: false, asOf: null })
      return
    }

    const controller = new AbortController()
    let alive = true

    const cached = load(`results:${season}`, null)
    if (cached?.games?.length) {
      setFetchState({
        loading: true, games: cached.games, error: null, live: true, asOf: cached.fetchedAt
      })
    } else {
      setFetchState((s) => ({ ...s, loading: true }))
    }

    // Only ask for weeks that could already have been played. On opening
    // weekend that is one request, not twenty-three: the old code fetched
    // every week of the season plus the playoffs on every page load, which
    // is both wasteful and a good way to get rate-limited on the one night
    // the app matters most.
    fetchSeasonResults(season, { signal: controller.signal, throughWeek })
      .then(({ games, failedWeeks }) => {
        if (!alive) return
        save(`results:${season}`, { games, fetchedAt: new Date().toISOString() })
        setFetchState({
          loading: false,
          games,
          error: failedWeeks ? `${failedWeeks} week(s) could not be loaded` : null,
          live: true,
          asOf: new Date().toISOString()
        })
      })
      .catch((err) => {
        if (!alive) return
        // Falling back to opening ratings is correct but must be visible:
        // silently projecting off stale ratings is worse than saying so.
        setFetchState((s) => ({
          ...s,
          loading: false,
          error: `Could not load season results (${err.message}). Using opening ratings.`
        }))
      })

    return () => { alive = false; controller.abort() }
  }, [source, season, throughWeek])

  return useMemo(() => {
    if (!fetchState.games) {
      return {
        loading: fetchState.loading, ratings: opening, applied: 0,
        error: fetchState.error, live: fetchState.live, asOf: fetchState.asOf
      }
    }
    const replayed = applyResults(opening, fetchState.games, settings)
    return {
      loading: fetchState.loading,
      ratings: replayed.ratings,
      applied: replayed.applied,
      history: replayed.history,
      error: fetchState.error,
      live: fetchState.live,
      asOf: fetchState.asOf
    }
  }, [opening, settings, fetchState])
}
