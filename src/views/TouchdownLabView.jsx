import { useEffect, useMemo, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Badge, Empty, Segmented } from '../components/Controls.jsx'
import { daysFrom } from '../lib/card.js'
import { touchdownBoard, priceOutlook, rankScorers } from '../lib/touchdownLab.js'
import { normPropName } from '../lib/props.js'
import { teamRecord } from '../lib/ratings.js'
import { fetchGameRosters } from '../data/providers/playerData.js'
import { load, save } from '../lib/storage.js'
import { fmtPct, fmtDay, fmtTime, relativeDay, ordinal } from '../lib/format.js'
import { href } from '../lib/router.js'
import propAccuracy from '../data/generated/prop-accuracy.json'

/**
 * Rosters fetched for a game, kept for a few minutes so flipping to another
 * tab and back does not pull every roster and depth chart again.
 */
const ROSTER_TTL_MS = 10 * 60 * 1000
const rosterCache = new Map()
async function rostersFor(game) {
  const hit = rosterCache.get(game.id)
  if (hit && Date.now() - hit.at < ROSTER_TTL_MS) return hit.rosters
  const rosters = await fetchGameRosters(game)
  rosterCache.set(game.id, { at: Date.now(), rosters })
  return rosters
}

/** Below this a player is in the long tail — hidden until asked for, so the list stays readable. */
const TAIL_PROB = 0.08

const POSITIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'TE', label: 'TE' }
]

/**
 * Touchdown Lab.
 *
 * Every player's chance to score across a day's games — the Card's
 * touchdown column with the four-lead-players cap taken off — plus what
 * each number is built from, a box to check a sportsbook price against it,
 * and the model's measured record on exactly this question.
 */
export default function TouchdownLabView({ data }) {
  const days = useMemo(() => daysFrom(data.games), [data.games])
  const defaultKey = useMemo(() => {
    const upcoming = days.find((d) => d.games.some((g) => g.status === 'scheduled'))
    return (upcoming || days[days.length - 1])?.key
  }, [days])
  const [dayKeySel, setDayKeySel] = useState(defaultKey)
  const day = days.find((d) => d.key === dayKeySel) || days[0]

  const [state, setState] = useState({ status: 'idle', dayKey: null, rows: [], failed: 0, failureReason: null })
  const [position, setPosition] = useState('ALL')
  const [showTail, setShowTail] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Prices typed in from the user's own sportsbook, per game and player —
  // kept across visits and pruned to games still on the schedule.
  const [prices, setPrices] = useState(() => load('tdPrices', {}))
  const setPrice = (key, value) => {
    setPrices((prev) => {
      const gameIds = new Set(data.games.map((g) => g.id))
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => gameIds.has(k.split('|')[0])))
      if (value) next[key] = value
      else delete next[key]
      save('tdPrices', next)
      return next
    })
  }

  // Which games can still be scored in. Keyed on ids rather than the game
  // objects, which are rebuilt every time live scores refresh.
  const targetIds = (day?.games ?? []).filter((g) => g.projection && g.status !== 'final').map((g) => g.id).join(',')

  useEffect(() => {
    if (!day) return
    let alive = true
    const targets = day.games.filter((g) => g.projection && g.status !== 'final')
    if (!targets.length) {
      setState({ status: 'ready', dayKey: day.key, rows: [], failed: 0, failureReason: null })
      return
    }
    setState((prev) => ({ ...prev, status: 'loading', dayKey: day.key }))
    Promise.allSettled(targets.map(async (g) => touchdownBoard({ game: g, proj: g.projection, rosters: await rostersFor(g) })))
      .then((settled) => {
        if (!alive) return
        const failures = settled.filter((r) => r.status === 'rejected')
        setState({
          status: 'ready',
          dayKey: day.key,
          rows: settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value),
          failed: failures.length,
          failureReason: failures[0]?.reason?.message ?? null
        })
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day?.key, targetIds, attempt])

  if (!days.length) {
    return (
      <div className="page">
        <Empty title="No games loaded">There is no slate to project touchdowns for.</Empty>
      </div>
    )
  }

  const ready = state.status === 'ready' && state.dayKey === day.key
  const rows = ready ? state.rows : []
  const ranked = rankScorers(rows, { position })
  const visible = showTail ? ranked : ranked.filter((r) => r.prob >= TAIL_PROB)
  const hidden = ranked.length - visible.length
  const games = gameSummaries(rows, day.games)
  const depthUnknown = rows.some((r) => !r.depthKnown)
  const recordOf = (abbr) => teamRecord(data.ratings?.[abbr], data.ratingsState?.applied)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Every player&apos;s chance to score · no odds key needed</div>
          <h1 className="page-title">Touchdown lab</h1>
        </div>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {days.map((d) => (
            <button
              key={d.key}
              className="btn"
              aria-pressed={d.key === day.key}
              onClick={() => { setDayKeySel(d.key); setShowTail(false) }}
              style={
                d.key === day.key
                  ? { background: 'var(--slab-lift)', color: 'var(--bone)', borderColor: 'var(--line-hi)' }
                  : undefined
              }
            >
              {relativeDay(d.kickoff) ?? fmtDay(d.kickoff)}
            </button>
          ))}
        </div>
      </header>

      {!ready && (
        <div className="panel" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)' }}>
          <p className="dim" style={{ fontSize: 12, margin: 0 }}>Pulling rosters and depth charts for {fmtDay(day.kickoff)}…</p>
        </div>
      )}

      {ready && state.failed > 0 && (
        <div className="panel" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)' }}>
          <p className="neg" style={{ fontSize: 12, margin: 0 }}>
            {state.failed} game{state.failed === 1 ? '' : 's'} could not be loaded
            {state.failureReason ? ` — ${state.failureReason.replace(/\.+$/, '')}` : ''}.{' '}
            <button className="btn ghost" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </p>
        </div>
      )}

      {ready && rows.length === 0 && state.failed === 0 && (
        <Empty title="Nothing left to score in">Every game on this day is final, or none can be projected yet. Pick another day.</Empty>
      )}

      {ready && games.length > 0 && (
        <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
          <div className="panel-head">
            <div>
              <div className="eyebrow">{fmtDay(day.kickoff)} · how many touchdowns each team is expected to score</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Team outlook</h2>
            </div>
            <Badge tone="quiet">{games.length} game{games.length === 1 ? '' : 's'}</Badge>
          </div>
          <div className="tbl-scroll">
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Expected touchdowns</th>
                  <th>Most likely to score</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => (
                  <tr key={g.game.id}>
                    <td data-label="Game">
                      <a href={href(`game/${g.game.id}`)} className="row gap-2" style={{ flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
                        <TeamMark abbr={g.game.away} size={16} />
                        <TeamMark abbr={g.game.home} size={16} />
                        <span>
                          {g.game.away}<RecordTag record={recordOf(g.game.away)} /> @ {g.game.home}<RecordTag record={recordOf(g.game.home)} />
                        </span>
                        <span className="dim">{fmtTime(g.game.kickoff)}</span>
                      </a>
                    </td>
                    <td className="num" data-label="Expected touchdowns">
                      <span>{g.game.away} {fmtTds(g.away)} <span className="dim">·</span> {g.game.home} {fmtTds(g.home)}</span>
                    </td>
                    <td className="num" data-label="Most likely to score">
                      {g.top ? <span>{g.top.name} <span className="dim">{fmtPct(g.top.prob, 0)}</span></span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ready && rows.length > 0 && (
        <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
          <div className="panel-head" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
            <div>
              <div className="eyebrow">Ranked across every game on the day</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Scorer board</h2>
            </div>
            <Segmented label="Position" options={POSITIONS} value={position} onChange={setPosition} />
          </div>
          {visible.length === 0 ? (
            <p className="dim" style={{ fontSize: 12, margin: 0, padding: 'var(--s4)' }}>No one at this position clears {fmtPct(TAIL_PROB, 0)}.</p>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Scores</th>
                    <th>2+ TDs</th>
                    <th>This season</th>
                    <th>Opponent allows</th>
                    <th>Your price</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => {
                    const key = `${r.gameId}|${normPropName(r.name)}`
                    return (
                      <ScorerRow key={key} rank={i + 1} row={r} value={prices[key]} onPrice={(v) => setPrice(key, v)} />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(hidden > 0 || showTail) && (
            <div style={{ padding: 'var(--s3) var(--s4)' }}>
              <button className="btn" onClick={() => setShowTail((v) => !v)}>
                {showTail ? `Hide players under ${fmtPct(TAIL_PROB, 0)}` : `Show ${hidden} more under ${fmtPct(TAIL_PROB, 0)}`}
              </button>
            </div>
          )}
          <p className="dim" style={{ fontSize: 11, padding: '0 var(--s4) var(--s4)', margin: 0, maxWidth: '82ch' }}>
            <strong>Scores</strong> is the chance of at least one rushing or receiving touchdown (a
            quarterback&apos;s passing touchdowns belong to whoever caught them). It is built from the
            touchdowns his team is expected to score in this game and his share of them — his own
            scoring rate, pulled toward what his role usually gets while the sample is small, which
            is why a player with two touchdowns in one game is not shown as a near-lock.{' '}
            <strong>Opponent allows</strong> is context for you, not an input: the team total already
            reflects how good the opponent is.{' '}
            <strong>Your price</strong>: type your sportsbook&apos;s anytime-touchdown price to see the
            chance that price pays out at and the expected return if the model is right. Books keep
            a large cut on this market, so the model sitting a little under the price&apos;s chance
            is normal, not a sign either is wrong.
            {depthUnknown && (
              <> Where no depth chart was published, players at a position share one flat estimate, so their order within it means little.</>
            )}
            {' '}A player ruled Out is left off; Questionable and Doubtful players are shown as if they play.
          </p>
        </section>
      )}

      <TouchdownRecord record={propAccuracy} />

      <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
        Not here on purpose: first-touchdown-scorer odds and red-zone usage. Both need play-by-play
        data this app does not have, and a guess dressed up as a number would be worse than leaving
        them out.{' '}
        {!data.simulatedPrices && <a href={href('odds')} style={{ color: 'var(--gold)' }}>Live odds board</a>}
      </p>
    </div>
  )
}

// Cell contents below are each wrapped in a single element: the phone layout
// lays a cell out as a flex row, which would push loose fragments to opposite ends.
const fmtTds = (n) => (n == null ? '—' : n.toFixed(1))

/** A team's win-loss record in brackets after its name — marked when it is last season's, not this one's. */
function RecordTag({ record }) {
  if (!record) return null
  return (
    <span className="dim" title={record.lastSeason ? 'Last season\'s final record — none of this season\'s results are loaded yet.' : 'Record this season.'}>
      {' '}({record.text}{record.lastSeason ? ' last yr' : ''})
    </span>
  )
}

/** One line per game: each team's expected touchdowns and the single most likely scorer. */
function gameSummaries(rows, dayGames) {
  const byGame = new Map()
  for (const r of rows) {
    if (!byGame.has(r.gameId)) byGame.set(r.gameId, [])
    byGame.get(r.gameId).push(r)
  }
  return dayGames
    .filter((g) => byGame.has(g.id))
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .map((game) => {
      const list = byGame.get(game.id)
      return {
        game,
        home: list.find((r) => r.home)?.teamExpectedTds ?? null,
        away: list.find((r) => !r.home)?.teamExpectedTds ?? null,
        top: [...list].sort((a, b) => b.prob - a.prob)[0] ?? null
      }
    })
}

function ScorerRow({ rank, row, value, onPrice }) {
  const outlook = priceOutlook(row.prob, value)
  const d = row.defense
  return (
    <tr>
      <td data-label="Player">
        <span className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <span className="dim mono" style={{ minWidth: 18 }}>{rank}</span>
          <TeamMark abbr={row.team} size={16} />
          <span>{row.name}</span>
          <span className="dim">{row.position} · {row.home ? 'vs' : '@'} {row.opponent}</span>
          {row.injury && !/active/i.test(row.injury) && <Badge tone="live">{row.injury}</Badge>}
        </span>
      </td>
      <td className="num" data-label="Scores">{fmtPct(row.prob, 0)}</td>
      <td className="num dim" data-label="2+ TDs">{fmtPct(row.twoPlus, 0)}</td>
      <td className="num" data-label="This season">
        {row.tds == null
          ? <span className="dim">no games yet</span>
          : <span>{row.tds} TD{row.tds === 1 ? '' : 's'} <span className="dim">in {row.games} game{row.games === 1 ? '' : 's'}{row.priorSeason ? ' · last yr' : ''}</span></span>}
      </td>
      <td className="num" data-label={`${row.opponent} allows`}>
        {d
          ? (
            <span title={`${row.opponent} has allowed ${d.perGame} ${d.side} touchdowns a game${d.isPrior ? ` (${d.season} season)` : ''}.`}>
              {d.perGame.toFixed(1)} <span className="dim">{d.side === 'rushing' ? 'rush' : 'rec'} TD/g{d.rank ? ` · ${ordinal(d.rank)} most` : ''}</span>
            </span>
          )
          : <span className="dim">—</span>}
      </td>
      <td className="num" data-label="Your price">
        {/* minWidth 0 + flex lets this shrink inside the phone layout's flex row so the result wraps rather than overflowing. */}
        <div className="row gap-2" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ fontSize: 11, whiteSpace: 'normal' }} aria-live="polite">
            {outlook?.invalid && <span className="neg">not a price</span>}
            {outlook && !outlook.invalid && (
              <>
                <span className="dim">pays at {fmtPct(outlook.implied, 0)} · </span>
                {outlook.suspicious
                  ? <span className="neg" title="An edge this large on a touchdown price is far more likely to be a mistyped price or a depth chart the model has wrong than free money.">check price</span>
                  : <span className={outlook.ev > 0 ? 'pos' : 'neg'}>{outlook.ev > 0 ? '+' : ''}{(outlook.ev * 100).toFixed(0)}% return</span>}
              </>
            )}
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="+450"
            value={value ?? ''}
            onChange={(e) => onPrice(e.target.value.trim())}
            style={{ width: 74, textAlign: 'right' }}
            aria-label={`Your sportsbook's anytime touchdown price for ${row.name}`}
          />
        </div>
      </td>
    </tr>
  )
}

/** The model's measured record on exactly this question, regraded with the weekly stats refresh. */
function TouchdownRecord({ record }) {
  const td = record?.touchdownsAll
  if (!td?.n) return null
  return (
    <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
      <div className="panel-head">
        <div>
          <div className="eyebrow">Track record · {record.season} season, weeks {record.fromWeek}–{record.throughWeek}</div>
          <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>When it said 30%, did they score 30% of the time?</h2>
        </div>
        <Badge tone="quiet">{td.n.toLocaleString()} player-games</Badge>
      </div>
      <div style={{ padding: 'var(--s4)' }}>
        <div className="tbl-scroll">
          <table className="tbl compact" style={{ maxWidth: 520 }}>
            <thead>
              <tr>
                <th>Model said</th>
                <th>Actually scored</th>
                <th>Player-games</th>
              </tr>
            </thead>
            <tbody>
              {td.calibration.buckets.map((b) => (
                <tr key={b.predicted}>
                  <td className="mono">{fmtPct(b.predicted, 0)}</td>
                  <td className="num">{fmtPct(b.actual, 0)}</td>
                  <td className="num dim">{b.n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 11, margin: 'var(--s3) 0 0', maxWidth: '82ch' }}>
          Every week so far was projected from only the weeks before it, for every player who took
          the field, and compared with who actually scored. Players are grouped by the chance the
          model gave them; the closer the two columns, the more a number on the board can be taken
          at face value. On average they are {(td.calibration.gap * 100).toFixed(1)} points apart.
          Groups with few player-games (the highest chances) move around more. Roles are taken from
          who had the most chances in earlier weeks, since past depth charts aren&apos;t published.
          Updated {new Date(record.generatedAt).toLocaleDateString()}.
        </p>
      </div>
    </section>
  )
}
