import { getTeam } from '../data/teams.js'
import { readable } from '../lib/format.js'

/**
 * The field, with the ball on it.
 *
 * A down-and-distance in text tells you the situation; seeing where the ball
 * actually sits tells you what it means. "3rd and 8" reads very differently
 * on your own 12 than on the opponent's 30, and a line of text does not
 * carry that.
 *
 * Everything drawn here comes from the feed. When field position is missing
 * the component renders nothing rather than putting the ball at midfield and
 * hoping — a wrong ball position is worse than no field.
 */
export default function FieldGraphic({ situation, home, away }) {
  const spot = absoluteSpot(situation, home, away)
  if (spot == null) return null

  const possessing = situation.possession
  const defending = possessing === home ? away : home
  const posTeam = getTeam(possessing)
  const defTeam = getTeam(defending)

  // Several matchups are two clubs with near-identical primaries — New
  // England and Seattle are both #002244 — which renders the two end zones
  // indistinguishable and makes the whole graphic useless. When that
  // happens the defending side falls back to its secondary.
  const [posColor, defColor] = distinguish(posTeam, defTeam)

  // The possessing team drives left to right, always. Flipping the field to
  // match broadcast direction would be more literal and much harder to read
  // at a glance.
  const x = (yards) => 10 + (yards / 100) * 80
  const ballX = x(spot)

  // First-down marker, when there is one and it is on the field.
  const toGo = Number(situation.distance)
  const firstDown = Number.isFinite(toGo) && toGo > 0 && spot + toGo <= 100
    ? spot + toGo
    : null

  return (
    <div style={{ padding: 'var(--s3) 0' }}>
      <svg viewBox="0 0 100 30" style={{ width: '100%', height: 'auto' }} role="img"
           aria-label={describe(situation, spot, posTeam, defTeam)}>
        {/* End zones */}
        <rect x="0" y="4" width="10" height="20" fill={defColor} opacity="0.55" />
        <rect x="90" y="4" width="10" height="20" fill={posColor} opacity="0.55" />

        {/* Field */}
        <rect x="10" y="4" width="80" height="20" fill="var(--slab-hi)" />

        {/* Every ten yards, with midfield heavier */}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yards) => (
          <line
            key={yards}
            x1={x(yards)} x2={x(yards)} y1="4" y2="24"
            stroke={yards === 50 ? 'var(--line-hi)' : 'var(--line)'}
            strokeWidth={yards === 50 ? 0.5 : 0.3}
          />
        ))}

        {/* Yard numbers count down from midfield, as they do on a real field */}
        {[20, 40, 60, 80].map((yards) => (
          <text
            key={yards}
            x={x(yards)} y="16.5"
            textAnchor="middle"
            fill="var(--faint)"
            style={{ fontSize: 4, fontFamily: 'var(--font-mono)' }}
          >
            {yards > 50 ? 100 - yards : yards}
          </text>
        ))}

        {/* Line to gain */}
        {firstDown != null && (
          <line
            x1={x(firstDown)} x2={x(firstDown)} y1="4" y2="24"
            stroke="var(--gold)" strokeWidth="0.7" strokeDasharray="1.5 1"
          />
        )}

        {/* Line of scrimmage and the ball */}
        <line x1={ballX} x2={ballX} y1="2" y2="26" stroke="var(--bone)" strokeWidth="0.7" />
        <ellipse cx={ballX} cy="14" rx="2.2" ry="1.5" fill="var(--bone)" />

        {/* Which way they are going */}
        <path
          d={`M ${ballX + 4} 28 L ${ballX + 8} 28 M ${ballX + 7} 27 L ${ballX + 8} 28 L ${ballX + 7} 29`}
          stroke="var(--muted)" strokeWidth="0.4" fill="none"
        />

        {/* End zone labels */}
        <text x="5" y="16" textAnchor="middle" fill="var(--bone-dim)"
              style={{ fontSize: 3.4, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          {defending}
        </text>
        <text x="95" y="16" textAnchor="middle" fill="var(--bone-dim)"
              style={{ fontSize: 3.4, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          {possessing}
        </text>
      </svg>

      <div className="row spread-between" style={{ marginTop: 'var(--s2)' }}>
        <span className="mono" style={{ fontSize: 'var(--t-base)' }}>
          {situation.downDistance || '—'}
        </span>
        <span className="dim mono" style={{ fontSize: 12 }}>
          {situation.fieldPosition || `${spot} yards from own goal`}
        </span>
      </div>
    </div>
  )
}

/** Perceptual-ish distance between two hex colours. */
function colourGap(a, b) {
  const rgb = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  // Weighted to how the eye actually reads difference.
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2)
}

/** Two colours far enough apart to tell the end zones apart. */
function distinguish(posTeam, defTeam) {
  const pos = readable(posTeam.primary)
  let def = readable(defTeam.primary)
  if (colourGap(posTeam.primary, defTeam.primary) < 90) {
    def = readable(defTeam.secondary || defTeam.primary)
  }
  return [pos, def]
}

/**
 * Where the ball is, in yards from the possessing team's own goal line.
 *
 * The feed describes field position as a team and a number — "NE 5" — which
 * is ambiguous without knowing who has the ball: NE's own five is a very
 * different place from NE's opponent's five. So the text is resolved against
 * the possessing team rather than trusted on its own.
 */
export function absoluteSpot(situation, home, away) {
  if (!situation) return null
  const { possession, fieldPosition } = situation

  const text = String(fieldPosition ?? '').trim()
  const match = text.match(/^([A-Z]{2,3})\s+(\d{1,2})$/i)
  if (match && possession) {
    const side = match[1].toUpperCase()
    const yard = Number(match[2])
    if (side !== home && side !== away) return null
    // On their own side of the field the number is the distance from their
    // own goal; on the other side it is the distance from the opponent's.
    return side === possession ? yard : 100 - yard
  }

  // Some payloads carry a bare midfield marker.
  if (/^(mid|50)$/i.test(text)) return 50

  const raw = Number(situation.yardLine)
  if (Number.isFinite(raw) && raw >= 0 && raw <= 100) return raw

  return null
}

function describe(situation, spot, posTeam, defTeam) {
  const where = spot < 50
    ? `${posTeam.abbr}'s own ${spot}`
    : spot === 50 ? 'midfield' : `${defTeam.abbr}'s ${100 - spot}`
  return `${posTeam.full} have the ball at ${where}. ${situation.downDistance ?? ''}`
}
