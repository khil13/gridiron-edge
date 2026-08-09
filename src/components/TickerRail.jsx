import TeamMark from './TeamMark.jsx'
import { fmtShortDay, fmtTime, fmtSpread } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * The score strip. Always present, always scrollable, never in the way —
 * the one thing a sports app is judged on before anything else loads.
 */
export default function TickerRail({ games }) {
  if (!games.length) return null

  return (
    <div className="ticker">
      <div className="ticker-scroll" role="list" aria-label="Scores">
        {games.map((g) => {
          const live = g.status === 'live'
          const final = g.status === 'final'
          const homeWon = final && g.homeScore > g.awayScore
          const awayWon = final && g.awayScore > g.homeScore
          const line = g.market?.books?.[0]?.spread?.home?.line

          return (
            <a className="tick" key={g.id} href={href(`game/${g.id}`)} role="listitem">
              <div className="tick-meta">
                {live && <span className="live-dot" />}
                {live ? `Q${g.period ?? 1} ${g.clock ?? ''}` : final ? 'Final' : `${fmtShortDay(g.kickoff)} ${fmtTime(g.kickoff)}`}
              </div>

              <div className={`tick-row${final && !awayWon ? ' lost' : ''}`}>
                <span className="row gap-2" style={{ minWidth: 0 }}>
                  <TeamMark abbr={g.away} size={15} />
                  <span className="tick-team">{g.away}</span>
                </span>
                <span className="tick-score">
                  {final || live ? (g.awayScore ?? 0) : line != null ? fmtSpread(-line) : ''}
                </span>
              </div>

              <div className={`tick-row${final && !homeWon ? ' lost' : ''}`}>
                <span className="row gap-2" style={{ minWidth: 0 }}>
                  <TeamMark abbr={g.home} size={15} />
                  <span className="tick-team">{g.home}</span>
                </span>
                <span className="tick-score">
                  {final || live ? (g.homeScore ?? 0) : line != null ? fmtSpread(line) : ''}
                </span>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}
