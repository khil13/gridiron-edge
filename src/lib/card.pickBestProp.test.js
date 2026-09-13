import { describe, it, expect } from 'vitest'
import { pickBestProp, sortPropPicks } from './card.js'

const clean = (ev, units = 1) => ({ tier: { units, suspicious: false }, entry: { ev } })
const flagged = (ev) => ({ tier: { units: 1, suspicious: true }, entry: { ev } })
const noPlay = () => ({ tier: { units: 0, suspicious: false }, entry: { ev: 0 } })

describe('pickBestProp', () => {
  it('returns null when nothing qualifies', () => {
    expect(pickBestProp([noPlay(), noPlay()])).toBeNull()
  })

  it('picks the highest-EV candidate when all are clean', () => {
    const best = pickBestProp([clean(0.02), clean(0.08), clean(0.05)])
    expect(best.entry.ev).toBe(0.08)
  })

  it('prefers a clean edge over a much larger flagged EV', () => {
    // This is the exact pattern seen in production: a flagged longshot at
    // +250% EV should never bury a real, unflagged 4% edge in the same game.
    const best = pickBestProp([flagged(2.5), clean(0.04)])
    expect(best.entry.ev).toBe(0.04)
    expect(best.tier.suspicious).toBe(false)
  })

  it('returns null rather than a flagged candidate when nothing else qualifies', () => {
    // Also confirmed live: every game with a flagged candidate had nothing
    // else, so treating it as a fallback meant the card showed nothing but
    // flagged longshots. A flagged candidate is excluded outright instead.
    expect(pickBestProp([flagged(2.5), noPlay()])).toBeNull()
  })

  it('returns null when every qualifying candidate is flagged', () => {
    expect(pickBestProp([flagged(1.5), flagged(2.5)])).toBeNull()
  })
})

describe('sortPropPicks', () => {
  it('sorts picks by EV descending', () => {
    const picks = [clean(0.02), clean(0.08), clean(0.05)]
    const sorted = sortPropPicks(picks)
    expect(sorted.map((p) => p.entry.ev)).toEqual([0.08, 0.05, 0.02])
  })

  it('does not mutate the input array', () => {
    const picks = [clean(0.08), clean(0.02)]
    const copy = [...picks]
    sortPropPicks(picks)
    expect(picks).toEqual(copy)
  })
})
