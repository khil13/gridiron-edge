import { useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Segmented, Badge } from '../components/Controls.jsx'
import { SEASON_2025 } from '../data/season2025.js'
import { getTeam, DIVISIONS } from '../data/teams.js'
import { fmtSigned } from '../lib/format.js'
import { href } from '../lib/router.js'

export default function StandingsView({ data }) {
  const [conf, setConf] = useState('AFC')
  const [group, setGroup] = useState('division')

  const teams = SEASON_2025.standings
    .map((row) => ({ ...row, team: getTeam(row.abbr), rating: data.ratings[row.abbr] }))
    .filter((row) => row.team.conference === conf)

  const sortByRecord = (a, b) => b.w - a.w || (a.seed ?? 99) - (b.seed ?? 99)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">2025 final · {SEASON_2025.champion} won Super Bowl LX</div>
          <h1 className="page-title">Standings</h1>
        </div>
        <div className="row gap-3">
          <Segmented label="Conference" value={conf} onChange={setConf}
                     options={[{ value: 'AFC', label: 'AFC' }, { value: 'NFC', label: 'NFC' }]} />
          <Segmented label="Grouping" value={group} onChange={setGroup}
                     options={[{ value: 'division', label: 'Division' }, { value: 'conference', label: 'Conference' }]} />
        </div>
      </header>

      {group === 'conference' ? (
        <Table rows={[...teams].sort(sortByRecord)} title={`${conf} — all 16`} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
          {DIVISIONS.map((div) => (
            <Table
              key={div}
              title={`${conf} ${div}`}
              rows={teams.filter((t) => t.team.division === div).sort(sortByRecord)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Table({ rows, title }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: 'var(--t-base)' }}>{title}</h2>
        <span className="eyebrow">2026 rating</span>
      </div>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>Seed</th><th>Rating</th><th>vs Avg</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.abbr}>
                <td>
                  <a className="row gap-3" href={href(`team/${r.abbr}`)}>
                    <TeamMark abbr={r.abbr} size={20} />
                    <span className="team-name truncate">{r.team.location} {r.team.name}</span>
                    {r.result?.startsWith('Won') && <Badge tone="chalk">Champs</Badge>}
                  </a>
                </td>
                <td className="num">{r.w}</td>
                <td className="num">{r.l}</td>
                <td className="num dim">{(r.w / (r.w + r.l)).toFixed(3).slice(1)}</td>
                <td className="num dim">{r.seed ?? '—'}</td>
                <td className="num">{r.rating ? Math.round(r.rating.elo) : '—'}</td>
                <td className={`num ${r.rating?.pointsVsAverage > 0 ? 'pos' : 'neg'}`}>
                  {r.rating ? fmtSigned(r.rating.pointsVsAverage) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
