import { useEffect, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Badge } from '../components/Controls.jsx'
import { getTeam } from '../data/teams.js'
import { fetchGameRosters } from '../data/providers/playerData.js'
import { projectVolume, VOLUME_MARKETS, normPropName, isRuledOut } from '../lib/props.js'
import { quantileFor } from '../lib/distributions.js'
import { defenseSpots, defenseExtras, rankTone, recentValues } from '../lib/matchup.js'
import { teamRecord } from '../lib/ratings.js'
import { fmtSpread, ordinal } from '../lib/format.js'

/** Spots shown per defense — its softest that have a lead player on the other side to face them. */
const SPOTS_SHOWN = 5

// Loaded only when a Matchup tab opens: it is a couple of hundred KB that
// nothing else needs.
let recentPromise = null
const loadRecent = () =>
  (recentPromise ??= import('../data/generated/player-recent.json').then((m) => m.default).catch(() => null))

const isCount = (stat) => stat === 'receptions'
const fmtValue = (stat, v) => (isCount(stat) ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)))

/**
 * Matchup: each defense's softest spots by position, who on the other side
 * gets to face them, and what that player is projected for — plus the four
 * whole-defense numbers that shape a game script.
 */
export default function MatchupTab({ game, data }) {
  const [state, setState] = useState({ status: 'loading', rosters: null, recent: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, status: 'loading' }))
    Promise.all([fetchGameRosters(game).catch((err) => ({ error: err })), loadRecent()])
      .then(([rosters, recent]) => {
        if (!alive) return
        if (rosters?.error) setState({ status: 'ready', rosters: null, recent, error: rosters.error.message })
        else setState({ status: 'ready', rosters, recent, error: null })
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, attempt])

  const proj = game.projection
  const recordOf = (abbr) => teamRecord(data.ratings?.[abbr], data.ratingsState?.applied)

  return (
    <div style={{ display: 'grid', gap: 'var(--s5)' }}>
      {proj && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)' }}>
          <Fact label="Model spread" value={`${game.home} ${fmtSpread(Math.round(-proj.margin * 2) / 2)}`} />
          <Fact label="Model total" value={proj.total} />
          <Fact label="Projected points" value={`${game.away} ${proj.awayTeamTotal} · ${game.home} ${proj.homeTeamTotal}`} />
          <Fact label="Records" value={`${game.away} ${recordOf(game.away)?.text ?? '—'} · ${game.home} ${recordOf(game.home)?.text ?? '—'}`}
            sub={recordOf(game.away)?.lastSeason ? 'last season' : null} />
        </div>
      )}

      {state.status === 'loading' && <p className="dim" style={{ fontSize: 12, margin: 0 }}>Pulling both rosters…</p>}
      {state.status === 'ready' && state.error && (
        <p className="neg" style={{ fontSize: 12, margin: 0 }}>
          Couldn&apos;t load the rosters ({state.error.replace(/\.+$/, '')}), so the defenses are shown without the
          players facing them.{' '}
          <button className="btn ghost" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <DefensePanel defense={game.home} offense={game.away} game={game} data={data} rosters={state.rosters} recent={state.recent} />
          <DefensePanel defense={game.away} offense={game.home} game={game} data={data} rosters={state.rosters} recent={state.recent} />
          <p className="dim" style={{ fontSize: 11, margin: 0, maxWidth: '84ch' }}>
            Each defense&apos;s five softest spots that have a lead player on the other side. Rank is out of
            32 by what it allows per game (1st allows the most; for sacks, 1st makes the most); it uses last
            season&apos;s numbers until a team has played this season. <strong>Projection</strong> is this
            app&apos;s own for that player in this game, with the range the middle half of results falls
            in. <strong>Last 5</strong> is what he actually did in his last five games, newest first.
            {' '}<strong>How much a soft spot matters, measured:</strong> over the last two seasons, lead
            running backs facing the five defenses softest against the run beat this app&apos;s
            projection by about 6–10 more yards than against the five toughest, and tight end receiving
            yards showed a similar small effect — those two are marked &quot;has mattered.&quot; Every
            other spot was close to no effect and flipped direction between seasons, so treat it as
            context, not a reason to bet on its own.
          </p>
        </>
      )}
    </div>
  )
}

function Fact({ label, value, sub }) {
  return (
    <div className="panel" style={{ padding: 'var(--s3) var(--s4)' }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: 'var(--t-base)', marginTop: 4 }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function DefensePanel({ defense, offense, game, data, rosters, recent }) {
  const defTeam = getTeam(defense)
  const offTeam = getTeam(offense)
  const found = defenseSpots(defense)
  const extras = defenseExtras(defense)

  const offensePlayers = (rosters?.players ?? []).filter((p) => p.team === offense && !isRuledOut(p.injury))
  const leadFor = (role) => offensePlayers.find((p) => p.role === role) ?? null

  const isHome = offense === game.home
  const ctx = game.projection
    ? {
        teamPoints: isHome ? game.projection.homeTeamTotal : game.projection.awayTeamTotal,
        teamAverage: data.ratings?.[offense]?.ppg ?? 22,
        opponent: defense,
        marginForTeam: isHome ? game.projection.margin : -game.projection.margin
      }
    : null

  // The softest spots that have someone to face them; without rosters, the softest spots alone.
  const rows = []
  for (const spot of found?.spots ?? []) {
    if (rows.length >= SPOTS_SHOWN) break
    const player = rosters ? leadFor(spot.role) : null
    if (rosters && !player) continue
    let projection = null
    if (player && ctx) {
      const market = VOLUME_MARKETS.find((m) => m.key === spot.stat)
      const v = projectVolume(player, market, ctx)
      if (v && !v.synthetic) {
        projection = { mean: v.mean, low: quantileFor(spot.stat, v.mean, 0.25), high: quantileFor(spot.stat, v.mean, 0.75) }
      }
    }
    const recentKey = player ? `${normPropName(player.name)}|${player.position === 'FB' ? 'RB' : player.position}` : null
    rows.push({ spot, player, projection, last5: recentKey ? recentValues(recent, recentKey, spot.stat) : [] })
  }

  return (
    <section className="panel">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
        <div>
          <div className="eyebrow">
            What it allows, by position{found?.isPrior ? ` · ${found.season} season (none played this season yet)` : ''}
          </div>
          <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>
            <span className="row gap-2">
              <TeamMark abbr={defense} size={20} />
              {defTeam.name} defense
              <span className="dim" style={{ fontSize: 'var(--t-small)', fontWeight: 400 }}>· {offTeam.name} to target</span>
            </span>
          </h2>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="dim" style={{ fontSize: 12, margin: 0, padding: 'var(--s4)' }}>No positional numbers on record for this defense yet.</p>
      ) : (
        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Allowed to</th>
                <th>Per game</th>
                <th>Player</th>
                <th>Projection</th>
                <th>Last 5</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ spot, player, projection, last5 }) => (
                <tr key={spot.key}>
                  <td data-label="Allowed to">
                    <span className="row gap-2" style={{ flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
                      <span className={`mono ${rankTone(spot.rank) ?? 'dim'}`} style={{ minWidth: 34 }}>{ordinal(spot.rank)}</span>
                      <span>{spot.label} <span className="dim">to {spot.to}</span></span>
                      {spot.mattered && <Badge tone="quiet">has mattered</Badge>}
                    </span>
                  </td>
                  <td className="num" data-label="Per game">{fmtValue(spot.stat, spot.perGame)}</td>
                  <td data-label="Player">
                    {player
                      ? (
                        <span className="row gap-2">
                          <TeamMark abbr={offense} size={16} />
                          <span>{player.name}</span>
                          {player.injury && !/active/i.test(player.injury) && <Badge tone="live">{player.injury}</Badge>}
                        </span>
                      )
                      : <span className="dim">—</span>}
                  </td>
                  <td className="num" data-label="Projection">
                    {projection
                      ? <span>{fmtValue(spot.stat, projection.mean)} <span className="dim">{Math.round(projection.low)}–{Math.round(projection.high)}</span></span>
                      : <span className="dim">{player ? 'no rate yet' : '—'}</span>}
                  </td>
                  <td className="num" data-label="Last 5">
                    {last5.length
                      ? (
                        <span title={last5.map((g) => `Wk ${g.week} vs ${g.opp}: ${Math.round(g.value)}`).join('\n')}>
                          {last5.map((g) => Math.round(g.value)).join(' · ')}
                        </span>
                      )
                      : <span className="dim">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {extras.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--s3)',
            padding: 'var(--s3) var(--s4) var(--s4)',
            borderTop: '1px solid var(--edge)'
          }}
        >
          {extras.map((x) => (
            <div key={x.key}>
              <div className="dim" style={{ fontSize: 11 }}>{x.label}</div>
              <div className="row gap-2" style={{ marginTop: 2 }}>
                <span className="mono">{x.perGame.toFixed(1)}</span>
                <span className={`mono ${rankTone(x.rank, x.goodForOffenseWhen) ?? 'dim'}`} style={{ fontSize: 11 }}>{ordinal(x.rank)} most</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
