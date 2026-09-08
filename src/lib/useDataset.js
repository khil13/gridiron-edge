/**
 * Loads the slate once, then re-derives every projection, price and edge
 * whenever model settings change. The heavy work is memoised on settings so
 * dragging a slider in Model Lab stays smooth.
 */

import { useEffect, useMemo, useState } from 'react'
import { loadSlate, dataMode, REFRESH_MS } from '../data/provider.js'
import { fetchGameSummary, fetchSeasonResults } from '../data/providers/espnProvider.js'
import { applyResults } from './ratings.js'
import { load, save } from './storage.js'
import { buildMarkets } from '../data/markets.js'
import { projectGame, powerRankings } from './model.js'
import { computeEdges, consensusPlays } from './edges.js'
import { useStore } from './store.jsx'
import ratingsFile from '../data/generated/ratings.json'

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
      const base = projectGame(game, ratings, settings)
      if (!base) return null
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

    const games = slate.games.map((game) => {
      const projection = project(game)
      const market = markets[game.id] || null
      const plays = market ? consensusPlays(game, market, projection, settings) : []
      const allPlays = market ? computeEdges(game, market, projection, settings) : []
      return {
        ...game,
        projection,
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
 * Current power ratings: opening ratings with the season replayed onto them.
 *
 * Fetching every week of a season on each page load would be wasteful, so
 * results are cached. The cache key includes the count of finished games, so
 * it invalidates itself the moment a new result lands rather than relying on
 * a timer that is either too eager or too slow.
 */
export function useCurrentRatings(opening, settings, source, season, throughWeek = 1) {
  const [state, setState] = useState({
    loading: false, ratings: opening, applied: 0, error: null, live: false
  })

  useEffect(() => {
    if (source !== 'espn' || throughWeek < 1) {
      // Preseason or before kickoff: there is nothing to replay, and asking
      // would just be a round trip that returns nothing.
      setState({ loading: false, ratings: opening, applied: 0, error: null, live: false })
      return
    }

    const controller = new AbortController()
    let alive = true

    const cached = load(`results:${season}`, null)
    if (cached?.games?.length) {
      const replayed = applyResults(opening, cached.games, settings)
      setState({
        loading: true, ratings: replayed.ratings, applied: replayed.applied,
        error: null, live: true, asOf: cached.fetchedAt
      })
    } else {
      setState((s) => ({ ...s, loading: true }))
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
        const replayed = applyResults(opening, games, settings)
        setState({
          loading: false,
          ratings: replayed.ratings,
          applied: replayed.applied,
          history: replayed.history,
          error: failedWeeks ? `${failedWeeks} week(s) could not be loaded` : null,
          live: true,
          asOf: new Date().toISOString()
        })
      })
      .catch((err) => {
        if (!alive) return
        // Falling back to opening ratings is correct but must be visible:
        // silently projecting off stale ratings is worse than saying so.
        setState((s) => ({
          ...s,
          loading: false,
          error: `Could not load season results (${err.message}). Using opening ratings.`
        }))
      })

    return () => { alive = false; controller.abort() }
  }, [opening, settings, source, season, throughWeek])

  return state
}
