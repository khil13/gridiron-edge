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

  it('falls back to the flagged candidate when it is the only thing that qualifies', () => {
    const best = pickBestProp([flagged(2.5), noPlay()])
    expect(best.tier.suspicious).toBe(true)
  })

  it('picks the highest-EV flagged candidate when only flagged ones qualify', () => {
    const best = pickBestProp([flagged(1.5), flagged(2.5)])
    expect(best.entry.ev).toBe(2.5)
  })
})

describe('sortPropPicks', () => {
  it('sorts every clean pick ahead of every flagged pick regardless of EV', () => {
    const picks = [flagged(2.5), clean(0.02), flagged(1.0), clean(0.06)]
    const sorted = sortPropPicks(picks)
    expect(sorted.map((p) => p.tier.suspicious)).toEqual([false, false, true, true])
    // Clean picks still rank by EV among themselves, same for flagged.
    expect(sorted[0].entry.ev).toBe(0.06)
    expect(sorted[1].entry.ev).toBe(0.02)
    expect(sorted[2].entry.ev).toBe(2.5)
    expect(sorted[3].entry.ev).toBe(1.0)
  })

  it('does not mutate the input array', () => {
    const picks = [flagged(2.5), clean(0.02)]
    const copy = [...picks]
    sortPropPicks(picks)
    expect(picks).toEqual(copy)
  })
})
