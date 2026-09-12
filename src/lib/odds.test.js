import { describe, it, expect } from 'vitest'
import {
  americanToDecimal, decimalToAmerican, impliedProb, probToAmerican,
  validPrice, devig, expectedValue, kelly, parlayPrice, payout, clv,
  normalCdf, winProbFromMargin, marginFromWinProb, coverProbability,
  overProbability, pushProbability, clamp
} from './odds.js'

describe('price conversion', () => {
  it('round-trips american -> decimal -> american', () => {
    for (const a of [-500, -200, -110, 100, 150, 300, 1200]) {
      expect(decimalToAmerican(americanToDecimal(a))).toBeCloseTo(a, 0)
    }
  })

  it('rejects prices below the minimum and above the maximum', () => {
    expect(validPrice(-110)).toBe(true)
    expect(validPrice(150)).toBe(true)
    expect(validPrice(50)).toBe(false)   // below 100 in absolute terms
    expect(validPrice(22000)).toBe(false) // a 220 typo missing its sign
    expect(validPrice(NaN)).toBe(false)
  })

  it('computes implied probability for both signs', () => {
    expect(impliedProb(100)).toBeCloseTo(0.5, 6)
    expect(impliedProb(-100)).toBeCloseTo(0.5, 6)
    expect(impliedProb(-110)).toBeGreaterThan(0.5)
  })

  it('probToAmerican gives even money at a 50% probability', () => {
    // Exactly 0.5 takes the >= branch, which reports -100 rather than +100 —
    // both are even money, just opposite sides of the same coin flip.
    expect(impliedProb(probToAmerican(0.5))).toBeCloseTo(0.5, 6)
  })
})

describe('devig', () => {
  it('removes the vig so probabilities sum to 1', () => {
    for (const method of ['multiplicative', 'additive', 'power', 'shin']) {
      const { probs } = devig([-110, -110], method)
      const sum = probs.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 6)
    }
  })

  it('reports a positive hold on a standard -110/-110 market', () => {
    const { hold } = devig([-110, -110], 'multiplicative')
    expect(hold).toBeGreaterThan(0)
    expect(hold).toBeCloseTo(0.0476, 3)
  })

  it('splits a true coin flip evenly regardless of method', () => {
    for (const method of ['multiplicative', 'additive', 'power', 'shin']) {
      const { probs } = devig([-110, -110], method)
      expect(probs[0]).toBeCloseTo(0.5, 3)
      expect(probs[1]).toBeCloseTo(0.5, 3)
    }
  })
})

describe('wager evaluation', () => {
  it('gives zero EV at fair value', () => {
    // -110 implies ~0.524 win prob; feeding that back in should be ~breakeven.
    const p = impliedProb(-110)
    expect(expectedValue(p, -110)).toBeCloseTo(0, 6)
  })

  it('is positive when the true probability beats the price', () => {
    expect(expectedValue(0.6, 100)).toBeGreaterThan(0)
  })

  it('kelly returns 0 with no edge, never negative', () => {
    const p = impliedProb(-110)
    expect(kelly(p, -110)).toBeCloseTo(0, 6)
    expect(kelly(0.3, -110)).toBe(0)
  })

  it('kelly scales down under a fractional multiplier', () => {
    const full = kelly(0.6, 100, 0, 1)
    const quarter = kelly(0.6, 100, 0, 0.25)
    expect(quarter).toBeCloseTo(full * 0.25, 6)
  })

  it('parlays two -110 legs into worse-than-even odds', () => {
    const { american } = parlayPrice([-110, -110])
    expect(american).toBeGreaterThan(100)
  })

  it('pays out stake times decimal odds', () => {
    expect(payout(100, 100)).toBeCloseTo(200, 6)
    expect(payout(110, -110)).toBeCloseTo(210, 6)
  })

  it('clv is positive when your price was better than the close', () => {
    expect(clv(120, -110)).toBeGreaterThan(0)
  })
})

describe('score distributions', () => {
  it('normalCdf is 0.5 at the mean', () => {
    expect(normalCdf(0, 0, 13.2)).toBeCloseTo(0.5, 6)
  })

  it('winProbFromMargin and marginFromWinProb are inverses', () => {
    for (const m of [-10, -3, 0, 3.5, 10]) {
      const p = winProbFromMargin(m, 13.2)
      expect(marginFromWinProb(p, 13.2)).toBeCloseTo(m, 1)
    }
  })

  it('a favourite covering a pick-em is a coin flip', () => {
    const { win, lose, push } = coverProbability(0, 0, 13.2)
    expect(win).toBeCloseTo(0.5, 2)
    expect(win + lose + push).toBeCloseTo(1, 6)
  })

  it('a heavy favourite is more likely to cover a small number', () => {
    const big = coverProbability(10, -3, 13.2)
    const small = coverProbability(2, -3, 13.2)
    expect(big.win).toBeGreaterThan(small.win)
  })

  it('overProbability rises with the projected total', () => {
    const low = overProbability(40, 44.5, 10.4)
    const high = overProbability(50, 44.5, 10.4)
    expect(high.win).toBeGreaterThan(low.win)
  })

  it('flags push mass only on whole-number lines', () => {
    expect(pushProbability(3)).toBeGreaterThan(0)
    expect(pushProbability(3.5)).toBe(0)
  })
})

describe('clamp', () => {
  it('bounds a value to the given range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })
})
