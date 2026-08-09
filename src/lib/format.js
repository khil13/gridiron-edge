/** Display helpers. Every number in the UI passes through here. */

export const fmtOdds = (n) =>
  n == null ? '—' : n > 0 ? `+${n}` : `${n}`

export const fmtSpread = (n) => {
  if (n == null) return '—'
  if (n === 0) return 'PK'
  return n > 0 ? `+${n}` : `${n}`
}

export const fmtPct = (p, digits = 1) =>
  p == null || Number.isNaN(p) ? '—' : `${(p * 100).toFixed(digits)}%`

export const fmtSigned = (n, digits = 1) => {
  if (n == null || Number.isNaN(n)) return '—'
  const v = n.toFixed(digits)
  return n > 0 ? `+${v}` : v
}

export const fmtMoney = (n) =>
  n == null ? '—' : `$${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2)}`

export const fmtRecord = (w, l, t = 0) => (t ? `${w}-${l}-${t}` : `${w}-${l}`)

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const shortDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

export const fmtTime = (iso) => timeFmt.format(new Date(iso))
export const fmtDay = (iso) => dayFmt.format(new Date(iso))
export const fmtShortDay = (iso) => shortDayFmt.format(new Date(iso))
export const fmtKickoff = (iso) => `${fmtShortDay(iso)} ${fmtTime(iso)}`

export const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10)

export const relativeDay = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  const days = Math.round((d.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return null
}

/** Mix a team colour toward the page background so it never blinds. */
export const tint = (hex, alpha = 0.16) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Team colours can be near-black; lift those so they read on a dark page. */
export const readable = (hex) => {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum > 0.28) return hex
  const lift = (c) => Math.round(c + (255 - c) * 0.42)
  return `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`
}
