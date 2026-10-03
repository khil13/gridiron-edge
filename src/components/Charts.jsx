import { useId } from 'react'
import { readable } from '../lib/format.js'

/**
 * Win probability over the course of a game. Drawn from the home team's
 * perspective: above the centre line is the home side.
 */
export function WinProbChart({ path, homeColor, awayColor, height = 140, live = false }) {
  const gid = useId()
  if (!path?.length) return null

  const w = 100
  const h = 100
  const x = (t) => (t / 60) * w
  const y = (p) => (1 - p) * h

  const line = path.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(2)} ${y(d.p).toFixed(2)}`).join(' ')
  const areaTop = `${line} L${w} 50 L0 50 Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img"
         aria-label="Win probability over time">
      <defs>
        <clipPath id={`${gid}-above`}><rect x="0" y="0" width={w} height="50" /></clipPath>
        <clipPath id={`${gid}-below`}><rect x="0" y="50" width={w} height="50" /></clipPath>
      </defs>

      {[25, 50, 75].map((v) => (
        <line key={v} x1="0" x2={w} y1={v} y2={v} stroke="var(--line)" strokeWidth="0.4"
              strokeDasharray={v === 50 ? '0' : '1.5 1.5'} vectorEffect="non-scaling-stroke" />
      ))}
      {[15, 30, 45].map((q) => (
        <line key={q} x1={x(q)} x2={x(q)} y1="0" y2={h} stroke="var(--line)" strokeWidth="0.4"
              vectorEffect="non-scaling-stroke" />
      ))}

      <path d={areaTop} fill={readable(homeColor)} opacity="0.22" clipPath={`url(#${gid}-above)`} />
      <path d={areaTop} fill={readable(awayColor)} opacity="0.22" clipPath={`url(#${gid}-below)`} />
      <path d={line} fill="none" stroke="var(--bone)" strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round" />

      {live && (
        <circle cx={x(path[path.length - 1].t)} cy={y(path[path.length - 1].p)} r="1.8" fill="var(--flare)" />
      )}
    </svg>
  )
}

/** Line movement since the market opened. Steeper means sharper action. */
export function Sparkline({ values, height = 34, color = 'var(--gold)' }) {
  if (!values?.length || values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100
    const y = 100 - ((v - min) / range) * 80 - 10
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="100" cy={pts[pts.length - 1].split(',')[1]} r="2.4" fill={color} />
    </svg>
  )
}

/** Two-sided probability bar in the two teams' colours. */
export function ProbBar({ home, away, homeColor, awayColor }) {
  return (
    <div className="probbar" role="img" aria-label={`Home ${(home * 100).toFixed(0)} percent`}>
      <span style={{ width: `${away * 100}%`, background: readable(awayColor) }} />
      <span style={{ width: `${home * 100}%`, background: readable(homeColor) }} />
    </div>
  )
}

/**
 * A simulated distribution — simulation.js's margin/total/score histograms
 * — as vertical bars. A single projection number hides how much spread
 * sits around it; this is the "show the distribution, not just one number"
 * counterpart to that number.
 */
export function Histogram({ bins, markValue, markLabel, height = 90, color = 'var(--gold)' }) {
  if (!bins?.length) return null
  const max = Math.max(...bins.map((b) => b.count), 1)
  const n = bins.length
  const gap = 0.12
  const barW = (100 / n) * (1 - gap)

  const markX = markValue != null
    ? (() => {
        const lo = bins[0].lo
        const hi = bins[bins.length - 1].hi
        if (hi === lo) return null
        return ((markValue - lo) / (hi - lo)) * 100
      })()
    : null

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height }} role="img"
         aria-label="Simulated distribution">
      {bins.map((b, i) => {
        const h = (b.count / max) * 92
        const x = (i / n) * 100 + (100 / n) * (gap / 2)
        return <rect key={b.lo} x={x} y={100 - h} width={barW} height={h} fill={readable(color)} opacity="0.55" />
      })}
      {markX != null && markX >= 0 && markX <= 100 && (
        <line x1={markX} x2={markX} y1="0" y2="100" stroke="var(--bone)" strokeWidth="1.2"
              vectorEffect="non-scaling-stroke" strokeDasharray="2 1.5" aria-label={markLabel} />
      )}
    </svg>
  )
}

/** Head-to-head stat comparison row. */
export function StatBar({ label, away, home, awayColor, homeColor, format = (v) => v }) {
  const total = Math.abs(away) + Math.abs(home) || 1
  return (
    <div className="statbar">
      <span className="statbar-val" style={{ textAlign: 'left' }}>{format(away)}</span>
      <div>
        <div className="statbar-label" style={{ marginBottom: 4 }}>{label}</div>
        <div className="statbar-track">
          <span style={{ width: `${(Math.abs(away) / total) * 100}%`, background: readable(awayColor) }} />
          <span style={{ width: `${(Math.abs(home) / total) * 100}%`, background: readable(homeColor) }} />
        </div>
      </div>
      <span className="statbar-val" style={{ textAlign: 'right' }}>{format(home)}</span>
    </div>
  )
}
