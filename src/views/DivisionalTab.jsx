import { useEffect, useMemo, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Badge, Segmented } from '../components/Controls.jsx'
import { getTeam } from '../data/teams.js'
import {
  decodeHistory, meetings, headToHead, bettingTrends, recentDivisional, matchupPatterns, assessBets, lineFor,
  atsResidFor, totalResid, marginFor, HALF_LIFE_SEASONS, QB_CHANGE_WEIGHT, COACH_CHANGE_WEIGHT, MAX_MARGIN_SHIFT, MAX_TOTAL_SHIFT
} from '../lib/divisional.js'
import { fmtSpread, fmtPct, fmtSigned } from '../lib/format.js'
import divisionModel from '../data/generated/division-model.json'

// Every division game since 2002 is ~200 KB that only this section needs.
let historyPromise = null
const loadHistory = () =>
  (historyPromise ??= import('../data/generated/division-history.json').then((m) => ({ file: m.default, games: decodeHistory(m.default) })))

const SCOPES = [
  { value: 5, label: 'Last 5' },
  { value: 10, label: 'Last 10' },
  { value: 0, label: 'All since 2002' }
]

const rec = (r) => (r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`)
const ats = (r) => (r.p ? `${r.w}-${r.l}-${r.p}` : `${r.w}-${r.l}`)
const rate = (w, l) => (w + l ? w / (w + l) : null)
/** Green at 60%+ for the side named, red at 40% or less; the middle is a coin flip and says so. */
const trendTone = (r) => (r == null ? null : r >= 0.6 ? 'pos' : r <= 0.4 ? 'neg' : null)
const arrow = (r) => (r == null ? '' : r >= 0.6 ? '▲ ' : r <= 0.4 ? '▼ ' : '')

/**
 * Divisional History: the two rivals' head-to-head results, how those
 * games went against the closing line, each team's record against its
 * whole division, patterns worth knowing, and what all of it means for
 * this game's moneyline, spread and total. Every number is from real
 * finished games (nflverse); see divisional.js for what is measured.
 */
export default function DivisionalTab({ game, final = false }) {
  const [state, setState] = useState({ status: 'loading', games: null, file: null, error: null })
  const [scope, setScope] = useState(10)
  const [showAll, setShowAll] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    loadHistory()
      .then(({ file, games }) => alive && setState({ status: 'ready', games, file, error: null }))
      .catch((err) => {
        historyPromise = null
        if (alive) setState({ status: 'error', games: null, file: null, error: err.message })
      })
    return () => { alive = false }
  }, [attempt])

  const a = game.away
  const b = game.home
  const division = `${getTeam(b).conference} ${getTeam(b).division}`
  const season = divisionModel.season

  const derived = useMemo(() => {
    if (!state.games) return null
    const list = meetings(state.games, a, b)
    const scoped = scope ? list.slice(0, scope) : list
    return {
      list,
      scoped,
      h2h: headToHead(list, a, b),
      scopedH2h: headToHead(scoped, a, b),
      trends: bettingTrends(scoped, a, b),
      recent: { [a]: recentDivisional(state.games, a, season), [b]: recentDivisional(state.games, b, season) },
      patterns: matchupPatterns(list, a, b, state.games, season, divisionModel.fit?.baseRates),
      bets: game.projection
        ? assessBets({ game, projection: game.projection, line: lineFor(game, divisionModel), list, model: divisionModel, baseLevel: game.confidence?.level })
        : null
    }
  }, [state.games, scope, a, b, season, game])

  if (state.status === 'loading') return <p className="dim" style={{ fontSize: 12 }}>Loading every division game since 2002…</p>
  if (state.status === 'error') {
    return (
      <p className="neg" style={{ fontSize: 12 }}>
        Couldn&apos;t load the divisional history ({state.error}).{' '}
        <button className="btn ghost" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </p>
    )
  }

  const { list, scoped, h2h, scopedH2h, trends, recent, patterns, bets } = derived
  const file = state.file
  const line = lineFor(game, divisionModel)
  const current = divisionModel.current ?? {}

  return (
    <div style={{ display: 'grid', gap: 'var(--s5)' }}>
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
          <div>
            <div className="eyebrow">{division} rivals · {list.length} meetings since {file.fromSeason}</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Divisional History</h2>
          </div>
          <Segmented label="How many meetings" options={SCOPES} value={scope} onChange={setScope} />
        </div>
        <HeadToHead a={a} b={b} s={scopedH2h} h2h={h2h} scope={scope} />
      </section>

      {final
        ? <p className="dim" style={{ fontSize: 12, margin: 0 }}>This game is over, so there is nothing left to bet; the history below already includes it.</p>
        : bets && <Insights game={game} bets={bets} line={line} />}

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Against the closing line · {scopeLabel(scope, scoped)}</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Betting trends</h2>
          </div>
        </div>
        <Trends a={a} b={b} t={trends} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Every meeting, newest first</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Results</h2>
          </div>
        </div>
        <ResultsTable list={showAll ? list : list.slice(0, 10)} a={a} b={b} current={current} />
        {list.length > 10 && (
          <div style={{ padding: 'var(--s3) var(--s4)' }}>
            <button className="btn ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show the last 10' : `Show all ${list.length} meetings`}
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Regular season, against every {division} opponent</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Recent divisional performance</h2>
          </div>
        </div>
        <RecentTable teams={[a, b]} recent={recent} season={season} />
      </section>

      <section className="panel" style={{ padding: 'var(--s4)' }}>
        <div className="eyebrow">Matchup context</div>
        <h2 style={{ fontSize: 'var(--t-lg)', margin: '4px 0 var(--s3)' }}>Patterns in this rivalry</h2>
        {patterns.length
          ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }}>
              {patterns.map((p, i) => <li key={i}>{p.text} <span className="dim">(n = {p.n})</span></li>)}
            </ul>
          )
          : <p className="dim" style={{ fontSize: 13, margin: 0 }}>Nothing out of the ordinary: no lopsided record, scoring streak or home/road split big enough to call out.</p>}
        <p className="dim" style={{ fontSize: 11, margin: 'var(--s3) 0 0' }}>
          These describe what happened. Tested against closing lines, head-to-head records and streaks like these
          have not predicted the next meeting&apos;s result against the spread, so they are context only; what was
          measured to matter is already in the projection (see What this means for the bet, above).
        </p>
      </section>

      <DataNotes file={file} list={list} line={line} />
    </div>
  )
}

function scopeLabel(scope, scoped) {
  if (!scoped.length) return 'no meetings'
  const seasons = `${scoped[scoped.length - 1].season}–${scoped[0].season}`
  return scope ? `last ${scoped.length} meetings (${seasons})` : `all ${scoped.length} meetings (${seasons})`
}

function HeadToHead({ a, b, s, h2h, scope }) {
  const sum = s.all
  const reg = h2h.regular
  const post = h2h.playoffs
  const last = h2h.last
  const side = (team, record, home, away, avgPts) => (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center' }}>
      <TeamMark abbr={team} size={34} />
      <div style={{ fontWeight: 600 }}>{getTeam(team).name}</div>
      <div className="mono" style={{ fontSize: 'var(--t-xl)' }}>{record}</div>
      <div className="dim" style={{ fontSize: 11 }}>wins in {sum.games}{sum.record.t ? ` (${sum.record.t} tie)` : ''}</div>
      <div style={{ fontSize: 12 }}>Home <span className="mono">{home}</span> · Away <span className="mono">{away}</span></div>
      <div style={{ fontSize: 12 }}>Scores <span className="mono">{avgPts ?? '—'}</span> a game</div>
    </div>
  )
  const bHome = { w: sum.aAway.l, l: sum.aAway.w, t: sum.aAway.t }
  const bAway = { w: sum.aHome.l, l: sum.aHome.w, t: sum.aHome.t }
  return (
    <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
      {sum.games === 0
        ? <p className="dim" style={{ margin: 0 }}>These two have not met since 2002.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s4)', alignItems: 'start' }}>
            {side(a, sum.record.w, rec(sum.aHome), rec(sum.aAway), sum.avgA)}
            <div style={{ display: 'grid', gap: 8, fontSize: 13, alignContent: 'center' }}>
              <Stat label="Average combined points" value={sum.avgCombined} />
              <Stat label="Average winning margin" value={sum.avgWinMargin} />
              <Stat label={`Decided by 7 or fewer`} value={`${sum.closeGames} of ${sum.games}`} />
              <Stat label="Seasons" value={sum.seasons ? `${sum.seasons[0]}–${sum.seasons[1]}` : '—'} />
            </div>
            {side(b, sum.record.l, rec(bHome), rec(bAway), sum.avgB)}
          </div>
        )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s3)', fontSize: 12 }}>
        <div className="panel" style={{ padding: 'var(--s3)' }}>
          <div className="eyebrow">Most recent meeting</div>
          {last
            ? (
              <div style={{ marginTop: 4 }}>
                <span className="mono">{last.away} {last.awayScore} @ {last.home} {last.homeScore}</span>
                {last.overtime && <span className="dim"> (OT)</span>}
                <div className="dim">{last.postseason ? 'Playoffs' : `Week ${last.week}`}, {last.season} · {last.date}</div>
              </div>
            )
            : <div className="dim" style={{ marginTop: 4 }}>None since 2002</div>}
        </div>
        <div className="panel" style={{ padding: 'var(--s3)' }}>
          <div className="eyebrow">Regular season vs. playoffs (all since 2002)</div>
          <div style={{ marginTop: 4 }}>
            Regular season: <span className="mono">{a} {reg.record.w} – {b} {reg.record.l}{reg.record.t ? ` – ${reg.record.t} tie` : ''}</span>
            <span className="dim"> ({reg.games} games)</span>
          </div>
          <div>
            Playoffs: {post.games
              ? <><span className="mono">{a} {post.record.w} – {b} {post.record.l}</span><span className="dim"> ({post.games} games)</span></>
              : <span className="dim">no playoff meetings</span>}
          </div>
        </div>
      </div>
      {scope !== 0 && <p className="dim" style={{ fontSize: 11, margin: 0 }}>Record and averages above cover the {scope === 5 ? 'last 5' : 'last 10'} meetings; switch to &quot;All since 2002&quot; for the full span.</p>}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--s3)', borderBottom: '1px solid var(--edge)', paddingBottom: 4 }}>
      <span className="dim">{label}</span>
      <span className="mono">{value ?? '—'}</span>
    </div>
  )
}

function Tile({ label, value, sub, r }) {
  const tone = trendTone(r)
  return (
    <div className="panel" style={{ padding: 'var(--s3)' }}>
      <div className="dim" style={{ fontSize: 11 }}>{label}</div>
      <div className={`mono ${tone ?? ''}`} style={{ fontSize: 'var(--t-base)', marginTop: 2 }}>{arrow(r)}{value}</div>
      {sub && <div className="dim" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Trends({ a, b, t }) {
  if (!t.withSpread && !t.withTotal) return <p className="dim" style={{ padding: 'var(--s4)', margin: 0 }}>No meetings with a recorded line.</p>
  const pctOf = (r) => rate(r.w, r.l)
  const roles = [['homeFav', 'Home favourite'], ['roadFav', 'Road favourite'], ['homeDog', 'Home underdog'], ['roadDog', 'Road underdog']]
  return (
    <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)' }}>
        <Tile label={`${a} against the spread`} value={ats(t.ats[a])} r={pctOf(t.ats[a])} sub={fmtCover(t.ats[a])} />
        <Tile label={`${b} against the spread`} value={ats(t.ats[b])} r={pctOf(t.ats[b])} sub={fmtCover(t.ats[b])} />
        <Tile label="Over / under" value={`${t.ou.o}-${t.ou.u}${t.ou.p ? `-${t.ou.p}` : ''}`} r={t.overPct} sub={t.overPct != null ? `${fmtPct(t.overPct, 0)} over · ${fmtPct(t.underPct, 0)} under` : null} />
        <Tile label="Home team ATS" value={ats(t.homeAts)} r={pctOf(t.homeAts)} sub={fmtCover(t.homeAts)} />
        <Tile label="Road team ATS" value={ats(t.roadAts)} r={pctOf(t.roadAts)} sub={fmtCover(t.roadAts)} />
        <Tile label="Favourite ATS · straight up" value={`${ats(t.favorite.ats)} · ${rec(t.favorite.su)}`} r={pctOf(t.favorite.ats)} sub={t.pickem ? `${t.pickem} pick'em left out` : null} />
        <Tile label="Underdog ATS · straight up" value={`${ats(t.underdog.ats)} · ${rec(t.underdog.su)}`} r={pctOf(t.underdog.ats)} />
        <Tile label="Avg spread vs. avg result" value={t.avgFavSpread != null ? `fav −${t.avgFavSpread} · won by ${fmtSigned(t.avgFavMargin)}` : '—'} sub="Favourite's line vs. its actual margin" />
        <Tile label="Avg total vs. avg points" value={t.avgTotal != null ? `${t.avgTotal} · ${t.avgCombined}` : '—'} sub="Closing total vs. combined score" />
      </div>
      <div className="tbl-scroll">
        <table className="tbl responsive compact">
          <thead>
            <tr><th>As a</th>{[a, b].map((team) => <th key={team}>{team} straight up · ATS</th>)}</tr>
          </thead>
          <tbody>
            {roles.map(([key, label]) => (
              <tr key={key}>
                <td data-label="As a">{label}</td>
                {[a, b].map((team) => {
                  const r = t.roles[team][key]
                  return (
                    <td key={team} className="num" data-label={team}>
                      {r.n
                        ? <span className={trendTone(rate(r.ats.w, r.ats.l)) ?? ''}>{rec(r.su)} · {ats(r.ats)} <span className="dim">({r.n})</span></span>
                        : <span className="dim">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(t.missingSpread > 0 || t.missingTotal > 0) && (
        <p className="dim" style={{ fontSize: 11, margin: 0 }}>
          {t.missingSpread} of these meetings have no recorded spread and {t.missingTotal} no recorded total; they are left out of the numbers above.
        </p>
      )}
    </div>
  )
}

const fmtCover = (r) => {
  const p = rate(r.w, r.l)
  return p == null ? null : `${fmtPct(p, 0)} covers${r.p ? `, ${r.p} push` : ''}`
}

function ResultsTable({ list, a, b, current }) {
  if (!list.length) return <p className="dim" style={{ padding: 'var(--s4)', margin: 0 }}>No meetings since 2002.</p>
  const fmtLine = (g) => {
    if (g.spread == null) return <span className="dim">not recorded</span>
    if (g.spread === 0) return "Pick'em"
    const fav = g.spread > 0 ? g.home : g.away
    return `${fav} ${fmtSpread(-Math.abs(g.spread))}`
  }
  const changed = (g, side) => {
    const team = g[side]
    const now = current[team]
    return now?.qb && g[`${side}Qb`] && now.qb !== g[`${side}Qb`]
  }
  return (
    <div className="tbl-scroll">
      <table className="tbl responsive">
        <thead>
          <tr>
            <th>Game</th>
            <th>Score</th>
            <th>Line</th>
            <th>Total</th>
            <th>Covered</th>
            <th>O/U</th>
            <th>Starting QBs</th>
          </tr>
        </thead>
        <tbody>
          {list.map((g) => {
            const resid = atsResidFor(g, a)
            const tr = totalResid(g)
            const winner = marginFor(g, a) > 0 ? a : marginFor(g, a) < 0 ? b : null
            return (
              <tr key={`${g.date}-${g.home}`}>
                <td data-label="Game">
                  <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <span className="mono">{g.season}</span> {g.postseason ? <Badge tone="chalk">Playoffs</Badge> : <span className="dim">Wk {g.week}</span>}
                    <span className="dim"> · {g.away} @ {g.home}</span>
                  </span>
                </td>
                <td className="num" data-label="Score">
                  <span>
                    <span className={winner === g.away ? '' : 'dim'}>{g.awayScore}</span>–<span className={winner === g.home ? '' : 'dim'}>{g.homeScore}</span>
                    {g.overtime && <span className="dim"> OT</span>}
                  </span>
                </td>
                <td className="num" data-label="Line">{fmtLine(g)}</td>
                <td className="num" data-label="Total">{g.total ?? <span className="dim">not recorded</span>}</td>
                <td data-label="Covered">
                  {resid == null ? <span className="dim">—</span> : resid === 0 ? <span className="dim">Push</span> : <span>{resid > 0 ? a : b}</span>}
                </td>
                <td data-label="O/U">
                  {tr == null ? <span className="dim">—</span> : tr === 0 ? <span className="dim">Push</span> : <span>{tr > 0 ? 'Over' : 'Under'} <span className="dim">({tr > 0 ? '+' : ''}{tr})</span></span>}
                </td>
                <td data-label="Starting QBs">
                  <span style={{ fontSize: 12, minWidth: 0, flex: '1 1 auto' }}>
                    <span className={changed(g, 'away') ? 'dim' : ''}>{g.awayQb ?? '—'}</span>
                    <span className="dim"> / </span>
                    <span className={changed(g, 'home') ? 'dim' : ''}>{g.homeQb ?? '—'}</span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="dim" style={{ fontSize: 11, margin: 0, padding: 'var(--s2) var(--s4) var(--s3)' }}>
        Lines are the closing spread and total nflverse records for each game. A quarterback shown dimmed is not
        his team&apos;s starter now — those meetings count for less in the projection.
      </p>
    </div>
  )
}

function RecentTable({ teams, recent, season }) {
  const spans = [['current', `${season}`], ['previous', `${season - 1}`], ['last3', `${season - 2}–${season}`]]
  return (
    <div className="tbl-scroll">
      <table className="tbl responsive">
        <thead>
          <tr>
            <th>Team · span</th>
            <th>Record</th>
            <th>ATS</th>
            <th>O/U</th>
            <th>Points for</th>
            <th>Points against</th>
          </tr>
        </thead>
        <tbody>
          {teams.flatMap((team) => spans.map(([key, label]) => {
            const r = recent[team][key]
            return (
              <tr key={`${team}-${key}`}>
                <td data-label="Team · span">
                  <span className="row gap-2"><TeamMark abbr={team} size={16} /><span>{team}</span><span className="dim">{label}</span></span>
                </td>
                {r.games === 0
                  ? <td colSpan={5} data-label="Record"><span className="dim">No division games yet</span></td>
                  : (
                    <>
                      <td className="num" data-label="Record">{rec(r.record)}</td>
                      <td className="num" data-label="ATS"><span className={trendTone(rate(r.ats.w, r.ats.l)) ?? ''}>{r.withSpread ? ats(r.ats) : '—'}</span></td>
                      <td className="num" data-label="O/U">{r.withTotal ? `${r.ou.o}-${r.ou.u}${r.ou.p ? `-${r.ou.p}` : ''}` : '—'}</td>
                      <td className="num" data-label="Points for"><span>{r.pointsFor} <span className="dim">({r.avgFor}/g)</span></span></td>
                      <td className="num" data-label="Points against"><span>{r.pointsAgainst} <span className="dim">({r.avgAgainst}/g)</span></span></td>
                    </>
                  )}
              </tr>
            )
          }))}
        </tbody>
      </table>
    </div>
  )
}

const LEVEL_TONE = { high: 'edge', medium: 'chalk', low: 'quiet' }
const LEAN = {
  supports: { tone: 'edge', label: 'History supports' },
  contradicts: { tone: 'live', label: 'History contradicts' },
  neutral: { tone: 'quiet', label: 'History is split' },
  none: { tone: 'quiet', label: 'Too few meetings' }
}

function Insights({ game, bets, line }) {
  const adj = game.projection?.divisional
  const { moneyline: ml, spread: sp, total: to } = bets
  const homeLine = (m) => `${game.home} ${fmtSpread(-Math.round(m * 2) / 2)}`
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">AI betting insights · {line ? line.source : 'no sportsbook line posted yet'}</div>
          <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>What this means for the bet</h2>
        </div>
      </div>
      <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 'var(--s3)' }}>
          <BetCard
            title="Moneyline"
            a={ml}
            pick={ml.pick}
            model={`${ml.pick} ${fmtPct(ml.pick === game.home ? ml.modelHome : 1 - ml.modelHome, 0)} to win`}
            market={ml.marketHome != null ? `${fmtPct(ml.pick === game.home ? ml.marketHome : 1 - ml.marketHome, 0)} implied (no vig)` : 'No moneyline posted'}
            edge={ml.edge != null ? `${fmtPct(ml.edge, 1)} win chance` : null}
            history={`${fmtSigned(ml.historyPoints, 2)} pts of margin for ${ml.pick}`}
          />
          <BetCard
            title="Spread"
            a={sp}
            pick={sp.pick}
            model={homeLine(sp.modelMargin)}
            market={sp.lineMargin != null ? homeLine(sp.lineMargin) : 'No spread posted'}
            edge={sp.edge != null ? `${sp.edge.toFixed(1)} pts toward ${sp.pick}` : null}
            history={`${fmtSigned(sp.historyPoints, 2)} pts for ${sp.pick}`}
          />
          <BetCard
            title="Over / under"
            a={to}
            pick={to.pick ? to.pick[0].toUpperCase() + to.pick.slice(1) : null}
            model={`${to.modelTotal}`}
            market={to.lineTotal != null ? `${to.lineTotal}` : 'No total posted'}
            edge={to.edge != null ? `${to.edge.toFixed(1)} pts ${to.pick}` : null}
            history={to.pick ? `${fmtSigned(to.historyPoints, 2)} pts for the ${to.pick}` : null}
          />
        </div>
        {adj && (
          <div style={{ fontSize: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>What divisional history added to this projection</div>
            <div className="mono">
              Spread {fmtSigned(adj.marginShift, 2)} pts to {game.home} · Total {fmtSigned(adj.totalShift, 2)} pts
            </div>
            <ul className="dim" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {adj.parts.map((p) => (
                <li key={p.key}>{p.label}: {fmtSigned(p.points, 2)} pts {p.on === 'margin' ? `to ${game.home}` : 'to the total'}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="dim" style={{ fontSize: 11, margin: 0 }}>
          Confidence comes from the projection&apos;s edge over the line, capped by this game&apos;s overall confidence
          (model agreement, sample size, injuries, quarterback status: {game.confidence?.level ?? 'unknown'}). Divisional history
          moves the projection only by what it was measured to be worth — at most {MAX_MARGIN_SHIFT} points on the spread and
          {' '}{MAX_TOTAL_SHIFT} on the total — so this season&apos;s form, injuries and quarterbacks always carry more weight.
          &quot;Supports&quot; or &quot;contradicts&quot; reports the head-to-head record beside each bet but never raises confidence on
          its own. Estimates, not advice.
        </p>
        {bets.measuredNote?.length > 0 && (
          <details style={{ fontSize: 12 }}>
            <summary className="dim" style={{ cursor: 'pointer' }}>How each piece of history was measured</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
              {bets.measuredNote.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}

function BetCard({ title, a, pick, model, market, edge, history }) {
  const level = a.level
  const lean = LEAN[a.history?.lean ?? 'none']
  return (
    <div className="panel" style={{ padding: 'var(--s3)', display: 'grid', gap: 6, alignContent: 'start' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span className="eyebrow">{title}</span>
        {LEVEL_TONE[level]
          ? <Badge tone={LEVEL_TONE[level]}>{level} confidence</Badge>
          : <Badge tone="quiet">{level}</Badge>}
      </div>
      {pick && LEVEL_TONE[level] && <div style={{ fontWeight: 600 }}>Lean: {pick}</div>}
      <div style={{ fontSize: 12, display: 'grid', gap: 2 }}>
        <div><span className="dim">Model </span><span className="mono">{model}</span></div>
        <div><span className="dim">Line </span><span className="mono">{market}</span></div>
        {edge && <div><span className="dim">Edge </span><span className="mono">{edge}</span></div>}
        {history && <div><span className="dim">History&apos;s share </span><span className="mono">{history}</span></div>}
      </div>
      <div style={{ fontSize: 12 }}>
        <Badge tone={lean.tone}>{lean.label}</Badge>
        <div className="dim" style={{ marginTop: 4 }}>{a.history?.text}</div>
      </div>
    </div>
  )
}

function DataNotes({ file, list, line }) {
  const withML = list.filter((g) => g.homeML != null && g.awayML != null).length
  return (
    <p className="dim" style={{ fontSize: 11, margin: 0, maxWidth: '90ch' }}>
      <strong>Data.</strong> {file.source}; every division game from {file.fromSeason} (the first season of today&apos;s
      divisions) through {file.throughDate}, regular season and playoffs, {file.games.length} games in all. Relocated
      franchises count as one team. This rivalry: {list.length} meetings, {list.filter((g) => g.spread != null).length} with a
      recorded spread, {list.filter((g) => g.total != null).length} with a total, {withML} with moneylines (nflverse has none
      before 2006). Nothing missing is estimated — it is left out and counted here.
      {' '}<strong>Weighting.</strong> For the projection, a meeting&apos;s weight halves every {HALF_LIFE_SEASONS} seasons, and is
      multiplied by {QB_CHANGE_WEIGHT} for each side whose starting quarterback differs from now and by {COACH_CHANGE_WEIGHT} for
      each head-coach change; only the last 10 meetings with a line count.
      {' '}<strong>Line for this game:</strong> {line ? line.source : 'none posted yet — nflverse posts lines about a week ahead'}.
      {' '}Updated daily from nflverse as games finish.
    </p>
  )
}
