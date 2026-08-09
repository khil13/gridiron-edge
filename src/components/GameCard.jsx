import TeamMark from './TeamMark.jsx'
import EdgeRail from './EdgeRail.jsx'
import { Badge } from './Controls.jsx'
import { getTeam } from '../data/teams.js'
import { recordOf } from '../data/season2025.js'
import { fmtSpread, fmtOdds, fmtKickoff, fmtPct, relativeDay } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * One game, at a glance: who is playing, who is winning, what the market
 * charges, and whether the model disagrees enough to care.
 */
export default function GameCard({ game }) {
  const { home, away, status, projection, market, topPlay } = game
  const isFinal = status === 'final'
  const isLive = status === 'live'
  const consensus = market?.books?.find((b) => b.sharp) || market?.books?.[0]

  const homeWon = isFinal && game.homeScore > game.awayScore
  const awayWon = isFinal && game.awayScore > game.homeScore

  const strap = isLive
    ? `Q${game.period ?? 1} · ${game.clock ?? ''}`
    : isFinal
      ? game.title || 'Final'
      : `${relativeDay(game.kickoff) ?? ''} ${fmtKickoff(game.kickoff)}`.trim()

  return (
    <a className="gcard" href={href(`game/${game.id}`)}>
      <div className="gcard-strap">
        <span className="row gap-2">
          {isLive && <span className="live-dot" />}
          {strap}
        </span>
        {topPlay?.qualified ? (
          <Badge tone="edge">{`+${(topPlay.ev * 100).toFixed(1)}% EV`}</Badge>
        ) : game.venue ? (
          <span className="truncate" style={{ maxWidth: 130 }}>{game.venue}</span>
        ) : null}
      </div>

      <div className="gcard-body">
        <TeamRow
          abbr={away}
          score={game.awayScore}
          showScore={isFinal || isLive}
          dimmed={isFinal && !awayWon}
          price={consensus ? fmtSpread(consensus.spread.away.line) : null}
          winProb={projection?.awayWinProb}
        />
        <TeamRow
          abbr={home}
          score={game.homeScore}
          showScore={isFinal || isLive}
          dimmed={isFinal && !homeWon}
          price={consensus ? fmtSpread(consensus.spread.home.line) : null}
          winProb={projection?.homeWinProb}
        />

        {!isFinal && market && projection && (
          <div className="rail-wrap">
            <div className="row spread-between" style={{ marginBottom: 2 }}>
              <span className="eyebrow" style={{ color: 'var(--gold)' }}>Market</span>
              <span className="eyebrow" style={{ color: 'var(--sky)' }}>Model</span>
            </div>
            <EdgeRail
              marketLine={consensus.spread.home.line}
              modelLine={projection.modelSpreadHome}
              home={home}
              away={away}
              compact
            />
            {topPlay && (
              <div className="row spread-between" style={{ marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {topPlay.qualified ? 'Best play' : 'No qualifying edge'}
                </span>
                <span className="mono" style={{ fontSize: 11 }}>
                  {topPlay.qualified ? (
                    <>
                      <span style={{ color: 'var(--bone)' }}>{topPlay.label}</span>{' '}
                      <span className="market">{fmtOdds(topPlay.price)}</span>{' '}
                      <span className="dim">{topPlay.book}</span>
                    </>
                  ) : (
                    <span className="dim">market agrees within {Math.abs(topPlay.edgePoints).toFixed(1)} pts</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {isFinal && projection && (
          <div className="rail-wrap">
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              Model had {getTeam(home).abbr} {fmtPct(projection.homeWinProb, 0)} pregame
            </span>
          </div>
        )}
      </div>
    </a>
  )
}

function TeamRow({ abbr, score, showScore, dimmed, price, winProb }) {
  const team = getTeam(abbr)
  const rec = recordOf(abbr)
  return (
    <div className={`team-line${dimmed ? ' lost' : ''}`}>
      <TeamMark abbr={abbr} size={26} />
      <span className="grow truncate">
        <span className="team-name">{team.location} </span>
        <span className="team-name">{team.name}</span>
        {rec && <span className="team-rec"> {rec.w}-{rec.l}</span>}
      </span>
      {showScore ? (
        <span className="team-score">{score ?? 0}</span>
      ) : (
        <span className="price-chip">{price}</span>
      )}
      {!showScore && winProb != null && (
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', minWidth: '3.5ch', textAlign: 'right' }}>
          {Math.round(winProb * 100)}%
        </span>
      )}
    </div>
  )
}
