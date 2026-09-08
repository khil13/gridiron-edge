/** Bundled dataset. Works with no network and no keys. */

import { PRESEASON_2026 } from '../schedule.js'
import { SEASON_2025 } from '../season2025.js'

export async function fetchSlate() {
  const games = PRESEASON_2026.map((g) => ({ ...g, preseason: true }))

  // This dataset is a fixed snapshot. Once the calendar has moved past it,
  // showing it as "the slate" is actively misleading — the games are real
  // but they are over, and nothing on the page would say so.
  const last = games.map((g) => g.kickoff).sort().pop()
  const daysOld = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : 0

  return {
    source: 'bundled',
    label: 'Bundled 2026 preseason',
    games,
    history: SEASON_2025.results,
    staleDays: daysOld > 3 ? daysOld : 0
  }
}

export async function fetchMarkets() {
  return null // signals "generate simulated prices"
}
