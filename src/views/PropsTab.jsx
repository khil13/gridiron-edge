import { useState, useMemo } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Badge, Empty, Segmented } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { fetchGameRosters } from '../data/providers/playerData.js'
import { fetchGameProps, PROPS_CREDIT_COST } from '../data/providers/oddsApiProvider.js'
import {
  expectedTouchdowns, expectedScorers, projectAnytimeTouchdowns, normaliseField,
  projectPassingTouchdowns, devigField, projectVolume, availableMarkets,
  projectFirstQuarter, VOLUME_MARKETS
} from '../lib/props.js'
import { impliedProb, expectedValue, kelly, validPrice, PRICE_MAX } from '../lib/odds.js'
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
  const { settings, oddsKey, manualPrices, dispatch } = useStore()
  const [state, setState] = useState({ status: 'idle' })
  const entered = manualPrices[game.id] || {}

  const proj = game.projection

  const load = async () => {
    setState({ status: 'loading' })
    try {
      // Rosters need no key and should basically always work; the Odds API
      // call needs one and is the thing most likely to fail (an exhausted
      // free-tier quota is the documented common case). Fetching them
      // independently means a dead odds key degrades to the model's own
      // numbers with manual pricing rather than taking the whole tab down —
      // which is the point of that fallback existing at all.
      const rosters = await fetchGameRosters(game)
      let props = null
      let propsError = null
      if (oddsKey) {
        try {
          props = await fetchGameProps({ apiKey: oddsKey, game })
        } catch (err) {
          propsError = err.message
        }
      }
      setState({ status: 'ready', rosters, props, propsError })
    } catch (err) {
      setState({ status: 'error', error: err.message })
    }
  }

  const onPrice = (key, price) =>
    dispatch({ type: 'setManualPrice', gameId: game.id, key, price })

  const analysis = useMemo(() => {
    if (state.status !== 'ready' || !proj) return null
    return analyse({
      game, proj, settings, ratings: data.ratings,
      rosters: state.rosters, props: state.props, entered
    })
  }, [state, game, proj, settings, data.ratings, entered])

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
      {state.propsError && (
        <p className="dim" style={{ fontSize: 12, margin: 0 }}>
          Live prices unavailable ({state.propsError}). Showing the model&apos;s own numbers —
          type in your book&apos;s price below to get EV against it.
        </p>
      )}
      <Caveats analysis={analysis} game={game} rosters={state.rosters} />
      <Volume analysis={analysis} entered={entered} onPrice={onPrice} />
      <FirstQuarter analysis={analysis} game={game} entered={entered} onPrice={onPrice} />
      <Anytime
        analysis={analysis}
        game={game}
        entered={entered}
        onPrice={(key, price) => dispatch({ type: 'setManualPrice', gameId: game.id, key, price })}
        onClear={() => dispatch({ type: 'clearManualPrices', gameId: game.id })}
      />
      <Passing analysis={analysis} game={game} />
    </div>
  )
}

/* ---------- the maths, in one place ---------- */

function analyse({ game, proj, settings, ratings, rosters, props, entered = {} }) {
  // touchdownShare() blends a player's observed share of his team's
  // touchdowns against the positional prior — but only once it actually
  // has a team's real touchdown count and games played. Those were never
  // wired up here, so every player fell back to the prior alone, no matter
  // how much real season data existed for them.
  const homeGames = teamGameData(rosters.players, game.home)
  const awayGames = teamGameData(rosters.players, game.away)
  const teamCtx = {
    [game.home]: { expectedTds: expectedTouchdowns(proj.homeTeamTotal), ...homeGames },
    [game.away]: { expectedTds: expectedTouchdowns(proj.awayTeamTotal), ...awayGames }
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

  // Players the model rates but no feed priced. These are the rows you type
  // a sportsbook's number into: the EV is then computed against the price
  // you would actually be taking, which is the number that decides the bet.
  const unpriced = projected
    .filter((p) => !bestByPlayer.has(normName(p.name)))
    .map((p) => {
      const price = entered[normName(p.name)]
      const numeric = Number(price)
      const typed = price != null && price !== ''
      const valid = typed && validPrice(numeric)
      if (!valid) return { ...p, manualPrice: null, badPrice: typed }

      const ev = expectedValue(p.prob, numeric)
      // A twenty-five percent edge on a touchdown prop is not an edge, it is
      // the model being wrong about a player — usually a backup handed too
      // much of the team's scoring. Flagged rather than celebrated.
      const implausible = ev > 0.25

      return {
        ...p,
        manualPrice: numeric,
        ev,
        implausible,
        impliedProb: impliedProb(numeric),
        stake: implausible
          ? 0
          : kelly(p.prob, numeric, 0, settings.kellyFraction) * settings.bankroll
      }
    })
    .sort((a, b) => {
      // Anything priced floats to the top, best edge first.
      if (a.ev != null && b.ev != null) return b.ev - a.ev
      if (a.ev != null) return -1
      if (b.ev != null) return 1
      return b.prob - a.prob
    })

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

  // Volume markets, per player, only where a real season rate exists.
  const teamAverages = {
    [game.home]: ratingFor(game.home),
    [game.away]: ratingFor(game.away)
  }
  function ratingFor(team) {
    // The team's own scoring rate is the baseline this game is compared to.
    return teamStatsFor(team) ?? 22
  }
  function teamStatsFor(team) {
    const r = ratings?.[team]
    return r?.ppg ?? null
  }

  const volume = []
  for (const p of rosters.players) {
    const teamPoints = p.team === game.home ? proj.homeTeamTotal : proj.awayTeamTotal
    const teamAverage = teamAverages[p.team] ?? 22
    for (const market of availableMarkets(p)) {
      const v = projectVolume(p, market, { teamPoints, teamAverage })
      if (!v) continue
      volume.push({ player: p, ...v, team: p.team, role: p.role, injury: p.injury })
    }
  }

  const firstQuarter = projectFirstQuarter(proj.homeTeamTotal, proj.awayTeamTotal)

  return {
    anytime,
    volume,
    firstQuarter,
    unpriced: unpriced.slice(0, 8),
    passing: passing.sort((a, b) => (b.ev ?? -1) - (a.ev ?? -1)),
    devig: dv,
    teamCtx,
    hasPrices: entries.length > 0,
    hasTouchdownData: rosters.hasTouchdownData,
    depthKnown: rosters.depthKnown,
    statsSeason: rosters.statsSeason,
    usedPriorSeason: rosters.usedPriorSeason,
    statsNote: rosters.statsNote
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

/** A team's total tracked touchdowns and games played, from its own roster. */
function teamGameData(players, team) {
  const teamPlayers = players.filter((p) => p.team === team)
  const teamTds = teamPlayers.reduce((s, p) => s + (p.tds ?? 0), 0)
  const games = teamPlayers.reduce((m, p) => Math.max(m, p.stats?.games ?? 0), 0)
  return { teamTds, games }
}

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
              {analysis.depthKnown ? 'Touchdowns are rare.' : 'The depth chart is unknown.'}
            </strong>{' '}
            {analysis.depthKnown
              ? 'A player with two scores in four games does not have a 50% share, so observed rates are pulled hard toward a positional average until the sample earns its weight.'
              : 'Nobody has scored yet this season, so there is nothing to rank a depth chart on. Every player at a position is therefore given the same share — the starter and the fourth-stringer alike. That is not a claim that they are equally likely, it is an admission that this cannot yet tell them apart. These numbers become meaningful once a few weeks have been played.'}
          </li>
        </ul>
      </div>
    </section>
  )
}

function Anytime({ analysis, game, entered, onPrice, onClear }) {
  const { anytime, unpriced } = analysis

  if (!analysis.hasPrices) {
    const priced = unpriced.filter((p) => p.manualPrice != null)
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Type in the price your book is showing</div>
            <h2 style={{ fontSize: 'var(--t-base)', marginTop: 4 }}>Anytime touchdown</h2>
          </div>
          {priced.length > 0 && (
            <button className="btn ghost" onClick={onClear}>Clear prices</button>
          )}
        </div>

        <div style={{ padding: 'var(--s3) var(--s4) 0' }}>
          <p className="dim" style={{ fontSize: 12, marginTop: 0, maxWidth: '75ch' }}>
            A probability on its own decides nothing. Enter what FanDuel is offering and the
            EV below is computed against the price you would actually take — vig included,
            because the vig is already in the number you are being offered.
          </p>
        </div>

        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Player</th><th>Model</th><th>Your price</th>
                <th>Implied</th><th>Edge</th><th>EV</th><th>Stake</th>
              </tr>
            </thead>
            <tbody>
              {unpriced.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="row gap-2">
                      <TeamMark abbr={p.team} size={16} />
                      <span className="team-name">{p.name}</span>
                      <span className="dim">{p.role}</span>
                      {p.injury && !/active/i.test(p.injury) && (
                        <Badge tone="live">{p.injury}</Badge>
                      )}
                    </span>
                  </td>
                  <td className="num" data-label="Model">{fmtPct(p.prob, 1)}</td>
                  <td data-label="Your price">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="+450"
                      value={entered[normName(p.name)] ?? ''}
                      onChange={(e) => onPrice(normName(p.name), e.target.value.trim())}
                      style={{ width: 84, textAlign: 'right' }}
                      aria-label={`Price for ${p.name}`}
                    />
                  </td>
                  <td className="num dim" data-label="Implied">
                    {p.badPrice
                      ? <span className="neg">not a price</span>
                      : p.impliedProb != null ? fmtPct(p.impliedProb, 1) : '—'}
                  </td>
                  <td
                    className={`num ${p.impliedProb == null ? 'dim' : p.prob > p.impliedProb ? 'pos' : 'neg'}`}
                    data-label="Edge"
                  >
                    {p.impliedProb != null
                      ? `${p.prob > p.impliedProb ? '+' : ''}${((p.prob - p.impliedProb) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td
                    className={`num ${p.ev == null ? 'dim' : p.implausible ? 'neg' : p.ev > 0 ? 'pos' : 'neg'}`}
                    data-label="EV"
                  >
                    {p.ev == null
                      ? '—'
                      : `${p.ev > 0 ? '+' : ''}${(p.ev * 100).toFixed(1)}%`}
                  </td>
                  <td className="num dim" data-label="Stake">
                    {p.implausible
                      ? <span className="neg" title="Check the model, not the price">check</span>
                      : p.ev != null && p.ev > 0 ? fmtMoney(p.stake) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4)', margin: 0, maxWidth: '80ch' }}>
          {analysis.depthKnown
            ? 'A positive EV here is only as good as the model behind it, and touchdown props are the weakest thing it does. Anytime markets hold 15-25%, so a genuine edge has to be large to survive.'
            : 'Every player at a position shows the same number because no games have been played, so there is no basis for a depth chart yet. Do not bet these — they are a demonstration of the method, not a read on these players.'}
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

/* ---------- Volume markets ---------- */

/**
 * Yardage, receptions and carries.
 *
 * Every row here is backed by an actual season rate. A player with no
 * receptions this year gets no receiving line, because a positional average
 * is fine for a touchdown share — a proportion — and useless for a yardage
 * number, where being twenty yards wrong is the whole bet.
 */
function Volume({ analysis, entered, onPrice }) {
  const [market, setMarket] = useState('receivingYards')
  const rows = (analysis.volume ?? []).filter((v) => v.market === market)

  if (!analysis.volume?.length) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 style={{ fontSize: 'var(--t-base)' }}>Yardage and volume</h2>
          <Badge tone="quiet">No season rates yet</Badge>
        </div>
        <p className="dim" style={{ fontSize: 12, padding: 'var(--s4)', margin: 0, maxWidth: '75ch' }}>
          These markets need a real per-game rate — yards, catches or carries actually recorded.
          {analysis.statsNote ? ` ${analysis.statsNote}` : ' Neither this season nor last returned any for these rosters.'}
          {' '}A positional average is not a substitute: it is adequate for a touchdown share,
          which is a proportion, and worthless for a yardage line where being twenty yards out
          is the whole bet.
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">
            {analysis.usedPriorSeason
              ? `${analysis.statsSeason} rates, scaled to this game`
              : 'This season\u2019s rate, scaled to this game'}
          </div>
          <h2 style={{ fontSize: 'var(--t-base)', marginTop: 4 }}>Yardage and volume</h2>
        </div>
        {analysis.usedPriorSeason && <Badge tone="chalk">Last season</Badge>}
      </div>

      <div style={{ padding: 'var(--s3) var(--s4) 0' }}>
        <Segmented
          label="Market"
          value={market}
          onChange={setMarket}
          options={VOLUME_MARKETS
            .filter((m) => analysis.volume.some((v) => v.market === m.key))
            .map((m) => ({ value: m.key, label: m.label.replace(' yards', '').replace('Rush attempts', 'Carries') }))}
        />
      </div>

      <div className="tbl-scroll">
        <table className="tbl responsive">
          <thead>
            <tr>
              <th>Player</th><th>Rate</th><th>Projection</th>
              <th>Line</th><th>Your price</th><th>Over</th><th>EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.sort((a, b) => b.mean - a.mean).map((v) => {
              const lineKey = `${v.market}:${normName(v.player.name)}:line`
              const priceKey = `${v.market}:${normName(v.player.name)}:price`
              const line = Number(entered[lineKey])
              const price = Number(entered[priceKey])
              const hasLine = Number.isFinite(line) && line > 0
              const hasPrice = validPrice(price)
              const outcome = hasLine ? v.over(line) : null
              const ev = outcome && hasPrice ? expectedValue(outcome.win, price, outcome.push) : null

              return (
                <tr key={`${v.market}-${v.player.id}`}>
                  <td>
                    <span className="row gap-2">
                      <TeamMark abbr={v.team} size={16} />
                      <span className="team-name">{v.player.name}</span>
                      <span className="dim">{v.role}</span>
                      {v.injury && !/active/i.test(v.injury) && <Badge tone="live">{v.injury}</Badge>}
                    </span>
                  </td>
                  <td className="num dim" data-label="Rate">
                    <span>{v.perGame}/g over {v.games}</span>
                  </td>
                  <td className="num" data-label="Projection">
                    <span>{v.mean} {v.environment !== 1 && <span className="dim">×{v.environment}</span>}</span>
                  </td>
                  <td data-label="Line">
                    <input
                      type="text" inputMode="decimal" placeholder="54.5"
                      value={entered[lineKey] ?? ''}
                      onChange={(e) => onPrice(lineKey, e.target.value.trim())}
                      style={{ width: 70, textAlign: 'right' }}
                      aria-label={`Line for ${v.player.name}`}
                    />
                  </td>
                  <td data-label="Your price">
                    <input
                      type="text" inputMode="numeric" placeholder="-110"
                      value={entered[priceKey] ?? ''}
                      onChange={(e) => onPrice(priceKey, e.target.value.trim())}
                      style={{ width: 76, textAlign: 'right' }}
                      aria-label={`Price for ${v.player.name}`}
                    />
                  </td>
                  <td className="num" data-label="Over">
                    {outcome ? fmtPct(outcome.win, 1) : '—'}
                  </td>
                  <td
                    className={`num ${ev == null ? 'dim' : ev > 0 ? 'pos' : 'neg'}`}
                    data-label="EV"
                  >
                    {ev == null ? '—' : `${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {analysis.usedPriorSeason && (
        <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4) 0', margin: 0, maxWidth: '80ch' }}>
          <span className="market">No games have been played this season, so these rates are
          from {analysis.statsSeason}.</span> That is real data rather than a guess, but an
          offseason sits between: players changed teams, roles moved, and a rookie has no line
          here at all because he has no history to project from. Treat them as a starting point
          that gets replaced as this season is played.
        </p>
      )}

      <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4)', margin: 0, maxWidth: '80ch' }}>
        Yardage is modelled with a right-skewed distribution rather than a bell curve, because
        that is how it behaves: a floor at zero and a long tail. A symmetric curve would put
        real probability below zero yards and misprice both sides. The multiplier shown next to
        a projection is how far this game&apos;s expected scoring sits from the team&apos;s
        season average, damped — a shootout lifts everyone, but not proportionally.
      </p>
    </section>
  )
}

/* ---------- First quarter ---------- */

function FirstQuarter({ analysis, game, entered, onPrice }) {
  const q = analysis.firstQuarter
  if (!q) return null

  const lineKey = 'q1:total:line'
  const priceKey = 'q1:total:price'
  const line = Number(entered[lineKey])
  const price = Number(entered[priceKey])
  const hasLine = Number.isFinite(line) && line > 0
  const over = hasLine ? q.overTotal(line) : null
  const push = hasLine ? q.pushTotal(line) : 0
  const ev = over != null && validPrice(price) ? expectedValue(over, price, push) : null

  const shutout = (q.totalDist[0] ?? 0)

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Team level only</div>
          <h2 style={{ fontSize: 'var(--t-base)', marginTop: 4 }}>First quarter</h2>
        </div>
        <span className="eyebrow">{q.totalMean} projected</span>
      </div>

      <div style={{ padding: 'var(--s4)' }}>
        <div className="row spread-between" style={{ padding: '3px 0' }}>
          <span className="row gap-2"><TeamMark abbr={game.away} size={16} /><span className="dim">{game.away}</span></span>
          <span className="mono">{q.awayMean}</span>
        </div>
        <div className="row spread-between" style={{ padding: '3px 0' }}>
          <span className="row gap-2"><TeamMark abbr={game.home} size={16} /><span className="dim">{game.home}</span></span>
          <span className="mono">{q.homeMean}</span>
        </div>
        <div className="row spread-between" style={{ padding: '3px 0' }}>
          <span className="dim">Scoreless first quarter</span>
          <span className="mono">{fmtPct(shutout, 1)}</span>
        </div>

        <div className="perf" />

        <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field">
            <label><span>1Q total line</span></label>
            <input
              type="text" inputMode="decimal" placeholder="9.5"
              value={entered[lineKey] ?? ''}
              onChange={(e) => onPrice(lineKey, e.target.value.trim())}
              style={{ width: 80, textAlign: 'right' }}
            />
          </div>
          <div className="field">
            <label><span>Price</span></label>
            <input
              type="text" inputMode="numeric" placeholder="-115"
              value={entered[priceKey] ?? ''}
              onChange={(e) => onPrice(priceKey, e.target.value.trim())}
              style={{ width: 88, textAlign: 'right' }}
            />
          </div>
          <div>
            <div className="eyebrow">Over</div>
            <div className="mono" style={{ fontSize: 'var(--t-lg)' }}>
              {over != null ? fmtPct(over, 1) : '—'}
            </div>
          </div>
          <div>
            <div className="eyebrow">EV</div>
            <div className={`mono ${ev == null ? 'dim' : ev > 0 ? 'pos' : 'neg'}`} style={{ fontSize: 'var(--t-lg)' }}>
              {ev == null ? '—' : `${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>

        <p className="dim" style={{ fontSize: 11, marginBottom: 0, marginTop: 'var(--s3)', maxWidth: '80ch' }}>
          A quarter&apos;s points land on 0, 3, 7, 10 — never 1, 2, 4 or 5 — so this is built
          from scoring events rather than a smooth curve. First-quarter PLAYER props are not
          offered: they need drive and snap data this app does not have, and deriving them from
          a full-game rate would assume usage is spread evenly through a game, which it is not.
        </p>
      </div>
    </section>
  )
}
