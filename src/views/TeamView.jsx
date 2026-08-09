import TeamMark from '../components/TeamMark.jsx'
import GameCard from '../components/GameCard.jsx'
import { Badge, Empty } from '../components/Controls.jsx'
import { IconBack } from '../components/Icons.jsx'
import { getTeam } from '../data/teams.js'
import { SEASON_2025, recordOf } from '../data/season2025.js'
import { fmtSigned, tint, readable } from '../lib/format.js'
import { href } from '../lib/router.js'

export default function TeamView({ abbr, data }) {
  const team = getTeam(abbr)
  const rating = data.ratings[abbr]
  const record = recordOf(abbr)
  const rank = data.rankings.find((r) => r.abbr === abbr)

  if (!rating) {
    return <div className="page"><Empty title="Unknown team">No rating exists for “{abbr}”.</Empty></div>
  }

  const upcoming = data.games.filter((g) => g.home === abbr || g.away === abbr)
  const lastSeason = SEASON_2025.results.filter((g) => g.home === abbr || g.away === abbr)

  return (
    <div className="page">
      <a className="btn ghost" href={href('teams')} style={{ marginBottom: 'var(--s4)' }}>
        <IconBack width={14} height={14} /> All teams
      </a>

      <header
        className="panel"
        style={{
          padding: 'var(--s5)',
          marginBottom: 'var(--s5)',
          background: `linear-gradient(110deg, ${tint(team.primary, 0.28)}, transparent 70%)`,
          borderColor: tint(team.primary, 0.4)
        }}
      >
        <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
          <TeamMark abbr={abbr} size={64} />
          <div className="grow" style={{ minWidth: 200 }}>
            <div className="eyebrow">{team.conference} {team.division}</div>
            <h1 style={{ fontSize: 'var(--t-2xl)', margin: '4px 0' }}>
              {team.location} <span style={{ color: readable(team.primary) }}>{team.name}</span>
            </h1>
            <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
              <span className="mono dim">{record.w}-{record.l} in 2025</span>
              <Badge tone={record.result?.startsWith('Won') ? 'chalk' : 'quiet'}>{record.result}</Badge>
            </div>
          </div>
          <div className="row gap-5">
            <Metric label="Power rank" value={`#${rank.rank}`} />
            <Metric label="Rating" value={Math.round(rating.elo)} />
            <Metric label="vs average" value={fmtSigned(rating.pointsVsAverage)} tone={rating.pointsVsAverage > 0 ? 'pos' : 'neg'} />
          </div>
        </div>
      </header>

      <h2 style={{ fontSize: 'var(--t-lg)', marginBottom: 'var(--s3)' }}>Next up</h2>
      {upcoming.length ? (
        <div className="card-grid" style={{ marginBottom: 'var(--s6)' }}>
          {upcoming.map((g) => <GameCard key={g.id} game={g} />)}
        </div>
      ) : (
        <div style={{ marginBottom: 'var(--s6)' }}>
          <Empty title="No games on this slate">
            {team.name} do not appear in the currently loaded schedule.
          </Empty>
        </div>
      )}

      {lastSeason.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>2025 results</h2>
            <span className="eyebrow">Week 18 and postseason</span>
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Round</th><th style={{ textAlign: 'left' }}>Opponent</th><th>Result</th><th>Score</th></tr></thead>
              <tbody>
                {lastSeason.map((g) => {
                  const isHome = g.home === abbr
                  const opp = isHome ? g.away : g.home
                  const my = isHome ? g.homeScore : g.awayScore
                  const their = isHome ? g.awayScore : g.homeScore
                  const won = my > their
                  return (
                    <tr key={g.id}>
                      <td>{g.title || g.round}</td>
                      <td style={{ textAlign: 'left' }}>
                        <a className="row gap-2" href={href(`team/${opp}`)}>
                          <span className="dim mono" style={{ fontSize: 11 }}>{isHome ? 'vs' : '@'}</span>
                          <TeamMark abbr={opp} size={18} />
                          <span>{getTeam(opp).name}</span>
                        </a>
                      </td>
                      <td className={won ? 'pos' : 'neg'}>{won ? 'W' : 'L'}</td>
                      <td className="num">{my}–{their}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 2 }}>{label}</div>
      <div className={tone || ''} style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--t-xl)' }}>
        {value}
      </div>
    </div>
  )
}
