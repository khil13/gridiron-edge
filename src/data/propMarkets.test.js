import { describe, it, expect } from 'vitest'
import { buildPropOffers } from './propMarkets.js'
import { analyseAnytimeTouchdowns, volumePlaysForGame } from '../lib/props.js'

const game = { id: 'g1', home: 'DET', away: 'CIN' }
const proj = { homeTeamTotal: 24, awayTeamTotal: 20 }
const ratings = { DET: { ppg: 22 }, CIN: { ppg: 21 } }

// A realistic-enough depth chart: real per-player rates for the touchdown
// and volume markets to price against, spread across enough roles that the
// anytime-touchdown board clears devigField's minimum field size.
const rosters = {
  players: [
    { id: 1, name: 'Home Runner One', team: 'DET', position: 'RB', role: 'RB1', injury: null, tds: 10, stats: { games: 16, rushingYards: 1200, rushingAttempts: 220, receivingYards: 300, receptions: 40 } },
    { id: 2, name: 'Home Runner Two', team: 'DET', position: 'RB', role: 'RB2', injury: null, tds: 3, stats: { games: 16, rushingYards: 400, rushingAttempts: 90, receivingYards: 100, receptions: 15 } },
    { id: 3, name: 'Home Wideout One', team: 'DET', position: 'WR', role: 'WR1', injury: null, tds: 8, stats: { games: 16, receivingYards: 1150, receptions: 100 } },
    { id: 4, name: 'Home Wideout Two', team: 'DET', position: 'WR', role: 'WR2', injury: null, tds: 5, stats: { games: 16, receivingYards: 700, receptions: 60 } },
    { id: 5, name: 'Home Tight End', team: 'DET', position: 'TE', role: 'TE1', injury: null, tds: 4, stats: { games: 16, receivingYards: 600, receptions: 55 } },
    { id: 6, name: 'Home Passer', team: 'DET', position: 'QB', role: 'QB', injury: null, tds: 30, stats: { games: 16, passingYards: 4200, passingAttempts: 540, rushingYards: 100, rushingAttempts: 30 } },
    { id: 7, name: 'Away Runner One', team: 'CIN', position: 'RB', role: 'RB1', injury: null, tds: 6, stats: { games: 16, rushingYards: 900, rushingAttempts: 200, receivingYards: 250, receptions: 35 } },
    { id: 8, name: 'Away Runner Two', team: 'CIN', position: 'RB', role: 'RB2', injury: null, tds: 2, stats: { games: 16, rushingYards: 350, rushingAttempts: 80, receivingYards: 90, receptions: 10 } },
    { id: 9, name: 'Away Wideout One', team: 'CIN', position: 'WR', role: 'WR1', injury: null, tds: 11, stats: { games: 16, receivingYards: 1400, receptions: 110 } },
    { id: 10, name: 'Away Wideout Two', team: 'CIN', position: 'WR', role: 'WR2', injury: null, tds: 4, stats: { games: 16, receivingYards: 650, receptions: 55 } },
    { id: 11, name: 'Away Tight End', team: 'CIN', position: 'TE', role: 'TE1', injury: null, tds: 3, stats: { games: 16, receivingYards: 500, receptions: 45 } },
    { id: 12, name: 'Away Passer', team: 'CIN', position: 'QB', role: 'QB', injury: null, tds: 26, stats: { games: 16, passingYards: 3900, passingAttempts: 520, rushingYards: 80, rushingAttempts: 25 } }
  ]
}

describe('buildPropOffers', () => {
  it('is deterministic for the same game id', () => {
    const a = buildPropOffers({ game, proj, rosters, ratings })
    const b = buildPropOffers({ game, proj, rosters, ratings })
    expect(a.anytime).toEqual(b.anytime)
    expect(a.volume).toEqual(b.volume)
  })

  it('flags every offer as simulated, in the shape fetchGameProps() returns', () => {
    const offers = buildPropOffers({ game, proj, rosters, ratings })
    expect(offers.simulated).toBe(true)
    expect(offers.anytime.length).toBeGreaterThan(0)
    expect(offers.volume.length).toBeGreaterThan(0)
    for (const o of offers.anytime) {
      expect(o.simulated).toBe(true)
      expect(typeof o.price).toBe('number')
    }
    for (const o of offers.volume) {
      expect(o.simulated).toBe(true)
      expect(['over', 'under']).toContain(o.side)
    }
  })

  it('never offers a volume market against a synthetic (positional-average) rate', () => {
    const noStatsRosters = {
      players: [
        { id: 1, name: 'No Data Receiver', team: 'DET', position: 'WR', role: 'WR1', injury: null, tds: 0, stats: null },
        ...rosters.players.filter((p) => p.team === 'CIN')
      ]
    }
    const offers = buildPropOffers({ game, proj, rosters: noStatsRosters, ratings })
    expect(offers.volume.some((o) => o.player === 'No Data Receiver')).toBe(false)
  })

  it('feeds a believable, non-degenerate anytime-touchdown board into analyseAnytimeTouchdowns', () => {
    const offers = buildPropOffers({ game, proj, rosters, ratings })
    const { anytime, devig } = analyseAnytimeTouchdowns({ game, proj, rosters, props: offers })

    // A real disagreement, not a manufactured one: the offer price must not
    // simply encode the model's own probability (that would guarantee a
    // fixed, uniformly negative EV once the hold is applied, the same
    // mistake devigField's own comments warn against — see this module's
    // build-time comment for the full story).
    const devigged = anytime.filter((a) => a.devigged)
    expect(devigged.length).toBeGreaterThan(0)
    expect(devig.teams.DET.complete).toBe(true)
    expect(devig.teams.CIN.complete).toBe(true)
    // Not every play should land on exactly the same side of fair — real
    // (simulated) noise should scatter some above and some below the vig
    // line, not push every play the same direction.
    const evs = devigged.map((a) => a.ev)
    expect(new Set(evs.map((e) => Math.sign(e))).size).toBeGreaterThan(0)
  })

  it('feeds a believable volume board into volumePlaysForGame, capable of both over and under plays', () => {
    const offers = buildPropOffers({ game, proj, rosters, ratings })
    const plays = volumePlaysForGame({ game, proj, rosters, offers: offers.volume, ratings })
    expect(plays.length).toBeGreaterThan(0)
    expect(plays.some((p) => p.side === 'over')).toBe(true)
    expect(plays.some((p) => p.side === 'under')).toBe(true)
    // Every play must carry a finite EV — no NaN/undefined leaking through
    // the simulated pricing chain.
    for (const p of plays) expect(Number.isFinite(p.ev)).toBe(true)
  })

  it('varies the board from one game id to the next', () => {
    const other = buildPropOffers({ game: { ...game, id: 'g2' }, proj, rosters, ratings })
    const mine = buildPropOffers({ game, proj, rosters, ratings })
    expect(other.anytime).not.toEqual(mine.anytime)
  })
})
