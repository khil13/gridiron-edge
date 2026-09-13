import { describe, it, expect } from 'vitest'
import { parseSituation } from './espnProvider.js'

const competitors = (offenseId, offenseAbbr, defenseId, defenseAbbr) => [
  { id: offenseId, homeAway: 'home', team: { id: offenseId, abbreviation: offenseAbbr } },
  { id: defenseId, homeAway: 'away', team: { id: defenseId, abbreviation: defenseAbbr } }
]

describe('parseSituation', () => {
  it('reads the legacy top-level situation object when present', () => {
    const json = {
      situation: {
        possession: '13',
        possessionText: 'LV 22',
        shortDownDistanceText: '3rd & 6',
        downDistanceText: '3rd & 6 at LV 22',
        down: 3,
        distance: 6,
        yardLine: 22,
        isRedZone: false
      },
      header: { competitions: [{ competitors: competitors('13', 'LV', '15', 'MIA') }] }
    }
    expect(parseSituation(json)).toEqual({
      downDistance: '3rd & 6',
      fieldPosition: 'LV 22',
      possession: 'LV',
      isRedZone: false,
      down: 3,
      distance: 6,
      yardLine: 22,
      lastPlay: null
    })
  })

  it('reads the legacy situation nested under header.competitions[0] when the top-level one is missing', () => {
    const json = {
      header: {
        competitions: [{
          competitors: competitors('13', 'LV', '15', 'MIA'),
          situation: {
            possession: '13', possessionText: 'LV 5', shortDownDistanceText: '1st & Goal',
            down: 1, distance: 10, yardLine: 5, isRedZone: true
          }
        }]
      }
    }
    const result = parseSituation(json)
    expect(result.possession).toBe('LV')
    expect(result.isRedZone).toBe(true)
  })

  it('falls back to the current drive\'s last play when situation is absent entirely — the shape ESPN now serves for at least some live games', () => {
    const json = {
      header: { competitions: [{ competitors: competitors('13', 'LV', '15', 'MIA') }] },
      drives: {
        current: {
          team: { id: '13' },
          plays: [
            { text: 'first play, irrelevant', end: { down: 1, distance: 10, yardLine: 30, yardsToEndzone: 70 } },
            {
              text: ' A.Jeanty left end to LV 22 for -1 yards (C.Johnson).',
              end: {
                down: 3, distance: 6, yardLine: 22, yardsToEndzone: 78,
                shortDownDistanceText: '3rd & 6', downDistanceText: '3rd & 6 at LV 22',
                possessionText: 'LV 22', team: { id: '13' }
              }
            }
          ]
        }
      }
    }
    expect(parseSituation(json)).toEqual({
      downDistance: '3rd & 6',
      fieldPosition: 'LV 22',
      possession: 'LV',
      isRedZone: false,
      down: 3,
      distance: 6,
      yardLine: 22,
      // The leading space ESPN's own text carries is trimmed, not preserved.
      lastPlay: 'A.Jeanty left end to LV 22 for -1 yards (C.Johnson).'
    })
  })

  it('derives isRedZone from yardsToEndzone when the drive fallback is used', () => {
    const json = {
      header: { competitions: [{ competitors: competitors('13', 'LV', '15', 'MIA') }] },
      drives: {
        current: {
          plays: [{ text: 'goal to go', end: { down: 1, distance: 5, yardLine: 5, yardsToEndzone: 5, team: { id: '13' } } }]
        }
      }
    }
    expect(parseSituation(json).isRedZone).toBe(true)
  })

  it('returns null when neither the legacy situation nor a current drive with plays exists', () => {
    expect(parseSituation({ header: { competitions: [{ competitors: [] }] } })).toBeNull()
    expect(parseSituation({ drives: { current: { plays: [] } } })).toBeNull()
    expect(parseSituation({})).toBeNull()
  })
})
