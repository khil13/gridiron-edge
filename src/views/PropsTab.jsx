import { useState, useMemo } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Badge, Empty } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { fetchGameRosters } from '../data/providers/playerData.js'
import { fetchGameProps, PROPS_CREDIT_COST } from '../data/providers/oddsApiProvider.js'
import {
  expectedTouchdowns, expectedScorers, projectAnytimeTouchdowns, normaliseField,
  projectPassingTouchdowns, devigField
} from '../lib/props.js'
import { impliedProb, expectedValue, kelly } from '../lib/odds.js'
import { fmtOdds, fmtPct, fmtMoney, fmtSigned } from '../lib/format.js'

/**
 * Touchdown props.
 *
 * Loaded on demand rather than with the page. Props markets cost about ten
 * API credits each per game, so quietly fetching them for a whole slate
 * would spend most of a free month's quota on games nobody opened.
 *
 * These are also the markets where the model is least trustworthy and the
 * books hold the most, so the caveats are shown alongside the numbers rather
 * than in a footnote.
 */
export default function PropsTab({ game, data }) {
  const { settings, oddsKey } = useStore()
  const [state, setState] = useState({ status: 'idle' })

  const proj = game.projection

  const load = async () => {
    setState({ status: 'loading' })
    try {
      const [rosters, props] = await Promise.all([
        fetchGameRosters(game),
        oddsKey ? fetchGameProps({ apiKey: oddsKey, game }) : Promise.resolve(null)
      ])
      setState({ status: 'ready', rosters, props })
    } catch (err) {
      setState({ status: 'error', error: err.message })
    }
  }

  const analysis = useMemo(() => {
    if (state.status !== 'ready' || !proj) return null
    return analyse({ game, proj, settings, rosters: state.rosters, props: state.props })
  }, [state, game, proj, settings])

  if (!proj) {
    return <Empty title="No projection">This game has teams the rating file does not cover.</Empty>
  }

  if (state.status === 'idle') {
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Loaded only when you ask</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Touchdown props</h2>
          </div>
        </div>
        <div style={{ padding: 'var(--s4)' }}>
          <p className="dim" style={{ fontSize: 13, marginTop: 0, maxWidth: '75ch' }}>
            Anytime scorers and quarterback passing touchdowns, priced against the model.
            {oddsKey
              ? ` Fetching costs about ${PROPS_CREDIT_COST} API credits for this game, which is why it is not loaded automatically.`
              : ' No odds key is connected, so this will show the model\u2019s own numbers with nothing to compare them against.'}
          </p>
          <button className="btn primary" onClick={load}>
            Load props for this game
          </button>
        </div>
      </section>
    )
  }

  if (state.status === 'loading') {
    return <Empty title="Loading">Pulling rosters and prices.</Empty>
  }

  if (state.status === 'error') {
    return (
      <Empty title="Could not load props">
        {state.error} Nothing else on this page is affected.
      </Empty>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      <Caveats analysis={analysis} game={game} rosters={state.rosters} />
      <Anytime analysis={analysis} game={game} />
      <Passing analysis={analysis} game={game} />
    </div>
  )
}

/* ---------- the maths, in one place ---------- */

function analyse({ game, proj, settings, rosters, props }) {
  const teamCtx = {
    [game.home]: { expectedTds: expectedTouchdowns(proj.homeTeamTotal), teamTds: null, games: 0 },
    [game.away]: { expectedTds: expectedTouchdowns(proj.awayTeamTotal), teamTds: null, games: 0 }
  }

  // Model side: every rostered scorer, normalised so each team's projected
  // scorers add up to the touchdowns the game model expects.
  const projected = normaliseField(
    projectAnytimeTouchdowns(
      rosters.players.map((p) => ({ ...p, tds: p.tds ?? 0 })),
      teamCtx
    ),
    teamCtx
  )
  const byName = new Map(projected.map((p) => [normName(p.name), p]))

  // Market side: best price per player, then devig the whole posted field
  // per team rather than treating each price as a fair two-way market.
  const bestByPlayer = new Map()
  for (const o of props?.anytime ?? []) {
    const key = normName(o.player)
    const current = bestByPlayer.get(key)
    if (!current || o.price > current.price) bestByPlayer.set(key, o)
  }

  const entries = [...bestByPlayer.entries()]
    .map(([key, o]) => {
      const model = byName.get(key)
      return model
        ? { key, ...o, team: model.team, model, impliedProb: impliedProb(o.price) }
        : null
    })
    .filter(Boolean)

  const dv = entries.length ? devigField(entries, teamCtx) : null

  const anytime = entries.map((e, i) => {
    const teamDevig = dv?.teams?.[e.team]
    const devigged = !!teamDevig?.complete

    // If the posted field for this team could not be devigged, the raw price
    // still carries the book's entire margin. Reporting an EV against it
    // would show a large edge on nearly every player that is nothing but the
    // vig, so no EV is claimed — the row is shown, flagged, without one.
    const fair = devigged ? dv.fair[i] : null
    const ev = devigged ? expectedValue(e.model.prob, e.price) : null

    return {
      ...e,
      fair,
      ev,
      devigged,
      edge: devigged ? e.model.prob - fair : null,
      stake: devigged
        ? kelly(e.model.prob, e.price, 0, settings.kellyFraction) * settings.bankroll
        : 0
    }
  }).sort((a, b) => (b.ev ?? -Infinity) - (a.ev ?? -Infinity))

  // Players the model rates but no book priced, and vice versa.
  const unpriced = projected.filter((p) => !bestByPlayer.has(normName(p.name)))

  // Quarterback passing touchdowns.
  const passing = []
  for (const side of ['home', 'away']) {
    const team = side === 'home' ? game.home : game.away
    const points = side === 'home' ? proj.homeTeamTotal : proj.awayTeamTotal
    const model = projectPassingTouchdowns(points)
    const offers = (props?.passing ?? []).filter((o) => {
      const p = byName.get(normName(o.player))
      return p && p.team === team
    })
    for (const o of offers) {
      const outcome = o.side === 'over' ? model.over(o.line) : model.under(o.line)
      const twoWay = (props.passing || []).filter(
        (x) => normName(x.player) === normName(o.player) && x.line === o.line && x.book === o.book
      )
      const fair = fairTwoWay(twoWay, o.side, outcome)
      passing.push({
        ...o, team, lambda: model.lambda,
        modelProb: outcome.win, push: outcome.push, fair,
        ev: expectedValue(outcome.win, o.price, outcome.push),
        stake: kelly(outcome.win, o.price, outcome.push, settings.kellyFraction) * settings.bankroll
      })
    }
    if (!offers.length) {
      passing.push({ team, lambda: model.lambda, modelOnly: true, model })
    }
  }

  return {
    anytime,
    unpriced: unpriced.slice(0, 8),
    passing: passing.sort((a, b) => (b.ev ?? -1) - (a.ev ?? -1)),
    devig: dv,
    teamCtx,
    hasPrices: entries.length > 0,
    hasTouchdownData: rosters.hasTouchdownData
  }
}

/** Two-way devig for a QB line when both sides are posted. */
function fairTwoWay(offers, side, outcome) {
  const over = offers.find((o) => o.side === 'over')
  const under = offers.find((o) => o.side === 'under')
  if (!over || !under) return null
  const a = impliedProb(over.price)
  const b = impliedProb(under.price)
  const total = a + b
  if (total <= 0) return null
  return side === 'over' ? a / total : b / total
}

const normName = (n) =>
  String(n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

/* ---------- UI ---------- */

function Caveats({ analysis, game, rosters }) {
  const injured = rosters.players.filter((p) => p.injury && !/active/i.test(p.injury))
  return (
    <section className="panel" style={{ borderColor: 'rgba(242,193,78,0.35)' }}>
      <div className="panel-head">
        <Badge tone="chalk">Read this first</Badge>
        <span className="eyebrow">Why these are the hardest markets</span>
      </div>
      <div style={{ padding: 'var(--s4)' }}>
        <ul className="dim" style={{ fontSize: 12, margin: 0, paddingLeft: '1.1rem', lineHeight: 1.7, maxWidth: '78ch' }}>
          <li>
            <strong style={{ color: 'var(--bone-dim)' }}>Nobody knows who is playing.</strong>{' '}
            Inactives post ninety minutes before kickoff. A player who is scratched will still
            show a large edge here, and it is not one.
            {injured.length > 0 && ` ${injured.length} player${injured.length === 1 ? ' is' : 's are'} currently carrying an injury designation.`}
          </li>
          <li>
            <strong style={{ color: 'var(--bone-dim)' }}>The hold is enormous.</strong>{' '}
            {analysis.devig?.teams
              ? Object.entries(analysis.devig.teams)
                  .filter(([, t]) => t.hold != null)
                  .map(([team, t]) => `${team} ${(t.hold * 100).toFixed(0)}%`)
                  .join(', ') || 'Not measurable on this field.'
              : 'Not measurable without prices.'}{' '}
            A spread carries about 4.5%. That difference has to be overcome before any edge is real.
          </li>
          <li>
            <strong style={{ color: 'var(--bone-dim)' }}>
              {analysis.hasTouchdownData ? 'Touchdowns are rare.' : 'No touchdown data.'}
            </strong>{' '}
            {analysis.hasTouchdownData
              ? 'A player with two scores in four games does not have a 50% share, so observed rates are pulled hard toward a positional average until the sample earns its weight.'
              : 'The feed returned no per-player touchdown counts, so every share here is a positional average rather than anything specific to these players. Treat the numbers as a sketch.'}
          </li>
        </ul>
      </div>
    </section>
  )
}

function Anytime({ analysis, game }) {
  const { anytime, unpriced } = analysis

  if (!analysis.hasPrices) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: 'var(--t-base)' }}>Anytime touchdown</h2>
          <Badge tone="quiet">Model only</Badge>
        </div>
        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr><th>Player</th><th>Team</th><th>Share</th><th>Model</th></tr>
            </thead>
            <tbody>
              {unpriced.map((p) => (
                <tr key={p.id}>
                  <td>{p.name} <span className="dim">{p.role}</span></td>
                  <td data-label="Team"><TeamMark abbr={p.team} size={16} /></td>
                  <td className="num" data-label="Share">{fmtPct(p.share, 0)}</td>
                  <td className="num" data-label="Model">{fmtPct(p.prob, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4)', margin: 0 }}>
          No prices to compare against — connect an odds key in Model lab.
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: 'var(--t-base)' }}>Anytime touchdown</h2>
        <span className="eyebrow">Best price · devigged across the field</span>
      </div>
      <div className="tbl-scroll">
        <table className="tbl responsive">
          <thead>
            <tr>
              <th>Player</th><th>Price</th><th>Book</th>
              <th>Model</th><th>Fair</th><th>EV</th><th>Stake</th>
            </tr>
          </thead>
          <tbody>
            {anytime.map((p) => (
              <tr key={p.key}>
                <td>
                  <span className="row gap-2">
                    <TeamMark abbr={p.team} size={16} />
                    <span className="team-name">{p.player}</span>
                    <span className="dim">{p.model.role}</span>
                    {p.model.injury && !/active/i.test(p.model.injury) && (
                      <Badge tone="live">{p.model.injury}</Badge>
                    )}
                  </span>
                </td>
                <td className="num market" data-label="Price">{fmtOdds(p.price)}</td>
                <td className="dim" data-label="Book">{p.book}</td>
                <td className="num" data-label="Model">{fmtPct(p.model.prob, 1)}</td>
                <td className="num dim" data-label="Fair">{fmtPct(p.fair, 1)}</td>
                <td
                  className={`num ${p.ev == null ? 'dim' : p.ev > 0 ? 'pos' : 'neg'}`}
                  data-label="EV"
                >
                  {p.ev == null ? 'n/a' : `${p.ev > 0 ? '+' : ''}${(p.ev * 100).toFixed(1)}%`}
                </td>
                <td className="num dim" data-label="Stake">
                  {p.ev != null && p.ev > 0 ? fmtMoney(p.stake) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.entries(analysis.devig?.teams ?? {}).some(([, t]) => !t.complete) && (
        <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4)', margin: 0 }}>
          {Object.entries(analysis.devig.teams)
            .filter(([, t]) => !t.complete)
            .map(([team, t]) => `${team} listed only ${t.players} players`)
            .join('; ')}
          . That is fewer than the market really offers, so the margin cannot be removed from
          those prices and no EV is claimed for them. An edge computed against a price that
          still contains the vig is not an edge.
        </p>
      )}
    </section>
  )
}

function Passing({ analysis, game }) {
  const rows = analysis.passing.filter((p) => !p.modelOnly)
  const modelOnly = analysis.passing.filter((p) => p.modelOnly)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 style={{ fontSize: 'var(--t-base)' }}>Quarterback passing touchdowns</h2>
        <span className="eyebrow">Poisson on the projected team total</span>
      </div>

      {rows.length > 0 ? (
        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Play</th><th>Price</th><th>Book</th>
                <th>Model</th><th>Fair</th><th>EV</th><th>Stake</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={`${p.player}-${p.side}-${p.line}-${i}`}>
                  <td>
                    <span className="row gap-2">
                      <TeamMark abbr={p.team} size={16} />
                      <span className="team-name">{p.player}</span>
                      <span>{p.side === 'over' ? 'o' : 'u'}{p.line}</span>
                    </span>
                  </td>
                  <td className="num market" data-label="Price">{fmtOdds(p.price)}</td>
                  <td className="dim" data-label="Book">{p.book}</td>
                  <td className="num" data-label="Model">{fmtPct(p.modelProb, 1)}</td>
                  <td className="num dim" data-label="Fair">
                    {p.fair != null ? fmtPct(p.fair, 1) : '—'}
                  </td>
                  <td className={`num ${p.ev > 0 ? 'pos' : 'neg'}`} data-label="EV">
                    {p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}%
                  </td>
                  <td className="num dim" data-label="Stake">
                    {p.ev > 0 ? fmtMoney(p.stake) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 'var(--s4)' }}>
          <p className="dim" style={{ fontSize: 12, margin: 0 }}>
            No passing touchdown prices returned for this game.
          </p>
        </div>
      )}

      <div style={{ padding: 'var(--s4)', borderTop: '1px solid var(--line)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>Model expectation</div>
        {analysis.passing.map((p) => (
          <div className="row spread-between" key={p.team + p.lambda} style={{ padding: '3px 0' }}>
            <span className="row gap-2">
              <TeamMark abbr={p.team} size={16} />
              <span className="dim">{p.team} passing touchdowns</span>
            </span>
            <span className="mono">{p.lambda?.toFixed(2)}</span>
          </div>
        ))}
        <p className="dim" style={{ fontSize: 11, marginBottom: 0, marginTop: 'var(--s3)' }}>
          Taken from the projected team total, split to the passing share, and treated as
          Poisson. It assumes the starter takes nearly all of them — a quarterback pulled
          early, or a game that turns into a run script, is exactly what this cannot see.
        </p>
      </div>
    </section>
  )
}
