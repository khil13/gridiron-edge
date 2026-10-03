/**
 * priceHistory.js — real, observed line movement, not a reconstruction.
 *
 * markets.js's simulated path fabricates a smooth movement curve (now
 * honestly labeled as such — see GameView.jsx). The live path
 * (oddsApiProvider.js) is worse off: The Odds API's live endpoint only
 * ever returns the *current* price, and a true market-open-to-now history
 * needs a paid historical-odds feed this app does not have.
 *
 * What IS real and free: whatever this app itself has actually observed
 * while a visitor had it open. Every live poll that returns a genuinely
 * different spread gets appended, with a real timestamp, to this
 * browser's own local storage. The resulting chart is honestly scoped —
 * "since you started watching this game," not "since the market opened" —
 * and it is never backfilled or guessed at for the time before that.
 */

import { load, save } from './storage.js'

const KEY = 'priceHistory:v1'
const MAX_SNAPSHOTS_PER_GAME = 30
const MAX_GAMES = 60 // bounds total storage; least-recently-updated games evicted first

const readAll = () => load(KEY, {})
const writeAll = (all) => save(KEY, all)

/**
 * Record a real observed price point for a game, if it actually moved.
 * Returns true when a new point was stored (so a caller can know to
 * re-render), false when this spread already matches the last snapshot —
 * polling the same unchanged price every 45s should not spam the history.
 */
export function recordSnapshot(gameId, spreadHome, ts = Date.now()) {
  if (!gameId || spreadHome == null || !Number.isFinite(spreadHome)) return false
  const all = readAll()
  const existing = all[gameId] ?? []
  const last = existing[existing.length - 1]
  if (last && last.spreadHome === spreadHome) return false

  const next = [...existing, { spreadHome, ts }].slice(-MAX_SNAPSHOTS_PER_GAME)
  const updated = { ...all, [gameId]: next }

  const ids = Object.keys(updated)
  if (ids.length > MAX_GAMES) {
    const byRecency = ids
      .map((id) => ({ id, last: updated[id][updated[id].length - 1]?.ts ?? 0 }))
      .sort((a, b) => a.last - b.last)
    for (const { id } of byRecency.slice(0, ids.length - MAX_GAMES)) delete updated[id]
  }

  writeAll(updated)
  return true
}

/** Real observed snapshots for one game, oldest first. Empty if never seen. */
export function getHistory(gameId) {
  return readAll()[gameId] ?? []
}
