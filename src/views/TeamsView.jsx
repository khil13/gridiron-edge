import TeamMark from '../components/TeamMark.jsx'
import { TEAM_LIST, CONFERENCES, DIVISIONS } from '../data/teams.js'
import { recordOf } from '../data/season2025.js'
import { fmtSigned, tint } from '../lib/format.js'
import { href } from '../lib/router.js'

export default function TeamsView({ data }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">All 32 · ordered by 2026 opening rating</div>
          <h1 className="page-title">Teams</h1>
        </div>
      </header>

      {CONFERENCES.map((conf) => (
        <section key={conf} style={{ marginBottom: 'var(--s6)' }}>
          <h2 style={{ fontSize: 'var(--t-lg)', marginBottom: 'var(--s3)' }}>{conf}</h2>
          <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {DIVISIONS.map((div) => {
              const teams = TEAM_LIST
                .filter((t) => t.conference === conf && t.division === div)
                .sort((a, b) => (data.ratings[b.abbr]?.elo ?? 0) - (data.ratings[a.abbr]?.elo ?? 0))
              return (
                <div className="panel" key={div}>
                  <div className="panel-head"><h3 style={{ fontSize: 'var(--t-small)' }}>{conf} {div}</h3></div>
                  <div>
                    {teams.map((t) => {
                      const rec = recordOf(t.abbr)
                      const r = data.ratings[t.abbr]
                      return (
                        <a
                          key={t.abbr}
                          href={href(`team/${t.abbr}`)}
                          className="row gap-3"
                          style={{
                            padding: 'var(--s3) var(--s4)',
                            borderBottom: '1px solid rgba(35,47,58,0.6)',
                            background: `linear-gradient(90deg, ${tint(t.primary, 0.13)}, transparent 55%)`
                          }}
                        >
                          <TeamMark abbr={t.abbr} size={26} />
                          <span className="grow truncate">
                            <span className="team-name">{t.name}</span>
                            <span className="team-rec"> {rec ? `${rec.w}-${rec.l}` : ''}</span>
                          </span>
                          <span className={`mono ${r?.pointsVsAverage > 0 ? 'pos' : 'neg'}`} style={{ fontSize: 12 }}>
                            {r ? fmtSigned(r.pointsVsAverage) : '—'}
                          </span>
                        </a>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
