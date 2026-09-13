import { describe, it, expect } from 'vitest'
import { parseLastPlay } from './lastPlay.js'

describe('parseLastPlay', () => {
  it('parses a complete pass with a spot and yardage', () => {
    expect(parseLastPlay('A.Rodgers pass deep middle to R.Wilson to ATL 41 for 20 yards')).toEqual({
      type: 'pass', yards: 20, primary: 'A.Rodgers', secondary: 'R.Wilson'
    })
  })

  it('parses a complete pass with a tackler in parens', () => {
    expect(parseLastPlay('A.Rodgers pass short right to R.Wilson for 6 yards (T.Watt)')).toEqual({
      type: 'pass', yards: 6, primary: 'A.Rodgers', secondary: 'R.Wilson'
    })
  })

  it('parses a rush for a gain', () => {
    expect(parseLastPlay('L.Jackson rush right end to ATL 41 for 8 yards (T.Watt)')).toEqual({
      type: 'rush', yards: 8, primary: 'L.Jackson', secondary: null
    })
  })

  it('parses a real ESPN rush that omits the word "rush" entirely', () => {
    // Confirmed live from ESPN's own feed: a lot of real rush plays are
    // worded as "<player> <direction> to <spot> for <yards>" with no verb
    // at all, not "<player> rush <direction> ...".
    expect(parseLastPlay('A.Jeanty left end to LV 22 for -1 yards (C.Johnson).')).toEqual({
      type: 'rush', yards: -1, primary: 'A.Jeanty', secondary: null
    })
  })

  it('parses a rush for no gain', () => {
    expect(parseLastPlay('L.Jackson rush middle for no gain')).toEqual({
      type: 'rush', yards: 0, primary: 'L.Jackson', secondary: null
    })
  })

  it('parses a rush with the verb but no direction at all', () => {
    expect(parseLastPlay('L.Jackson rush for 8 yards')).toEqual({
      type: 'rush', yards: 8, primary: 'L.Jackson', secondary: null
    })
  })

  it('parses a sack as a negative-yardage single-player play', () => {
    expect(parseLastPlay('A.Rodgers sacked at PIT 25 for -8 yards (T.Watt)')).toEqual({
      type: 'sack', yards: -8, primary: 'A.Rodgers', secondary: null
    })
  })

  it('parses a sack worded as a loss', () => {
    expect(parseLastPlay('A.Rodgers sacked for a loss of 8 yards')).toEqual({
      type: 'sack', yards: -8, primary: 'A.Rodgers', secondary: null
    })
  })

  it('returns null for an incomplete pass rather than guessing a trajectory', () => {
    expect(parseLastPlay('A.Rodgers pass incomplete short right to R.Wilson')).toBeNull()
  })

  it('returns null for text it does not recognize', () => {
    expect(parseLastPlay('Penalty on ATL, Holding, 10 yards')).toBeNull()
    expect(parseLastPlay('Timeout #1 by Atlanta Falcons')).toBeNull()
  })

  it('returns null for empty or missing text', () => {
    expect(parseLastPlay('')).toBeNull()
    expect(parseLastPlay(null)).toBeNull()
    expect(parseLastPlay(undefined)).toBeNull()
  })
})
