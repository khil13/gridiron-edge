import { describe, it, expect } from 'vitest'
import { pickBestProp, pickPropsForGame, sortPropPicks, isMainPlayer } from './card.js'

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

describe('pickPropsForGame', () => {
  it('returns every qualifying candidate, not just the best, up to the cap', () => {
    const legs = pickPropsForGame([clean(0.02), clean(0.08), clean(0.05)], 2)
    expect(legs.map((l) => l.entry.ev)).toEqual([0.08, 0.05])
  })

  it('still excludes flagged candidates at any rank', () => {
    const legs = pickPropsForGame([flagged(2.5), clean(0.04), clean(0.02)])
    expect(legs.every((l) => !l.tier.suspicious)).toBe(true)
    expect(legs.map((l) => l.entry.ev)).toEqual([0.04, 0.02])
  })

  it('returns an empty array rather than a flagged candidate when nothing else qualifies', () => {
    expect(pickPropsForGame([flagged(2.5), noPlay()])).toEqual([])
  })

  it('defaults to a max of two legs per game', () => {
    const legs = pickPropsForGame([clean(0.01), clean(0.02), clean(0.03), clean(0.04)])
    expect(legs).toHaveLength(2)
  })
})

describe('isMainPlayer', () => {
  it('accepts a team\'s clear QB1, RB1, WR1 and TE1', () => {
    expect(isMainPlayer('QB')).toBe(true)
    expect(isMainPlayer('RB1')).toBe(true)
    expect(isMainPlayer('WR1')).toBe(true)
    expect(isMainPlayer('TE1')).toBe(true)
  })

  it('rejects a second or third option, and an unranked depth-unknown group member', () => {
    expect(isMainPlayer('RB2')).toBe(false)
    expect(isMainPlayer('WR2')).toBe(false)
    expect(isMainPlayer('WR3')).toBe(false)
    expect(isMainPlayer('TE2')).toBe(false)
    expect(isMainPlayer('WR')).toBe(false)
    expect(isMainPlayer('RB')).toBe(false)
    expect(isMainPlayer('TE')).toBe(false)
  })

  it('rejects a missing role rather than throwing', () => {
    expect(isMainPlayer(undefined)).toBe(false)
    expect(isMainPlayer(null)).toBe(false)
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
