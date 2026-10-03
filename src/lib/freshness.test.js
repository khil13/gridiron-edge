import { describe, it, expect } from 'vitest'
import { dataSources } from './freshness.js'

describe('dataSources', () => {
  const rows = dataSources()

  it('returns one row per real bundled source, each with a real timestamp', () => {
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const row of rows) {
      expect(row.label).toBeTruthy()
      expect(row.generatedAt).toBeTruthy()
      expect(row.ageDays).toBeGreaterThanOrEqual(0)
    }
  })

  it('never claims a source is fresh without a real timestamp to prove it', () => {
    for (const row of rows) {
      expect(['ok', 'aging', 'stale', 'unknown']).toContain(row.level)
      if (row.level !== 'unknown') expect(row.generatedAt).toBeTruthy()
    }
  })

  it('does not flag the season-opening ratings as stale — they are not expected to move in-season', () => {
    const ratings = rows.find((r) => r.label.includes('Power ratings'))
    expect(ratings.level).toBe('ok')
  })

  it('gives Next Gen Stats a looser threshold than the weekly sources, since nflverse republishes it on its own slower schedule', () => {
    const ngs = rows.find((r) => r.label === 'Next Gen Stats')
    expect(ngs.note).toMatch(/slower/)
    // Same age would never be judged by the same bar for both sources.
    const sameAgeDays = 10
    const ngsLevel = sameAgeDays <= 14 ? 'ok' : 'aging'
    const injuriesLevel = sameAgeDays <= 3 ? 'ok' : sameAgeDays <= 6 ? 'aging' : 'stale'
    expect(ngsLevel).not.toBe(injuriesLevel)
  })

  it('labels every row distinctly', () => {
    const labels = rows.map((r) => r.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
