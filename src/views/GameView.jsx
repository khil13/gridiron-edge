import { useMemo, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import EdgeRail from '../components/EdgeRail.jsx'
import { WinProbChart, Sparkline, ProbBar, StatBar } from '../components/Charts.jsx'
import { Tabs, Badge, Empty } from '../components/Controls.jsx'
import { IconBack } from '../components/Icons.jsx'
import { getTeam } from '../data/teams.js'
import { recordOf } from '../data/season2025.js'
import { useStore } from '../lib/store.jsx'
import { useGameSummary } from '../lib/useDataset.js'
import { groupTeamStats } from '../lib/boxscore.js'
import { toSlipLeg } from '../lib/edges.js'
import { winProbabilityPath } from '../lib/model.js'
import {
  fmtOdds, fmtSpread, fmtPct, fmtSigned, fmtKickoff, fmtDay, fmtTime, fmtMoney, readable
} from '../lib/format.js'
import { href } from '../lib/router.js'

export default function GameView({ game, data }) {
  const [tab, setTab] = useState('overview')
  const home = getTeam(game.home)
  const away = getTeam(game.away)
  const isFinal = game.status === 'final'
  const isLive = game.status === 'live'
  const proj = game.projection

  const path = useMemo(() => {
    if (!isFinal || !proj) return null
    const seed = [...game.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
    return winProbabilityPath(proj.homeWinProb, game.homeScore - game.awayScore, seed)
  }, [game, proj, isFinal])

  return (
    <div className="page">
      <a className="btn ghost" href={href('scores')} style={{ marginBottom: 'var(--s4)' }}>
        <IconBack width={14} height={14} /> All games
      </a>

      <header
        className="panel"
        style={{
          padding: 'var(--s5) var(--s4)',
          marginBottom: 'var(--s4)',
          background: `linear-gradient(100deg, ${tintOf(away.primary)}, transparent 42%, transparent 58%, ${tintOf(home.primary)})`
        }}
      >
        <div className="row spread-between gap-3" style={{ marginBottom: 'var(--s4)' }}>
          <span className="eyebrow">
            {game.title || (game.preseason ? 'Preseason' : 'Regular season')} · {fmtDay(game.kickoff)}
          </span>
          {game.venue && <span className="eyebrow truncate">{game.venue}</span>}
        </div>

        <div className="row spread-between gap-4 gh-grid">
          <Side team={away} score={game.awayScore} show={isFinal} align="left" />
          <div className="gh-middle" style={{ textAlign: 'center', flex: '0 0 auto' }}>
            <div className="eyebrow">{isFinal ? 'Final' : 'Kickoff'}</div>
            <div className="mono" style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>
              {isFinal ? `${game.awayScore}–${game.homeScore}` : fmtTime(game.kickoff)}
            </div>
          </div>
          <Side team={home} score={game.homeScore} show={isFinal} align="right" />
        </div>

        {proj && (
          <div style={{ marginTop: 'var(--s5)' }}>
            <div className="row spread-between mono" style={{ fontSize: 11, marginBottom: 6 }}>
              <span style={{ color: readable(away.primary) }}>{away.abbr} {fmtPct(proj.awayWinProb, 0)}</span>
              <span className="eyebrow">Model win probability</span>
              <span style={{ color: readable(home.primary) }}>{fmtPct(proj.homeWinProb, 0)} {home.abbr}</span>
            </div>
            <ProbBar
              home={proj.homeWinProb}
              away={proj.awayWinProb}
              homeColor={home.primary}
              awayColor={away.primary}
            />
          </div>
        )}
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          ...(isLive || isFinal ? [{ value: 'stats', label: 'Stats' }] : []),
          { value: 'odds', label: 'Odds', count: game.market?.books?.length },
          { value: 'model', label: 'Model' }
        ]}
      />

      <div style={{ marginTop: 'var(--s4)' }}>
        {tab === 'overview' && <Overview game={game} path={path} data={data} />}
        {tab === 'stats' && <StatsTab game={game} data={data} />}
        {tab === 'odds' && <OddsTab game={game} />}
        {tab === 'model' && <ModelTab game={game} data={data} />}
      </div>
    </div>
  )
}

const moved = (movement) => new Set(movement.map((m) => m.spreadHome)).size > 1

const tintOf = (hex) => {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.18)`
}

function Side({ team, score, show, align }) {
  const rec = recordOf(team.abbr)
  return (
    <a
      href={href(`team/${team.abbr}`)}
      className="grow gh-side"
      style={{ textAlign: align, minWidth: 0, display: 'block' }}
    >
      <div className="row gap-3 gh-row" style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {align === 'left' && <TeamMark abbr={team.abbr} size={40} />}
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow truncate">{team.location}</div>
          <h1 style={{ fontSize: 'var(--t-xl)' }} className="truncate">{team.name}</h1>
          {rec && <div className="mono dim" style={{ fontSize: 11 }}>{rec.w}-{rec.l} in 2025</div>}
        </div>
        {align === 'right' && <TeamMark abbr={team.abbr} size={40} />}
      </div>
      {show && (
        <div className="team-score gh-score" style={{ fontSize: 'var(--t-score)', textAlign: align, marginTop: 4 }}>
          {score}
        </div>
      )}
    </a>
  )
}

/* ---------------- Overview ---------------- */

function Overview({ game, path, data }) {
  const home = getTeam(game.home)
  const away = getTeam(game.away)
  const proj = game.projection
  const consensus = game.market?.books?.find((b) => b.sharp) || game.market?.books?.[0]
  const hr = data.ratings[game.home]
  const ar = data.ratings[game.away]

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      {consensus && proj && (
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="eyebrow">Market vs model</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>
                {Math.abs(consensus.spread.home.line - proj.modelSpreadHome).toFixed(1)} points apart
              </h2>
            </div>
            <span className="mono dim" style={{ fontSize: 11 }}>Home spread · {consensus.name}</span>
          </div>
          <div style={{ padding: 'var(--s5) var(--s5) var(--s4)' }}>
            <EdgeRail
              marketLine={consensus.spread.home.line}
              modelLine={proj.modelSpreadHome}
              home={game.home}
              away={game.away}
            />
            <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 'var(--s4)' }}>
              The market posts {home.abbr} at <span className="market mono">{fmtSpread(consensus.spread.home.line)}</span>.
              The model would post <span className="model mono">{fmtSpread(Math.round(proj.modelSpreadHome * 10) / 10)}</span>.
              {game.preseason && ' Preseason projections are deliberately pulled toward a pick’em — starters play a handful of snaps.'}
            </p>
          </div>
        </section>
      )}

      {path && (
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="eyebrow">Win probability</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>How the game turned</h2>
            </div>
            <Badge tone="quiet">Simulated path</Badge>
          </div>
          <div style={{ padding: 'var(--s4)' }}>
            <WinProbChart path={path} homeColor={home.primary} awayColor={away.primary} />
            <div className="row spread-between mono dim" style={{ fontSize: 10, marginTop: 6 }}>
              <span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span>
            </div>
            <p className="dim" style={{ fontSize: 11, marginTop: 'var(--s3)', marginBottom: 0 }}>
              Reconstructed from the pregame number and the final score. Wire real drive data
              into <span className="mono">winProbabilityPath</span> to replace it.
            </p>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Season profile</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Head to head</h2>
          </div>
        </div>
        <div style={{ padding: 'var(--s4)' }}>
          <StatBar label="Rating" away={ar.elo - 1200} home={hr.elo - 1200}
                   awayColor={away.primary} homeColor={home.primary}
                   format={(v) => Math.round(v + 1200)} />
          <StatBar label="Pts for" away={ar.ppg} home={hr.ppg}
                   awayColor={away.primary} homeColor={home.primary}
                   format={(v) => v.toFixed(1)} />
          <StatBar label="Pts vs" away={30 - ar.papg} home={30 - hr.papg}
                   awayColor={away.primary} homeColor={home.primary}
                   format={(v) => (30 - v).toFixed(1)} />
          <StatBar label="2025 W" away={ar.wins} home={hr.wins}
                   awayColor={away.primary} homeColor={home.primary} />
          <p className="dim" style={{ fontSize: 11, marginTop: 'var(--s3)', marginBottom: 0 }}>
            Points for and against are derived from each team&apos;s rating, not observed box scores.
          </p>
        </div>
      </section>

      {game.market?.movement?.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Line movement</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>
                {fmtSpread(game.market.open.spreadHome)} → {fmtSpread(game.market.consensus.spreadHome)}
              </h2>
            </div>
            <span className="mono dim" style={{ fontSize: 11 }}>{home.abbr} spread</span>
          </div>
          <div style={{ padding: 'var(--s4)' }}>
            {moved(game.market.movement) ? (
              <>
                <Sparkline values={game.market.movement.map((m) => m.spreadHome)} height={54} />
                <div className="row spread-between mono dim" style={{ fontSize: 10, marginTop: 6 }}>
                  <span>Open</span><span>Now</span>
                </div>
              </>
            ) : (
              <p className="dim" style={{ fontSize: 12, margin: 0 }}>
                The number has not moved since it was posted. Either the market is confident or
                nobody has bet into it yet.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

/* ---------------- Odds ---------------- */

function OddsTab({ game }) {
  const { dispatch } = useStore()
  if (!game.market) return <Empty title="No prices for this game">This slate has no market data attached.</Empty>

  const books = game.market.books
  const bestSpreadHome = Math.max(...books.map((b) => b.spread.home.line))
  const bestSpreadAway = Math.max(...books.map((b) => b.spread.away.line))
  const bestMlHome = Math.max(...books.map((b) => b.moneyline.home))
  const bestMlAway = Math.max(...books.map((b) => b.moneyline.away))

  const playFor = (bookKey, type, side) =>
    game.allPlays.find((p) => p.bookKey === bookKey && p.type === type && p.side === side)

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Every posted price</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Odds comparison</h2>
          </div>
          {game.market.simulated && <Badge tone="quiet">Simulated prices</Badge>}
        </div>
        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Book</th>
                <th>{game.away} spread</th>
                <th>{game.home} spread</th>
                <th>Total</th>
                <th>{game.away} ML</th>
                <th>{game.home} ML</th>
                <th>Hold</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.key}>
                  <td>
                    <span className="row gap-2">
                      {b.name}
                      {b.sharp && <Badge tone="chalk">Sharp</Badge>}
                    </span>
                  </td>
                  <td className="num" data-label={`${game.away} spread`}>
                    <Cell best={b.spread.away.line === bestSpreadAway}>
                      {fmtSpread(b.spread.away.line)} <span className="dim">{fmtOdds(b.spread.away.price)}</span>
                    </Cell>
                  </td>
                  <td className="num" data-label={`${game.home} spread`}>
                    <Cell best={b.spread.home.line === bestSpreadHome}>
                      {fmtSpread(b.spread.home.line)} <span className="dim">{fmtOdds(b.spread.home.price)}</span>
                    </Cell>
                  </td>
                  <td className="num" data-label="Total">
                    <span>{b.total.line} <span className="dim">o{fmtOdds(b.total.over)}/u{fmtOdds(b.total.under)}</span></span>
                  </td>
                  <td className="num" data-label={`${game.away} ML`}><Cell best={b.moneyline.away === bestMlAway}>{fmtOdds(b.moneyline.away)}</Cell></td>
                  <td className="num" data-label={`${game.home} ML`}><Cell best={b.moneyline.home === bestMlHome}>{fmtOdds(b.moneyline.home)}</Cell></td>
                  <td className="num dim" data-label="Hold">{holdOf(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Best number, every market</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Model verdict</h2>
          </div>
        </div>
        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Play</th><th>Price</th><th>Book</th><th>Model</th><th>No-vig</th><th>EV</th><th>¼ Kelly</th><th />
              </tr>
            </thead>
            <tbody>
              {game.plays.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="row gap-2">
                      {p.label}
                      {p.qualified && <Badge tone="edge">Play</Badge>}
                    </span>
                  </td>
                  <td className="num market" data-label="Price">{fmtOdds(p.price)}</td>
                  <td className="dim" data-label="Book">{p.book}</td>
                  <td className="num" data-label="Model">{fmtPct(p.modelProb)}</td>
                  <td className="num dim" data-label="No-vig">{fmtPct(p.marketProb)}</td>
                  <td className={`num ${p.ev > 0 ? 'pos' : 'neg'}`} data-label="EV">{p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}%</td>
                  <td className="num dim" data-label="¼ Kelly">{p.ev > 0 ? fmtMoney(p.stake) : '—'}</td>
                  <td className="action">
                    <button className="btn" onClick={() => dispatch({ type: 'addLeg', leg: toSlipLeg(p) })}>
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const Cell = ({ best, children }) => (best ? <span className="best-price">{children}</span> : <span>{children}</span>)

function holdOf(book) {
  const p = (a) => (a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100))
  return `${((p(book.spread.home.price) + p(book.spread.away.price) - 1) * 100).toFixed(1)}%`
}

/* ---------------- Model ---------------- */

function ModelTab({ game, data }) {
  const proj = game.projection
  const { settings } = useStore()
  if (!proj) return <Empty title="No projection">This game has teams the rating file does not cover.</Empty>

  const hr = data.ratings[game.home]
  const ar = data.ratings[game.away]

  const rows = [
    ['Home rating', hr.elo.toFixed(0), `${fmtSigned(hr.pointsVsAverage)} pts vs average`],
    ['Away rating', ar.elo.toFixed(0), `${fmtSigned(ar.pointsVsAverage)} pts vs average`],
    ['Rating gap', fmtSigned((hr.elo - ar.elo) / settings.eloPerPoint), `${settings.eloPerPoint} Elo = 1 point`],
    ['Home field', fmtSigned(proj.hfa), game.neutral ? 'Neutral site' : 'Applied to the home side'],
    ['Rest', fmtSigned(proj.rest, 2), `${settings.restPointsPerDay} pts per day of extra rest`],
    proj.shrunk && ['Preseason shrink', `×${(1 - settings.preseasonShrink).toFixed(2)}`, 'Starters play limited snaps'],
    ['Projected margin', fmtSigned(proj.margin), `${game.home} perspective`],
    ['Projected total', proj.total.toFixed(1), 'Blended scoring rates, regressed to league mean'],
    ['Win probability', fmtPct(proj.homeWinProb), `Normal margin, σ = ${settings.marginSigma}`]
  ].filter(Boolean)

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Every input, shown</div>
          <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>How this number was built</h2>
        </div>
        <a className="btn ghost" href={href('model')}>Tune the model</a>
      </div>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead><tr><th>Input</th><th>Value</th><th style={{ textAlign: 'left' }} className="hide-sm">Notes</th></tr></thead>
          <tbody>
            {rows.map(([label, value, note]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{value}</td>
                <td className="dim hide-sm" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---------------- Live box score ---------------- */

/**
 * Real in-game numbers, pulled per game rather than for the whole slate.
 *
 * Everything here degrades: if the feed is bundled, unreachable, or simply
 * has not filled a section in yet, that block is omitted rather than shown
 * empty or faked.
 */
function StatsTab({ game, data }) {
  const { loading, summary, error } = useGameSummary(game, data.source)
  const home = getTeam(game.home)
  const away = getTeam(game.away)

  if (data.source !== 'espn') {
    return (
      <Empty title="Box scores need the live feed">
        This build is showing the bundled slate, which carries final scores but no
        play-level statistics. Live scores are on by default — if you are seeing this,
        the feed fell back, and the banner on the Scores page says why.
      </Empty>
    )
  }
  if (loading && !summary) {
    return <Empty title="Loading the box score">Pulling stats from the live feed.</Empty>
  }
  if (error) {
    return (
      <Empty title="Box score unavailable">
        {error}. Scores above are still current; only the detailed statistics failed
        to load.
      </Empty>
    )
  }
  if (!summary) return <Empty title="No stats posted yet">Nothing has been recorded for this game.</Empty>

  const { situation, linescores, teamStats, lastPlay, leaders } = summary

  // The feed lists boxscore teams in its own order; the rest of this app
  // always reads away-then-home, so flip when they disagree.
  const oriented = useMemo(() => {
    if (!teamStats) return null
    if (teamStats.teams[0] === game.away) return teamStats
    return {
      teams: [teamStats.teams[1], teamStats.teams[0]],
      rows: teamStats.rows.map((r) => ({ ...r, values: [r.values[1], r.values[0]] }))
    }
  }, [teamStats, game.away])

  const statGroups = useMemo(() => groupTeamStats(oriented), [oriented])

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      {game.status === 'live' && situation && (
        <section className="panel" style={{ borderColor: situation.isRedZone ? 'rgba(255,90,71,0.45)' : 'var(--line)' }}>
          <div className="panel-head">
            <div className="row gap-2">
              <span className="live-dot" />
              <span className="eyebrow">Live situation</span>
            </div>
            {situation.isRedZone && <Badge tone="live">Red zone</Badge>}
          </div>
          <div style={{ padding: 'var(--s4)' }}>
            <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
              {situation.possession && (
                <div className="row gap-2">
                  <TeamMark abbr={situation.possession} size={22} />
                  <span className="team-name">{situation.possession} ball</span>
                </div>
              )}
              {situation.downDistance && (
                <span className="mono" style={{ fontSize: 'var(--t-lg)' }}>{situation.downDistance}</span>
              )}
              {situation.fieldPosition && <span className="dim mono">{situation.fieldPosition}</span>}
            </div>
            {lastPlay && (
              <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 'var(--s3)' }}>
                {lastPlay}
              </p>
            )}
          </div>
        </section>
      )}

      {linescores && (
        <section className="panel">
          <div className="panel-head"><h2 style={{ fontSize: 'var(--t-base)' }}>Scoring by quarter</h2></div>
          <div className="tbl-scroll">
            <table className="tbl linescore">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Team</th>
                  {linescores[0].periods.map((_, i) => (
                    <th key={i}>{i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>
                  ))}
                  <th>T</th>
                </tr>
              </thead>
              <tbody>
                {linescores.map((r) => (
                  <tr key={r.abbr}>
                    <td style={{ textAlign: 'left' }}>
                      <span className="row gap-2">
                        <TeamMark abbr={r.abbr} size={18} />
                        <span className="team-name">{r.abbr}</span>
                      </span>
                    </td>
                    {r.periods.map((p, i) => <td className="num" key={i}>{p}</td>)}
                    <td className="num" style={{ fontWeight: 700 }}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {statGroups.length > 0 && (
        <section className="panel">
          <div className="cmp-teams">
            <span className="row gap-2">
              <TeamMark abbr={away.abbr} size={20} />
              <span className="team-name">{away.abbr}</span>
            </span>
            <span className="eyebrow">Team stats</span>
            <span className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <span className="team-name">{home.abbr}</span>
              <TeamMark abbr={home.abbr} size={20} />
            </span>
          </div>

          {statGroups.map((group) => (
            <div className="cmp-group" key={group.title}>
              <div className="cmp-head">
                <span className="eyebrow">{group.title}</span>
              </div>
              {group.rows.map((row) => (
                <div className="cmp-row" key={row.name}>
                  <div className="cmp-line">
                    <span className={`cmp-val away${row.leader === 0 ? ' lead' : ''}`}>
                      {row.values[0]}
                    </span>
                    <span className="cmp-label">
                      {row.label}
                      {row.lowerBetter && <span className="lower-hint"> ↓</span>}
                    </span>
                    <span className={`cmp-val home${row.leader === 1 ? ' lead' : ''}`}>
                      {row.values[1]}
                    </span>
                  </div>
                  {row.share ? (
                    <div className={`cmp-bar${row.lowerBetter ? ' inverse' : ''}`}>
                      <span style={{ width: `${row.share[0]}%`, background: readable(away.primary) }} />
                      <span style={{ width: `${row.share[1]}%`, background: readable(home.primary) }} />
                    </div>
                  ) : (
                    <div className="cmp-bar empty" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {leaders && (
        <section className="panel">
          <div className="panel-head"><h2 style={{ fontSize: 'var(--t-base)' }}>Leaders</h2></div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Category</th>
                  <th style={{ textAlign: 'left' }}>Player</th>
                  <th style={{ textAlign: 'left' }}>Line</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((l, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'left' }} className="dim">{l.category}</td>
                    <td style={{ textAlign: 'left' }}>
                      <span className="row gap-2">
                        <TeamMark abbr={l.team} size={16} />
                        <span className="team-name">{l.athlete}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }} className="mono dim">{l.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
