import { useMemo } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Badge, Empty } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { gradeCard, summarise } from '../lib/grading.js'
import { fmtOdds, fmtPct, fmtMoney, fmtSigned, fmtDay } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * Results.
 *
 * The page that decides whether any of the rest of this app is worth using.
 * It grades only frozen cards, reports units rather than just currency, and
 * leads with whether the sample is large enough to mean anything — because
 * a betting record without a sample-size caveat is decoration.
 */
export default function ResultsView({ data }) {
  const { lockedCards, settings, dispatch } = useStore()

  const gamesById = useMemo(() => {
    const m = {}
    for (const g of data.games) m[g.id] = g
    return m
  }, [data.games])

  const graded = useMemo(
    () => lockedCards.map((c) => gradeCard(c, gamesById)),
    [lockedCards, gamesById]
  )

  const unitSize = (settings.bankroll ?? 1000) * 0.01
  const stats = useMemo(() => summarise(graded, unitSize), [graded, unitSize])

  if (!lockedCards.length) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <div className="eyebrow">Graded from frozen cards only</div>
            <h1 className="page-title">Results</h1>
          </div>
        </header>
        <Empty title="No cards locked yet">
          Lock a card from the Card tab and it will be graded here once those games
          go final. Only locked cards are graded — re-deriving old plays from the
          current model would grade a card you never actually made.
        </Empty>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Graded from frozen cards only</div>
          <h1 className="page-title">Results</h1>
        </div>
      </header>

      {/* The verdict comes first, before any record that might flatter. */}
      <section
        className="panel"
        style={{
          padding: 'var(--s4)',
          marginBottom: 'var(--s4)',
          borderColor:
            stats.significance.level === 'signal' ? 'rgba(63,217,164,0.35)' : 'var(--line)'
        }}
      >
        <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
          <Badge tone={stats.significance.level === 'signal' ? 'edge' : 'quiet'}>
            {stats.significance.level === 'signal' ? 'Signal' : 'Not yet meaningful'}
          </Badge>
          <p className="dim grow" style={{ fontSize: 12, margin: 0, maxWidth: '80ch' }}>
            {stats.significance.verdict}
            {stats.significance.needed && stats.decided >= 30 && (
              <> At the rate observed so far, roughly {stats.significance.needed} decided plays
              would be needed before the result is convincing.</>
            )}
          </p>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
        <div className="panel-head">
          <h2 style={{ fontSize: 'var(--t-base)' }}>Running record</h2>
          <span className="eyebrow">1u = {fmtMoney(unitSize)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <Stat
            label="Record"
            value={`${stats.wins}-${stats.losses}${stats.pushes ? `-${stats.pushes}` : ''}`}
            sub={stats.pending ? `${stats.pending} pending` : 'all settled'}
          />
          <Stat
            label="Win rate"
            value={stats.winRate == null ? '—' : fmtPct(stats.winRate, 1)}
            sub={`need ${fmtPct(stats.breakEven, 1)} to break even`}
            tone={stats.winRate != null && stats.winRate > stats.breakEven ? 'pos' : undefined}
          />
          <Stat
            label="Units"
            value={fmtSigned(stats.units, 2)}
            tone={stats.units > 0 ? 'pos' : stats.units < 0 ? 'neg' : undefined}
          />
          <Stat
            label="ROI"
            value={stats.staked ? `${stats.roi > 0 ? '+' : ''}${(stats.roi * 100).toFixed(1)}%` : '—'}
            sub={stats.staked ? `on ${fmtMoney(stats.staked)} staked` : undefined}
            tone={stats.roi > 0 ? 'pos' : stats.roi < 0 ? 'neg' : undefined}
          />
        </div>
      </section>

      {Object.keys(stats.byMarket).length > 1 && (
        <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>By market</h2>
            <span className="eyebrow">Where the edge is, if anywhere</span>
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr><th style={{ textAlign: 'left' }}>Market</th><th>W</th><th>L</th><th>P</th><th>Profit</th><th>ROI</th></tr>
              </thead>
              <tbody>
                {Object.entries(stats.byMarket).map(([market, r]) => (
                  <tr key={market}>
                    <td style={{ textAlign: 'left' }}>{MARKET_NAMES[market] || market}</td>
                    <td className="num">{r.wins}</td>
                    <td className="num">{r.losses}</td>
                    <td className="num dim">{r.pushes}</td>
                    <td className={`num ${r.profit > 0 ? 'pos' : r.profit < 0 ? 'neg' : 'dim'}`}>
                      {r.profit >= 0 ? '+' : ''}{fmtMoney(r.profit)}
                    </td>
                    <td className={`num ${r.profit > 0 ? 'pos' : r.profit < 0 ? 'neg' : 'dim'}`}>
                      {r.staked ? `${((r.profit / r.staked) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4)', margin: 0 }}>
            Splitting a small sample by market makes each slice smaller still. A market
            showing a strong ROI over a handful of plays is telling you almost nothing.
          </p>
        </section>
      )}

      <h2 style={{ fontSize: 'var(--t-lg)', marginBottom: 'var(--s3)' }}>Locked cards</h2>
      <div style={{ display: 'grid', gap: 'var(--s4)' }}>
        {graded.map((card) => (
          <CardResult key={card.id} card={card} dispatch={dispatch} />
        ))}
      </div>
    </div>
  )
}

const MARKET_NAMES = {
  spread: 'Spread',
  total: 'Game total',
  teamTotal: 'Team total',
  moneyline: 'Moneyline'
}

function CardResult({ card, dispatch }) {
  const settledLegs = card.legs.filter((l) => l.result !== 'pending')
  const w = settledLegs.filter((l) => l.result === 'win').length
  const l = settledLegs.filter((l) => l.result === 'loss').length
  const p = settledLegs.filter((l) => l.result === 'push').length

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">
            Locked {new Date(card.lockedAt).toLocaleString()} · {card.source} prices
          </div>
          <h3 style={{ fontSize: 'var(--t-base)', marginTop: 4 }}>{fmtDay(card.kickoff)}</h3>
        </div>
        <div className="row gap-3">
          {card.complete ? (
            <Badge tone={card.profit > 0 ? 'edge' : card.profit < 0 ? 'live' : 'quiet'}>
              {w}-{l}{p ? `-${p}` : ''} · {card.profit >= 0 ? '+' : ''}{fmtMoney(card.profit)}
            </Badge>
          ) : (
            <Badge tone="quiet">{card.pending} pending</Badge>
          )}
          <button
            className="btn ghost"
            onClick={() => dispatch({ type: 'unlockCard', id: card.id })}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Play</th>
              <th style={{ textAlign: 'left' }}>Game</th>
              <th>Price</th>
              <th>Stake</th>
              <th>Score</th>
              <th>Result</th>
              <th>P/L</th>
            </tr>
          </thead>
          <tbody>
            {card.legs.map((leg) => (
              <tr key={leg.id}>
                <td style={{ textAlign: 'left' }}>
                  <span className="row gap-2">
                    <span className="team-name">{leg.label}</span>
                    {leg.suspicious && <Badge tone="live">Flagged</Badge>}
                  </span>
                  <div className="dim mono" style={{ fontSize: 10 }}>
                    {leg.units}u {leg.tierLabel} · {leg.book}
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <a className="row gap-2 dim" href={href(`game/${leg.gameId}`)}>
                    <span className="mono" style={{ fontSize: 11 }}>{leg.matchup}</span>
                  </a>
                </td>
                <td className="num market">{fmtOdds(leg.price)}</td>
                <td className="num dim">{fmtMoney(leg.stake)}</td>
                <td className="num dim">
                  {leg.finalScore
                    ? `${leg.finalScore.awayAbbr} ${leg.finalScore.away}–${leg.finalScore.home} ${leg.finalScore.homeAbbr}`
                    : '—'}
                </td>
                <td>
                  <ResultChip result={leg.result} />
                </td>
                <td className={`num ${leg.profit > 0 ? 'pos' : leg.profit < 0 ? 'neg' : 'dim'}`}>
                  {leg.result === 'pending' ? '—' : `${leg.profit >= 0 ? '+' : ''}${fmtMoney(leg.profit)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4)', margin: 0 }}>
        Graded against the numbers as they were when the card was locked: HFA{' '}
        {card.settings.homeField}, σ {card.settings.marginSigma}, {card.settings.devigMethod} devig.
      </p>
    </section>
  )
}

function ResultChip({ result }) {
  if (result === 'win') return <Badge tone="edge">Won</Badge>
  if (result === 'loss') return <Badge tone="live">Lost</Badge>
  if (result === 'push') return <Badge tone="chalk">Push</Badge>
  return <span className="dim mono" style={{ fontSize: 11 }}>Pending</span>
}

function Stat({ label, value, sub, tone }) {
  return (
    <div style={{ padding: 'var(--s4)', borderRight: '1px solid var(--line)' }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div
        className={tone || ''}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--t-xl)' }}
      >
        {value}
      </div>
      {sub && <div className="dim mono" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  )
}
