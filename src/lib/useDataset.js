/**
 * Loads the slate once, then re-derives every projection, price and edge
 * whenever model settings change. The heavy work is memoised on settings so
 * dragging a slider in Model Lab stays smooth.
 */

import { useEffect, useMemo, useState } from 'react'
import { loadSlate, dataMode } from '../data/provider.js'
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
    loadSlate({ signal: controller.signal })
      .then((slate) => alive && setState({ loading: false, ...slate }))
      .catch((err) =>
        alive &&
        setState({
          loading: false, games: [], source: 'none', label: '',
          warnings: [`Could not load any slate: ${err.message}`]
        })
      )
    return () => { alive = false; controller.abort() }
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
      return {
        ...base,
        margin,
        modelSpreadHome: -margin,
        modelSpreadAway: margin,
        homeWinProb: 0.5 + (base.homeWinProb - 0.5) * k,
        awayWinProb: 0.5 - (base.homeWinProb - 0.5) * k,
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
