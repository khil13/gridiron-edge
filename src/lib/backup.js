/**
 * backup.js — get your record out of the browser.
 *
 * Locked cards, graded results and model settings live in localStorage and
 * nowhere else. Clearing site data, switching device, or using a private
 * window loses a season's evidence about whether the model works — which is
 * the one thing the app exists to find out.
 *
 * The API key is deliberately NOT included. An export is something people
 * email themselves or drop in cloud storage, and a credential should not
 * travel in it.
 */

import { load, save } from './storage.js'

export const BACKUP_VERSION = 1

const KEYS = ['settings', 'lockedCards', 'tickets', 'mode']

export function buildBackup() {
  const data = {}
  for (const key of KEYS) data[key] = load(key, null)

  const cards = data.lockedCards ?? []
  return {
    format: 'gridiron-edge-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    summary: {
      lockedCards: cards.length,
      plays: cards.reduce((n, c) => n + (c.legs?.length ?? 0), 0),
      earliest: cards.map((c) => c.dayKey).sort()[0] ?? null,
      latest: cards.map((c) => c.dayKey).sort().pop() ?? null
    },
    data
  }
}

/** Trigger a download. Kept here so views do not touch the DOM directly. */
export function downloadBackup() {
  const backup = buildBackup()
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `gridiron-edge-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return backup.summary
}

/**
 * Restore from a file.
 *
 * Merges rather than replaces by default: importing a backup on a device
 * that already has cards should not silently delete them. Cards are keyed by
 * day, and the imported copy wins on a clash because it is the one the user
 * just chose to bring in.
 */
export function restoreBackup(parsed, { merge = true } = {}) {
  if (!parsed || parsed.format !== 'gridiron-edge-backup') {
    throw new Error('That does not look like a Gridiron Edge backup.')
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(`That backup was written by a newer version (v${parsed.version}).`)
  }

  const incoming = parsed.data ?? {}
  const report = { settings: false, lockedCards: 0, tickets: 0 }

  if (incoming.settings) {
    save('settings', incoming.settings)
    report.settings = true
  }

  if (Array.isArray(incoming.lockedCards)) {
    const existing = merge ? load('lockedCards', []) : []
    const byDay = new Map(existing.map((c) => [c.dayKey, c]))
    for (const card of incoming.lockedCards) byDay.set(card.dayKey, card)
    const merged = [...byDay.values()].sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1))
    save('lockedCards', merged)
    report.lockedCards = merged.length
  }

  if (Array.isArray(incoming.tickets)) {
    const existing = merge ? load('tickets', []) : []
    const seen = new Set(existing.map((t) => t.id))
    const merged = [...existing, ...incoming.tickets.filter((t) => !seen.has(t.id))]
    save('tickets', merged)
    report.tickets = merged.length
  }

  if (incoming.mode) save('mode', incoming.mode)

  return report
}

/** Parse an uploaded file. */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result))) }
      catch { reject(new Error('That file is not valid JSON.')) }
    }
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsText(file)
  })
}
