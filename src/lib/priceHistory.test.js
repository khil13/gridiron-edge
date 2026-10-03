import { describe, it, expect } from 'vitest'
import { recordSnapshot, getHistory } from './priceHistory.js'

// storage.js falls back to an in-memory Map when localStorage is
// unavailable (true in this test environment), which is per-module-load
// global state — reset it between tests via the public clear() the module
// doesn't expose, so instead each test uses its own unique game id to stay
// isolated without needing to reach into storage internals.
let n = 0
const freshId = () => `test-game-${++n}`

describe('recordSnapshot / getHistory', () => {
  it('starts empty for a game never seen', () => {
    expect(getHistory(freshId())).toEqual([])
  })

  it('records a real snapshot and returns true', () => {
    const id = freshId()
    const stored = recordSnapshot(id, -3.5, 1000)
    expect(stored).toBe(true)
    expect(getHistory(id)).toEqual([{ spreadHome: -3.5, ts: 1000 }])
  })

  it('does not store a duplicate of the last spread, and returns false', () => {
    const id = freshId()
    recordSnapshot(id, -3.5, 1000)
    const storedAgain = recordSnapshot(id, -3.5, 2000)
    expect(storedAgain).toBe(false)
    expect(getHistory(id)).toHaveLength(1)
  })

  it('appends a real move as a new point, oldest first', () => {
    const id = freshId()
    recordSnapshot(id, -3.5, 1000)
    recordSnapshot(id, -3, 2000)
    recordSnapshot(id, -4, 3000)
    expect(getHistory(id)).toEqual([
      { spreadHome: -3.5, ts: 1000 },
      { spreadHome: -3, ts: 2000 },
      { spreadHome: -4, ts: 3000 }
    ])
  })

  it('allows a spread to move back to an earlier value — only the immediately preceding point is deduped', () => {
    const id = freshId()
    recordSnapshot(id, -3, 1000)
    recordSnapshot(id, -4, 2000)
    recordSnapshot(id, -3, 3000)
    expect(getHistory(id)).toHaveLength(3)
  })

  it('ignores a missing or non-numeric spread', () => {
    const id = freshId()
    expect(recordSnapshot(id, null)).toBe(false)
    expect(recordSnapshot(id, undefined)).toBe(false)
    expect(recordSnapshot(id, NaN)).toBe(false)
    expect(getHistory(id)).toEqual([])
  })

  it('ignores a call with no game id', () => {
    expect(recordSnapshot(null, -3)).toBe(false)
    expect(recordSnapshot('', -3)).toBe(false)
  })

  it('caps stored snapshots per game rather than growing without bound', () => {
    const id = freshId()
    for (let i = 0; i < 40; i++) recordSnapshot(id, i % 2 === 0 ? i : -i, 1000 + i)
    expect(getHistory(id).length).toBeLessThanOrEqual(30)
  })
})
