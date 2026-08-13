import { getTeam } from '../data/teams.js'
import { fmtSpread } from '../lib/format.js'
import { KEY_NUMBERS } from '../lib/odds.js'

/**
 * The Edge Rail — this app's one signature object.
 *
 * A number line for a single game. The gold pin above the axis is where the
 * market has it; the blue pin below is where the model has it. The shaded
 * band between them is the disagreement, and its width is the entire
 * argument for or against a bet.
 */
export default function EdgeRail({
  marketLine, modelLine, home, away, compact = false,
  keyNumbers = KEY_NUMBERS, describe, format = fmtSpread
}) {
  if (marketLine == null || modelLine == null) return null

  const rounded = Math.round(modelLine * 10) / 10
  const mid = (marketLine + modelLine) / 2
  const gap = Math.abs(marketLine - modelLine)
  const span = Math.max(7, gap * 2.6 + 5)
  const lo = mid - span / 2
  const hi = mid + span / 2
  const pos = (v) => ((v - lo) / (hi - lo)) * 100

  const marketAt = pos(marketLine)
  const modelAt = pos(modelLine)

  const ticks = []
  for (let n = Math.ceil(lo); n <= Math.floor(hi); n++) ticks.push(n)

  const bandLeft = Math.min(marketAt, modelAt)
  const bandWidth = Math.max(Math.abs(marketAt - modelAt), 0.4)
  const modelFavoursHome = modelLine < marketLine
  const favourite = marketLine < 0 ? getTeam(home).abbr : getTeam(away).abbr

  return (
    <div className={`edge-rail${compact ? ' compact' : ' wide'}`}>
      <div className="edge-axis" />

      {ticks.map((n) => {
        const key = keyNumbers.includes(Math.abs(n))
        const crowded = Math.abs(pos(n) - marketAt) < 7
        return (
          <span key={n}>
            <span className={`edge-tick${key ? ' key' : ''}`} style={{ left: `${pos(n)}%` }} />
            {!compact && key && !crowded && (
              <span className="edge-tick-label" style={{ left: `${pos(n)}%` }}>
                {format(n)}
              </span>
            )}
          </span>
        )
      })}

      <div className="edge-band" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />

      <div className="edge-pin market" style={{ left: `${marketAt}%` }} />
      <span className="edge-flag market" style={{ left: `${marketAt}%` }}>{format(marketLine)}</span>

      <div className="edge-pin model" style={{ left: `${modelAt}%` }} />
      <span className="edge-flag model" style={{ left: `${modelAt}%` }}>{format(rounded)}</span>

      <span className="sr-only">
        {describe
          ? describe(marketLine, rounded, gap)
          : `Market has ${favourite} favoured at ${fmtSpread(marketLine)}. The model projects ${fmtSpread(rounded)}, a gap of ${gap.toFixed(1)} points ${modelFavoursHome ? 'toward the home side' : 'toward the away side'}.`}
      </span>
    </div>
  )
}
