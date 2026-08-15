import { useMemo, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import EdgeRail from '../components/EdgeRail.jsx'
import { Badge, Empty, Tabs } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { toSlipLeg } from '../lib/edges.js'
import { buildCard, daysFrom, confidenceOf, lockCard } from '../lib/card.js'
import ResultsView from './ResultsView.jsx'
import {
  fmtOdds, fmtPct, fmtMoney, fmtSigned, fmtDay, fmtTime, relativeDay
} from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * Card of the Day.
 *
 * One play per game at the best price, tiered by conviction, with every
 * skipped game listed and a reason attached. The passes are the point: a
 * card that plays everything is not selective, and selectivity is the only
 * thing separating this from a list of games.
 */
export default function CardView({ data }) {
  const { settings, lockedCards, dispatch } = useStore()
  const [tab, setTab] = useState('today')
  const days = useMemo(() => daysFrom(data.games), [data.games])

  // Default to the first day that still has games to bet, else the last day.
  const defaultKey = useMemo(() => {
    const upcoming = days.find((d) => d.games.some((g) => g.status === 'scheduled'))
    return (upcoming || days[days.length - 1])?.key
  }, [days])

  const [dayKeySel, setDayKeySel] = useState(defaultKey)
  const day = days.find((d) => d.key === dayKeySel) || days[0]

  const { reads, plays, leans, stats } = useMemo(
    () => buildCard(day?.games ?? [], settings),
    [day, settings]
  )

  // If today is quiet, say which days are not — without implying the quiet
  // day is a failure.
  const daysWithPlays = useMemo(
    () =>
      days
        .filter((d) => d.key !== day?.key && buildCard(d.games, settings).plays.length > 0)
        .map((d) => relativeDay(d.kickoff) ?? fmtDay(d.kickoff)),
    [days, day, settings]
  )
  const confidence = useMemo(
    () => confidenceOf(day?.games ?? [], settings),
    [day, settings]
  )

  if (!days.length) {
    return (
      <div className="page">
        <Empty title="No games loaded">There is no slate to build a card from.</Empty>
      </div>
    )
  }

  const locked = lockedCards.find((c) => c.dayKey === day?.key)

  const lock = () => {
    dispatch({
      type: 'lockCard',
      card: lockCard({
        dayKey: day.key,
        kickoff: day.kickoff,
        plays,
        settings,
        source: data.simulatedPrices ? 'simulated' : 'live'
      })
    })
    setTab('results')
  }

  const addAll = () => {
    for (const p of plays) { // staked plays only; leans carry no stake
      dispatch({
        type: 'addLeg',
        leg: { ...toSlipLeg(p.best), stake: Math.max(1, Math.round(p.stake)) }
      })
    }
  }

  if (tab === 'results') {
    return (
      <>
        <div className="page" style={{ paddingBottom: 0 }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'today', label: 'Card' },
              { value: 'results', label: 'Results', count: lockedCards.length }
            ]}
          />
        </div>
        <ResultsView data={data} />
      </>
    )
  }

  return (
    <div className="page">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'today', label: 'Card' },
          { value: 'results', label: 'Results', count: lockedCards.length }
        ]}
      />
      <header className="page-head" style={{ marginTop: 'var(--s5)' }}>
        <div>
          <div className="eyebrow">One play per game · best price across books</div>
          <h1 className="page-title">Card of the day</h1>
        </div>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {days.map((d) => (
            <button
              key={d.key}
              className="btn"
              aria-pressed={d.key === day.key}
              onClick={() => setDayKeySel(d.key)}
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

      {/* Confidence banner — loud when the slate does not deserve trust. */}
      <div
        className="panel"
        style={{
          padding: 'var(--s4)',
          marginBottom: 'var(--s4)',
          borderColor:
            confidence.level === 'low' ? 'rgba(242,193,78,0.4)' : 'var(--line)'
        }}
      >
        <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
          <Badge tone={confidence.level === 'low' ? 'chalk' : 'quiet'}>
            {confidence.label}
          </Badge>
          <p className="dim grow" style={{ fontSize: 12, margin: 0, maxWidth: '80ch' }}>
            {confidence.note}
          </p>
        </div>
      </div>

      {/* Card summary */}
      <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">{fmtDay(day.kickoff)}</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>
              {day.games.length} game{day.games.length === 1 ? '' : 's'} ·{' '}
              {plays.length
                ? `${plays.length} worth a stake`
                : 'none worth a stake'}
            </h2>
          </div>
          {plays.length > 0 && (
            <div className="row gap-2">
              <button className="btn" onClick={addAll}>Add to slip</button>
              <button className="btn primary" onClick={lock}>
                {locked ? 'Re-lock card' : 'Lock card'}
              </button>
            </div>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))'
          }}
        >
          <Stat
            label="Reads"
            value={`${plays.length} + ${leans.length}`}
            sub="staked + leans"
          />
          <Stat label="Units" value={stats.units} sub={`1u = ${fmtMoney(stats.unit)}`} />
          <Stat label="At risk" value={fmtMoney(stats.risked)} sub={`${(stats.bankrollPct * 100).toFixed(1)}% of bankroll`} />
          <Stat
            label="Expected return"
            value={`${stats.expected >= 0 ? '+' : ''}${fmtMoney(stats.expected)}`}
            sub={`${(stats.expectedPct * 100).toFixed(1)}% of stake`}
            tone={stats.expected > 0 ? 'pos' : undefined}
          />
          <Stat
            label={stats.suspicious ? 'Flagged' : 'Model expects'}
            value={
              stats.suspicious
                ? `${stats.suspicious} / ${plays.length}`
                : plays.length ? `${stats.expectedWinners.toFixed(1)} / ${plays.length}` : '—'
            }
            sub={stats.suspicious ? 'implausible edges' : 'winners'}
            tone={stats.suspicious ? 'neg' : undefined}
          />
        </div>
      </section>

      {/* The card */}
      {reads.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
          {reads.map((entry) => (
            <PlayCard key={entry.best.id} entry={entry} dispatch={dispatch} />
          ))}
        </div>
      )}

      {locked && (
        <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
          This card was locked {new Date(locked.lockedAt).toLocaleString()} and will be graded
          under Results once the games go final. Re-locking replaces that snapshot — which is
          worth avoiding once kickoff has passed, since a card changed after the fact is not
          the card you would have bet.
        </p>
      )}

      <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
        Every game on the slate gets the model's read. Only the ones carrying units are
        worth a stake — a lean means the model likes a side but there is no edge left after
        the vig, and betting those is how a card bleeds. Locking freezes the staked plays at
        today's prices so they can be graded honestly later; leans are not locked, because
        they were never bets.{' '}
        Tiers require both an EV threshold and a minimum points of disagreement, so a
        large EV built on a quarter-point gap will not make the card. Only one play per
        game is listed: a spread and a total on the same game express the same opinion
        about the same roster, and stacking them quietly doubles the bet.
      </p>
    </div>
  )
}

/* ---------- One play, as a ticket ---------- */

function PlayCard({ entry, dispatch }) {
  const { game, best, tier, alternate, stake, kellyStake, reason } = entry
  const isLean = tier.units === 0
  const consensus = game.market?.books?.find((b) => b.sharp) || game.market?.books?.[0]
  // Guard the divide: a lean has no flat stake to compare Kelly against.
  const kellyGap = stake > 0 && kellyStake > 0 ? kellyStake / stake : 0

  // The rail must argue for the play on the card. Showing a spread number
  // line under a totals play compares two things that have nothing to do
  // with each other.
  const rail = useMemo(() => {
    if (!consensus || !game.projection) return null
    if (best.type === 'teamTotal') {
      const isHome = best.side.startsWith('home')
      const projPts = isHome ? game.projection.homeTeamTotal : game.projection.awayTeamTotal
      const posted = consensus.teamTotal?.[isHome ? 'home' : 'away']?.line
      if (posted == null || projPts == null) return null
      return {
        kind: 'team total',
        market: posted,
        model: projPts,
        keyNumbers: [],
        format: (n) => String(n),
        describe: (m, mo, gap) =>
          `Market team total is ${m}. The model projects ${mo}, a gap of ${gap.toFixed(1)} points.`
      }
    }
    if (best.type === 'total') {
      return {
        kind: 'total',
        market: consensus.total.line,
        model: game.projection.total,
        keyNumbers: [],   // 3 and 7 are spread numbers, not totals numbers
        format: (n) => String(n),
        describe: (m, mo, gap) =>
          `Market total is ${m}. The model projects ${mo}, a gap of ${gap.toFixed(1)} points.`
      }
    }
    return {
      kind: 'spread',
      market: consensus.spread.home.line,
      model: game.projection.modelSpreadHome,
      keyNumbers: undefined,
      format: undefined,
      describe: undefined
    }
  }, [consensus, game.projection, best.type])

  return (
    <article
      className="panel"
      style={{ overflow: 'hidden', opacity: isLean ? 0.72 : 1 }}
    >
      <div className="gcard-strap">
        <span className="row gap-2">
          <TeamMark abbr={game.away} size={16} />
          <TeamMark abbr={game.home} size={16} />
          {game.away} @ {game.home}
        </span>
        <span>{fmtTime(game.kickoff)}{game.venue ? ` · ${game.venue}` : ''}</span>
      </div>

      <div style={{ padding: 'var(--s4)' }}>
        <div
          className="row spread-between gap-4"
          style={{ flexWrap: 'wrap', marginBottom: 'var(--s4)' }}
        >
          <div style={{ minWidth: 200 }}>
            <div className="row gap-3" style={{ marginBottom: 6 }}>
              <Badge tone={tier.tone}>
                {isLean ? 'Lean · no stake' : `${tier.units}u · ${tier.label}`}
              </Badge>
              {best.sharp && <Badge tone="quiet">Sharp book</Badge>}
            </div>
            <h3 style={{ fontSize: 'var(--t-xl)' }}>{best.label}</h3>
            <div className="row gap-3" style={{ marginTop: 4 }}>
              <span className="mono market" style={{ fontSize: 'var(--t-lg)' }}>
                {fmtOdds(best.price)}
              </span>
              <span className="dim mono" style={{ fontSize: 12 }}>{best.book}</span>
            </div>
          </div>

          <div className="row gap-5" style={{ flexWrap: 'wrap' }}>
            <Metric label="Model" value={fmtPct(best.modelProb)} />
            <Metric label="No-vig" value={fmtPct(best.marketProb)} dim />
            <Metric label="Edge" value={`${fmtSigned(best.edgePoints)} pts`} />
            <Metric
              label="EV"
              value={`${best.ev >= 0 ? '+' : ''}${(best.ev * 100).toFixed(1)}%`}
              tone={best.ev > 0 ? 'pos' : best.ev < 0 ? 'neg' : undefined}
            />
            <Metric label="Stake" value={isLean ? '—' : fmtMoney(stake)} dim={isLean} />
          </div>
        </div>

        {rail && (
          <div style={{ marginBottom: 'var(--s3)' }}>
            <div className="row spread-between" style={{ marginBottom: 2 }}>
              <span className="eyebrow" style={{ color: 'var(--gold)' }}>
                Market {rail.kind}
              </span>
              <span className="eyebrow" style={{ color: 'var(--sky)' }}>Model</span>
            </div>
            <EdgeRail
              marketLine={rail.market}
              modelLine={rail.model}
              home={game.home}
              away={game.away}
              keyNumbers={rail.keyNumbers}
              format={rail.format}
              describe={rail.describe}
              compact
            />
          </div>
        )}

        <div className="perf" />

        <div className="row spread-between gap-3" style={{ flexWrap: 'wrap' }}>
          <p className="dim grow" style={{ fontSize: 11, margin: 0, minWidth: 240 }}>
            {isLean && <span>{reason}. Shown as the model's read on the game, not as a bet. </span>}
            {tier.suspicious && (
              <span className="neg">
                An edge this large is far more likely to be a modelling error than
                free money — most often the projected total is off. Capped at 1u and
                worth checking before it is worth betting.{' '}
              </span>
            )}
            {kellyGap > 1.4 && `Kelly would size this at ${fmtMoney(kellyStake)} — larger than the flat ${tier.units}u. Flat staking is the safer default when the model's probabilities are themselves uncertain. `}
            {kellyGap > 0 && kellyGap < 0.7 && `Kelly would size this smaller, at ${fmtMoney(kellyStake)}. `}
            {alternate && alternate.ev > 0 && (
              <>Also live on this game: {alternate.label} at {(alternate.ev * 100).toFixed(1)}% EV, left off to keep one view per game.</>
            )}
          </p>
          <div className="row gap-2">
            <a className="btn ghost" href={href(`game/${game.id}`)}>Game</a>
            {!isLean && (
              <button
                className="btn"
                onClick={() =>
                  dispatch({
                    type: 'addLeg',
                    leg: { ...toSlipLeg(best), stake: Math.max(1, Math.round(stake)) }
                  })
                }
              >
                Add
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

/** "A", "A and B", "A, B and C" — Intl handles the awkward cases. */
const listFmt = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' })
const listOf = (items) => listFmt.format(items)

function Metric({ label, value, tone, dim }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 2 }}>{label}</div>
      <div
        className={`mono ${tone || ''}`}
        style={{ fontSize: 'var(--t-base)', color: dim ? 'var(--muted)' : undefined }}
      >
        {value}
      </div>
    </div>
  )
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
