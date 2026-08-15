/**
 * Loads the slate once, then re-derives every projection, price and edge
 * whenever model settings change. The heavy work is memoised on settings so
 * dragging a slider in Model Lab stays smooth.
 */

import { useEffect, useMemo, useState } from 'react'
import { loadSlate, dataMode, REFRESH_MS } from '../data/provider.js'
import { fetchGameSummary } from '../data/providers/espnProvider.js'
import { buildMarkets } from '../data/markets.js'
import { projectGame, powerRankings } from './model.js'
import { computeEdges, consensusPlays } from './edges.js'
import { useStore } from './store.jsx'
import ratingsFile from '../data/generated/ratings.json'

export function useSlate() {
  const [state, setState] = useState({ loading: true, games: [], warnings: [], source: 'bundled', label: '' })

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    let timer = null

    const pull = () => {
      loadSlate({ signal: controller.signal })
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
  }, [])

  return state
}

export function useDataset() {
  const slate = useSlate()
  const { settings } = useStore()

  return useMemo(() => {
    const ratings = ratingsFile.ratings

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
      rankings: powerRankings(ratings),
      board,
      simulatedPrices: !slate.markets,
      dataMode
    }
  }, [slate, settings])
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
