import { useState, useMemo } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Segmented, Badge } from '../components/Controls.jsx'
import { SEASON_2025 } from '../data/season2025.js'
import { getTeam, DIVISIONS, CONFERENCES } from '../data/teams.js'
import { fmtSigned, tint } from '../lib/format.js'
import { movers } from '../lib/ratings.js'
import { href } from '../lib/router.js'

/**
 * Teams.
 *
 * This used to be two tabs — "Teams" and "Table" — which showed the same
 * thirty-two clubs grouped the same way, one just with fewer columns. They
 * answered the same question twice and neither answered it well.
 *
 * There are two genuinely different questions here, so they get two views:
 *
 *   Standings — how last season actually finished. Record, seed, how far
 *               they went. History, and settled.
 *   Power     — how good the model thinks each team is NOW, ranked across
 *               the whole league rather than by division. This is what the
 *               projections are built on, so it belongs here rather than
 *               buried among the model's settings.
 */
export default function TeamsView({ data, initialView }) {
  // Addressable so the power table can be linked to directly, e.g. from
  // Model lab's explanation of where the ratings come from.
  const [view, setView] = useState(initialView === 'power' ? 'power' : 'standings')
  const [conf, setConf] = useState('AFC')

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            {view === 'standings'
              ? `2025 final · ${SEASON_2025.champion} won Super Bowl LX`
              : data.ratingsState?.applied
                ? `Current ratings · ${data.ratingsState.applied} games replayed`
                : '2026 opening ratings · all 32 ranked'}
          </div>
          <h1 className="page-title">Teams</h1>
        </div>
        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'standings', label: 'Standings' },
              { value: 'power', label: 'Power' }
            ]}
          />
          {view === 'standings' && (
            <Segmented
              label="Conference"
              value={conf}
              onChange={setConf}
              options={[{ value: 'AFC', label: 'AFC' }, { value: 'NFC', label: 'NFC' }]}
            />
          )}
        </div>
      </header>

      {view === 'standings' ? <Standings conf={conf} data={data} /> : <Power data={data} />}
    </div>
  )
}

/* ---------- Standings: last season, by division ---------- */

function Standings({ conf, data }) {
  const teams = SEASON_2025.standings
    .map((row) => ({ ...row, team: getTeam(row.abbr), rating: data.ratings[row.abbr] }))
    .filter((row) => row.team.conference === conf)

  const byRecord = (a, b) => b.w - a.w || (a.seed ?? 99) - (b.seed ?? 99)

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
      {DIVISIONS.map((div) => (
        <section className="panel" key={div}>
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>{conf} {div}</h2>
            <span className="eyebrow">2026 rating</span>
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Team</th><th>W</th><th>L</th>
                  <th className="hide-sm">PCT</th>
                  <th className="hide-sm">Seed</th>
                  <th>Rating</th><th>vs Avg</th>
                </tr>
              </thead>
              <tbody>
                {teams.filter((t) => t.team.division === div).sort(byRecord).map((r) => (
                  <tr key={r.abbr}>
                    <td>
                      <a className="row gap-3" href={href(`team/${r.abbr}`)}>
                        <TeamMark abbr={r.abbr} size={20} />
                        <span className="team-name truncate">
                          <span className="team-location-sm">{r.team.location} </span>{r.team.name}
                        </span>
                        {r.result?.startsWith('Won') && <Badge tone="chalk">Champs</Badge>}
                      </a>
                    </td>
                    <td className="num">{r.w}</td>
                    <td className="num">{r.l}</td>
                    <td className="num dim hide-sm">{(r.w / (r.w + r.l)).toFixed(3).slice(1)}</td>
                    <td className="num dim hide-sm">{r.seed ?? '—'}</td>
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
      ))}
    </div>
  )
}

/* ---------- Power: the model's current view, league-wide ---------- */

function Power({ data }) {
  const rows = data.rankings
  const state = data.ratingsState || {}
  const spread = useMemo(() => {
    const vals = rows.map((r) => Math.abs(r.pointsVsAverage))
    return Math.max(...vals, 1)
  }, [rows])
  const swing = useMemo(() => movers(data.ratings, 3), [data.ratings])

  return (
    <>
      <p className="dim" style={{ fontSize: 12, marginTop: 0, marginBottom: 'var(--s4)', maxWidth: '75ch' }}>
        Points relative to a league-average team on a neutral field. A team at +4 would be
        favoured by about four points against an average opponent, and by about seven at
        home. This is the number every projection in the app is built from.
      </p>

      {/* Ratings that changed under you without saying so would be worse than
          ratings that never changed at all. */}
      <div
        className="panel"
        style={{ padding: 'var(--s4)', marginBottom: 'var(--s4)' }}
      >
        <div className="row gap-3" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Badge tone={state.live && state.applied ? 'edge' : 'quiet'}>
            {state.loading ? 'Updating' : state.live && state.applied ? 'Current' : 'Opening only'}
          </Badge>
          <p className="dim grow" style={{ fontSize: 12, margin: 0, minWidth: 240, maxWidth: '75ch' }}>
            {state.error
              ? state.error
              : state.applied
                ? `Rebuilt from the opening ratings with ${state.applied} finished games replayed in order. Preseason results are excluded — they say almost nothing about a roster.`
                : 'No completed games yet this season, so these are the opening ratings: last season regressed toward the mean.'}
          </p>
        </div>

        {(swing.up.length > 0 || swing.down.length > 0) && (
          <div className="row gap-5" style={{ marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
            {swing.up.length > 0 && (
              <span className="mono" style={{ fontSize: 12 }}>
                <span className="eyebrow">Rising </span>
                {swing.up.map((m) => (
                  <span key={m.abbr} className="pos" style={{ marginRight: 10 }}>
                    {m.abbr} +{m.change}
                  </span>
                ))}
              </span>
            )}
            {swing.down.length > 0 && (
              <span className="mono" style={{ fontSize: 12 }}>
                <span className="eyebrow">Falling </span>
                {swing.down.map((m) => (
                  <span key={m.abbr} className="neg" style={{ marginRight: 10 }}>
                    {m.abbr} {m.change}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: 'var(--t-base)' }}>
            {state.applied ? 'Power ratings, current' : '2026 opening power ratings'}
          </h2>
          <span className="eyebrow">Points vs average</span>
        </div>
        <div>
          {rows.map((r) => {
            const team = getTeam(r.abbr)
            const pct = (Math.abs(r.pointsVsAverage) / spread) * 50
            const positive = r.pointsVsAverage > 0
            return (
              <a
                key={r.abbr}
                href={href(`team/${r.abbr}`)}
                className="row gap-3"
                style={{
                  padding: 'var(--s3) var(--s4)',
                  borderBottom: '1px solid rgba(35,47,58,0.6)',
                  background: `linear-gradient(90deg, ${tint(team.primary, 0.12)}, transparent 60%)`
                }}
              >
                <span className="mono dim" style={{ minWidth: '2ch', fontSize: 12 }}>{r.rank}</span>
                <TeamMark abbr={r.abbr} size={24} />
                <span className="grow truncate">
                  <span className="team-name">{team.name}</span>
                  <span className="team-rec"> {r.wins}-{r.losses}</span>
                </span>

                {/* A centre line with bars either side reads faster than a
                    column of signed numbers. */}
                <span className="pw-bar" style={{ display: 'flex', height: 6, alignItems: 'center' }}>
                  <span style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>
                    {!positive && (
                      <span style={{ width: `${pct * 2}%`, height: 6, background: 'var(--flare)', borderRadius: '99px 0 0 99px', opacity: 0.75 }} />
                    )}
                  </span>
                  <span style={{ width: 1, height: 10, background: 'var(--line-hi)' }} />
                  <span style={{ width: '50%' }}>
                    {positive && (
                      <span style={{ display: 'block', width: `${pct * 2}%`, height: 6, background: 'var(--mint)', borderRadius: '0 99px 99px 0', opacity: 0.75 }} />
                    )}
                  </span>
                </span>

                <span style={{ minWidth: '4.5ch', textAlign: 'right' }}>
                  <span className={`mono ${positive ? 'pos' : 'neg'}`} style={{ fontSize: 13 }}>
                    {fmtSigned(r.pointsVsAverage)}
                  </span>
                  {r.eloChange ? (
                    <span
                      className="mono dim"
                      style={{ display: 'block', fontSize: 10 }}
                      title="Change since the season opened"
                    >
                      {r.eloChange > 0 ? '▲' : '▼'} {Math.abs(r.eloChange)}
                    </span>
                  ) : null}
                </span>
              </a>
            )
          })}
        </div>
      </section>

      <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '75ch' }}>
        {data.ratingsMeta.note} Rebuild them with{' '}
        <span className="mono" style={{ color: 'var(--gold)' }}>npm run ratings</span>, and tune
        how they convert to a spread under <a href={href('model')} style={{ color: 'var(--gold)' }}>Model lab</a>.
      </p>
    </>
  )
}
