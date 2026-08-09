/** Bundled dataset. Works with no network and no keys. */

import { PRESEASON_2026 } from '../schedule.js'
import { SEASON_2025 } from '../season2025.js'

export async function fetchSlate() {
  return {
    source: 'bundled',
    label: 'Bundled 2026 preseason',
    games: PRESEASON_2026.map((g) => ({ ...g, preseason: true })),
    history: SEASON_2025.results
  }
}

export async function fetchMarkets() {
  return null // signals "generate simulated prices"
}
