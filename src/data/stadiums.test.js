import { describe, it, expect } from 'vitest'
import { haversineMiles, travelMilesFor, stadiumFor, STADIUMS } from './stadiums.js'

describe('STADIUMS', () => {
  it('has an entry for all 32 franchises, each with real-looking coordinates and a roof type', () => {
    const abbrs = Object.keys(STADIUMS)
    expect(abbrs.length).toBe(32)
    for (const abbr of abbrs) {
      const s = STADIUMS[abbr]
      expect(s.venue).toBeTruthy()
      expect(s.lat).toBeGreaterThan(20)
      expect(s.lat).toBeLessThan(50)
      expect(s.lon).toBeLessThan(-65)
      expect(s.lon).toBeGreaterThan(-125)
      expect(['dome', 'retractable', 'outdoor']).toContain(s.roof)
    }
  })
})

describe('haversineMiles', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMiles(39.1, -84.5, 39.1, -84.5)).toBe(0)
  })

  it('matches the known real distance between two cities within a reasonable tolerance', () => {
    // NYC to LA is roughly 2,450 miles as the crow flies.
    const miles = haversineMiles(40.7128, -74.0060, 34.0522, -118.2437)
    expect(miles).toBeGreaterThan(2400)
    expect(miles).toBeLessThan(2500)
  })
})

describe('travelMilesFor', () => {
  it('computes real distance between two known stadiums for a normal game', () => {
    const miles = travelMilesFor('SEA', 'MIA', {})
    expect(miles).toBeGreaterThan(2500) // Seattle to Miami is a genuine cross-country trip
  })

  it('returns 0-ish (short) distance for two nearby teams', () => {
    const miles = travelMilesFor('NYJ', 'NYG', {}) // same building
    expect(miles).toBe(0)
  })

  it('returns null for a neutral-site game rather than guessing a location', () => {
    expect(travelMilesFor('ARI', 'CAR', { neutral: true })).toBeNull()
  })

  it('returns null for an unknown team abbreviation', () => {
    expect(travelMilesFor('ZZZ', 'MIA', {})).toBeNull()
  })
})

describe('stadiumFor', () => {
  it('returns null for a team not in the table', () => {
    expect(stadiumFor('ZZZ')).toBeNull()
  })
})
