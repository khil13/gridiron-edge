import { useEffect, useMemo, useRef, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import EdgeRail from '../components/EdgeRail.jsx'
import { Badge, Empty, Tabs } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { toSlipLeg } from '../lib/edges.js'
import { buildCard, daysFrom, confidenceOf, lockCard, tierForProp, tierForVolume, pickPropsForGame, sortPropPicks, isMainPlayer, bestPropLean, leanReasonForProp, gameProjectionRows } from '../lib/card.js'
import { runBacktest } from '../lib/backtest.js'
import ratingsFile from '../data/generated/ratings.json'
import propAccuracy from '../data/generated/prop-accuracy.json'
import { analyseAnytimeTouchdowns, volumePlaysForGame } from '../lib/props.js'
import { reasonsForPick } from '../lib/reasons.js'
import { fetchGameRosters } from '../data/providers/playerData.js'
import { fetchGameProps, CARD_PROP_MARKETS, CARD_PROP_CREDIT_COST } from '../data/providers/oddsApiProvider.js'
import { mainPlayerBoard, lineOutlook } from '../lib/playerBoard.js'
import { load, save } from '../lib/storage.js'
import { normPropName } from '../lib/props.js'
import { getTeam } from '../data/teams.js'
import ResultsView from './ResultsView.jsx'
import {
  fmtOdds, fmtPct, fmtMoney, fmtSigned, fmtDay, fmtTime, relativeDay, fmtRecord, readable
} from '../lib/format.js'
import { href } from '../lib/router.js'

/** How many offers/candidates fall under each volume market key — rushingYards, receivingYards. */
const byMarket = (list) =>
  (list ?? []).reduce((acc, item) => {
    acc[item.market] = (acc[item.market] ?? 0) + 1
    return acc
  }, {})

/**
 * A game the odds feed hasn't posted anything for yet — neither anytime
 * touchdown nor any yardage market. That is the one case worth re-checking
 * automatically later: a real, priced offer that just didn't clear the bar
 * isn't going to change on its own, but a market that hasn't been posted at
 * all often shows up within the hour as kickoff for a later slate gets
 * closer. A game already final never needs re-checking regardless, and
 * with no odds key connected there is no feed to wait on at all — the
 * projections board doesn't change on a twenty-minute clock.
 *
 * `liveStatus` must come from the current slate, not from `g.game.status` —
 * that field is a snapshot frozen at whatever moment this game was last
 * fetched, and a game checked while it was still scheduled never updates its
 * own copy to 'final' on its own. Trusting the frozen copy would recheck an
 * already-finished game forever, spending API credits on nothing.
 */
const needsRecheck = (g, liveStatus) =>
  g.keyed && liveStatus !== 'final' && (g.anytimeOffers ?? 0) === 0 && (g.volumeOffers ?? 0) === 0

/** How often to look again for games that had nothing posted last time. */
const AUTO_RECHECK_MS = 20 * 60 * 1000

/** Sum a per-market breakdown (volumeOffersByMarket, volumeCandidatesByMarket) across every game. */
const sumByMarket = (perGame, key) =>
  perGame.reduce((acc, g) => {
    for (const [market, count] of Object.entries(g[key])) acc[market] = (acc[market] ?? 0) + count
    return acc
  }, {})

/** The aggregate diagnostic fields shown under the picks, rebuilt from whatever perGame currently holds. */
function summarizeProps(perGame) {
  return {
    perGame,
    volumeOffersSeen: perGame.reduce((s, g) => s + g.volumeOffers, 0),
    volumeCandidatesPriced: perGame.reduce((s, g) => s + g.volume.length, 0),
    volumeOffersByMarket: sumByMarket(perGame, 'volumeOffersByMarket'),
    volumeCandidatesByMarket: sumByMarket(perGame, 'volumeCandidatesByMarket'),
    anyRealStats: perGame.some((g) => g.hasSeasonStats),
    statsNote: perGame.find((g) => g.statsNote)?.statsNote ?? null,
    // Whether any game actually came back with real prices. With no key —
    // or a key whose fetch failed for every game — there are none, and the
    // panel shows the projections board alone rather than inventing a market.
    anyLiveProps: perGame.some((g) => g.live),
    liveErrorReason: perGame.find((g) => g.liveError)?.liveError ?? null
  }
}

/**
 * Card of the Day.
 *
 * One play per game at the best price, tiered by conviction, with every
 * skipped game listed and a reason attached. The passes are the point: a
 * card that plays everything is not selective, and selectivity is the only
 * thing separating this from a list of games.
 */
export default function CardView({ data }) {
  const { settings, lockedCards, oddsKey, dispatch } = useStore()
  const [tab, setTab] = useState('today')
  const [propState, setPropState] = useState({ status: 'idle', dayKey: null })
  // Lines the user typed in from their own sportsbook, per game/player/stat.
  // Kept across visits (the board itself has to be reloaded after leaving
  // the page, and retyping a slate of lines each time would be miserable),
  // and pruned to games still on the schedule so it cannot grow forever.
  const [boardLines, setBoardLines] = useState(() => load('boardLines', {}))
  const setBoardLine = (key, value) => {
    setBoardLines((prev) => {
      const gameIds = new Set(data.games.map((g) => g.id))
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => gameIds.has(k.split('|')[0])))
      if (value) next[key] = value
      else delete next[key]
      save('boardLines', next)
      return next
    })
  }
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

  // No real sportsbook prices connected: the game section shows the model's
  // own projections instead of plays priced against a simulated market.
  const projectionOnly = !!data.simulatedPrices
  const projectionRows = useMemo(() => gameProjectionRows(day?.games ?? []), [day])

  // How the game model has actually done on this season's finished games —
  // the same replay the Model tab shows, so the two can never disagree.
  const seasonRecord = useMemo(
    () => runBacktest(data.seasonResults ?? [], ratingsFile.ratings, settings).metrics,
    [data.seasonResults, settings]
  )
  const confidence = useMemo(
    () => confidenceOf(day?.games ?? [], settings),
    [day, settings]
  )

  // Touchdown props for the whole slate — opt-in, because checking every
  // game costs API credits the same way the Props tab's per-game fetch does.
  // Fetched fresh per day: yesterday's props on today's card would be a lie.
  const propsReady = propState.status === 'ready' && propState.dayKey === day?.key
  const propsLoading = propState.status === 'loading' && propState.dayKey === day?.key

  const propResult = useMemo(() => {
    if (!propsReady) return { picks: [], flaggedOnly: 0 }
    const unit = (settings.bankroll ?? 1000) * 0.01
    // propState.perGame's own `game` field is a snapshot frozen at fetch
    // time, so a game finished since it was checked still says otherwise
    // there — the current slate is the only place with the live status.
    const liveStatusById = new Map((day?.games ?? []).map((g) => [g.id, g.status]))
    const picks = []
    let flaggedOnly = 0
    for (const { game, anytime, volume, live } of propState.perGame) {
      if (!live) continue
      // A game that has since gone final has nothing left to bet — showing
      // a prop found while it was still being played would be a stale
      // pick on a game that's already over.
      if (liveStatusById.get(game.id) === 'final') continue
      // Every qualifying candidate for this game, touchdown and yardage
      // alike. Up to two legs per game — a touchdown lean on one player and
      // a yardage lean on a different one are separate real signals, not
      // the same opinion said twice, so there is no reason to compute a
      // genuine edge and then discard it just because another player on the
      // same field also cleared the bar. pickPropsForGame() still excludes
      // a flagged "Check model" candidate outright, at any rank.
      const candidates = []
      for (const e of anytime) {
        if (!e.devigged || e.ev == null) continue
        if (!isMainPlayer(e.model?.role)) continue
        candidates.push({ kind: 'td', entry: e, tier: tierForProp(e) })
      }
      for (const v of volume ?? []) {
        if (!isMainPlayer(v.role)) continue
        candidates.push({ kind: 'volume', entry: v, tier: tierForVolume(v) })
      }
      const legs = pickPropsForGame(candidates)
      if (!legs.length) {
        if (candidates.some((c) => c.tier.units > 0)) flaggedOnly++
        // Nothing qualified a real pick — show this game's closest
        // main-player read anyway, unstaked, the same way a game with no
        // spread/total edge still shows a zero-unit lean rather than
        // nothing at all.
        const lean = bestPropLean(candidates)
        if (lean) {
          picks.push({
            game, kind: lean.kind, entry: lean.entry, tier: lean.tier, stake: 0,
            reason: leanReasonForProp(lean.entry)
          })
        }
        continue
      }
      for (const leg of legs) {
        picks.push({ game, kind: leg.kind, entry: leg.entry, tier: leg.tier, stake: leg.tier.units * unit })
      }
    }
    return { picks: sortPropPicks(picks).slice(0, 12), flaggedOnly }
  }, [propsReady, propState, settings, day])
  const { picks: propPlays, flaggedOnly: flaggedOnlyGames } = propResult

  // The projections board: every checked game still to be played, in
  // kickoff order, that produced at least one main player.
  const boardGames = useMemo(() => {
    if (!propsReady) return []
    const liveStatusById = new Map((day?.games ?? []).map((g) => [g.id, g.status]))
    return propState.perGame
      .filter((g) => liveStatusById.get(g.game.id) !== 'final' && g.board?.length)
      .sort((a, b) => new Date(a.game.kickoff) - new Date(b.game.kickoff))
  }, [propsReady, propState, day])

  // Shared by the manual "Check this slate" button and the auto-recheck
  // effect below, so a game is only ever priced through this one path.
  const checkGames = async (games) => {
    const settled = await Promise.allSettled(
      games.map(async (g) => {
        const rosters = await fetchGameRosters(g)

        // Real prices only when a key is connected and the fetch works.
        // Without them nothing is priced at all: the Card used to fall back
        // to a simulated board (the model's own number, nudged by noise,
        // dressed up with book names), and an "edge" against that is not
        // information. What needs no price is the projection itself, so
        // every game always gets the main-player board below.
        let props = null
        let liveError = null
        if (oddsKey) {
          try {
            props = await fetchGameProps({ apiKey: oddsKey, game: g, markets: CARD_PROP_MARKETS })
          } catch (err) {
            liveError = err.message
          }
        }

        const { anytime } = analyseAnytimeTouchdowns({ game: g, proj: g.projection, rosters, props })
        const volume = volumePlaysForGame({ game: g, proj: g.projection, rosters, offers: props?.volume, ratings: data.ratings })
        const board = mainPlayerBoard({ game: g, proj: g.projection, rosters, ratings: data.ratings })
        return {
          game: g, anytime, volume, board, live: !!props, keyed: !!oddsKey, liveError,
          // Rushing and receiving are two different odds-feed markets that
          // books post independently of each other — a slate can have
          // plenty of one and none of the other. Counting them separately
          // is the only way to tell "the feed just isn't offering rushing
          // yet" apart from "rushing offers exist but lost to a better
          // pick on the same game," which look identical in a combined total.
          anytimeOffers: props?.anytime?.length ?? 0,
          volumeOffers: props?.volume?.length ?? 0,
          volumeOffersByMarket: byMarket(props?.volume),
          volumeCandidatesByMarket: byMarket(volume),
          // fetchGameRosters() already knows whether the bundled stats
          // snapshot (or the roster feed's own embedded stats) produced a
          // single real rate — reusing that beats re-deriving it, and
          // rosters.statsNote already explains why when it didn't.
          hasSeasonStats: rosters.hasSeasonStats,
          statsNote: rosters.statsNote
        }
      })
    )
    const perGame = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value)
    // A game can fail outright — a roster fetch that errors, most likely —
    // which is a completely different situation from "checked fine, the feed
    // just hasn't posted anything." A bad or quota-exhausted odds key does
    // not land here: it is caught per-game above and surfaced via
    // `liveError`, and the game still gets its projections board.
    const failures = settled.filter((r) => r.status === 'rejected').map((r) => r.reason?.message ?? String(r.reason))
    return { perGame, failures }
  }

  const loadProps = async () => {
    if (!day) return
    const targets = day.games.filter((g) => g.projection && g.status !== 'final')
    setPropState({ status: 'loading', dayKey: day.key })
    const { perGame, failures } = await checkGames(targets)
    setPropState({
      status: 'ready',
      dayKey: day.key,
      // Diagnostic breakdown, not shown unless nothing qualifies: how many
      // raw yardage offers the odds feed actually returned for this slate,
      // how many of those matched a real per-player rate at all (before any
      // EV/edge threshold), and whether any roster on the slate ended up
      // with real per-player stats in the first place. Tells apart "the
      // feed hasn't posted these lines yet," "the stats proxy isn't
      // actually delivering data despite being connected," and "something
      // in the name matching is broken" — without needing the network tab.
      ...summarizeProps(perGame),
      checked: targets.length,
      failed: targets.length - perGame.length,
      // One representative message, not all of them — every failure on a
      // slate is usually the same underlying cause (one bad key, one
      // exhausted quota), and showing it once says more than a duplicate
      // list would.
      failureReason: failures[0] ?? null
    })
  }

  // Always the latest `day`, read inside the timer below rather than
  // closed over at schedule time. The effect that schedules that timer only
  // re-runs when propState or the selected day itself changes — neither of
  // which changes when a live game simply finishes — so without this ref
  // the 20-minute callback would fire holding whatever game statuses were
  // current when the timer was FIRST set, never learning that one of them
  // went final in the meantime.
  const dayRef = useRef(day)
  dayRef.current = day

  // Auto-recheck: a later slate's books often haven't posted anything yet
  // when the day is first checked (see CardView's props-tab caveats). This
  // looks again, every twenty minutes, only at games with nothing posted
  // for either market last time — never a game that already returned a
  // real, priced offer that simply didn't clear the bar, since re-asking
  // for the same answer would just spend API credits for nothing. Stops
  // scheduling entirely once every remaining game either has something or
  // has gone final, and never runs at all until the slate has been checked
  // once — this only extends an opt-in that already happened, it doesn't
  // create a new one.
  useEffect(() => {
    if (propState.status !== 'ready' || propState.dayKey !== day?.key) return
    const liveStatusById = new Map((day?.games ?? []).map((g) => [g.id, g.status]))
    const hasAnyStale = propState.perGame.some((g) => needsRecheck(g, liveStatusById.get(g.game.id)))
    if (!hasAnyStale) return

    let alive = true
    const timer = setTimeout(async () => {
      // Re-read status fresh here rather than trusting the check above: a
      // game that was still scheduled when this timer was set may well have
      // gone final in the twenty minutes since, and re-fetching it anyway
      // would be exactly the credit waste this feature exists to avoid.
      const currentDay = dayRef.current
      if (!alive || currentDay?.key !== propState.dayKey) return
      const currentStatusById = new Map((currentDay?.games ?? []).map((g) => [g.id, g.status]))
      const stale = propState.perGame.filter((g) => needsRecheck(g, currentStatusById.get(g.game.id)))
      if (!stale.length) return

      const { perGame: refreshed, failures } = await checkGames(stale.map((g) => g.game))
      if (!alive) return
      setPropState((prev) => {
        if (prev.status !== 'ready' || prev.dayKey !== propState.dayKey) return prev
        const byId = new Map(refreshed.map((g) => [g.game.id, g]))
        const perGame = prev.perGame.map((g) => byId.get(g.game.id) ?? g)
        return {
          ...prev,
          ...summarizeProps(perGame),
          // A recheck that starts failing (key revoked, quota hit mid-day)
          // should surface that the same way the initial check would —
          // silently keeping the old "nothing posted yet" reasoning around
          // would hide a real, actionable error behind stale copy.
          failureReason: failures[0] ?? prev.failureReason
        }
      })
    }, AUTO_RECHECK_MS)

    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propState, day?.key])

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
          <div className="eyebrow">
            {projectionOnly ? 'The model\'s read on every game · no odds key needed' : 'One play per game · best price across books'}
          </div>
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

      {projectionOnly && (
        <GameProjections rows={projectionRows} day={day} seasonRecord={seasonRecord} />
      )}

      {!projectionOnly && (
        <>
      {/* Card summary */}
      <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">{fmtDay(day.kickoff)}</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>
              {reads.length} leg{reads.length === 1 ? '' : 's'} from{' '}
              {day.games.length} game{day.games.length === 1 ? '' : 's'} ·{' '}
              {plays.length ? `${plays.length} worth a stake` : 'none worth a stake'}
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
            <PlayCard key={entry.best.id} entry={entry} dispatch={dispatch} ratings={data.ratings} />
          ))}
        </div>
      )}

        </>
      )}

      {/* Main-player projections — the model's own read on every game's
          QB1/RB1/WR1/TE1, which needs rosters (free) but no prices. Opt-in
          rather than automatic only because with a key connected the same
          click also prices the slate, which costs real API credits. */}
      <section className="panel" style={{ marginBottom: 'var(--s6)' }}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">
              Passing, rushing &amp; receiving yards · touchdowns
              {oddsKey ? ' · also prices the slate, costs API credits' : ' · no odds key needed'}
            </div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Player projections</h2>
          </div>
          {!propsLoading && (
            <button className="btn" onClick={loadProps}>
              {propsReady
                ? 'Refresh'
                : oddsKey
                  ? `Load projections + prices (~${day.games.length * CARD_PROP_CREDIT_COST} credits)`
                  : 'Load player projections'}
            </button>
          )}
        </div>
        <div style={{ padding: propsReady && boardGames.length ? 0 : 'var(--s4)' }}>
          {!propsReady && !propsLoading && (
            <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '78ch' }}>
              What the model projects for each game&apos;s starting quarterback and lead back,
              receiver and tight end — yards with the range real results usually land in, and
              the chance of a touchdown. Built from each player&apos;s real season stats; nothing
              here depends on a sportsbook.
            </p>
          )}
          {propsLoading && (
            <p className="dim" style={{ fontSize: 12, margin: 0 }}>
              Pulling rosters for {day.games.filter((g) => g.projection && g.status !== 'final').length} game
              {day.games.filter((g) => g.projection && g.status !== 'final').length === 1 ? '' : 's'}…
            </p>
          )}
          {propsReady && propState.failed > 0 && propState.failureReason && (
            <p className="neg" style={{ fontSize: 12, margin: 0, padding: boardGames.length ? 'var(--s4) var(--s4) 0' : 0, maxWidth: '78ch' }}>
              {propState.failed} of {propState.checked} game{propState.checked === 1 ? '' : 's'} could
              not be loaded — {propState.failureReason}
            </p>
          )}
          {propsReady && boardGames.length === 0 && !propState.failed && (
            <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '78ch' }}>
              No upcoming games on this day to project.
            </p>
          )}
          {propsReady && boardGames.map((g) => (
            <PlayerBoard key={g.game.id} entry={g} lines={boardLines} onLine={setBoardLine} />
          ))}
          {propsReady && boardGames.length > 0 && (
            <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4) var(--s4)', margin: 0, maxWidth: '82ch' }}>
              Type your sportsbook&apos;s line under any stat to see the model&apos;s chance of going
              over or under it. Those are chances, not a verdict on the bet — whether a 58% over is
              worth taking depends on the price, which the Props tab handles.{' '}
              For yards, the range is the middle half of outcomes: about one game in four lands
              below it and one in four above (for receptions, whole numbers make it nearer two
              games in three inside). It is wide on purpose — a narrower range would be wrong more
              often than it says; the track record below shows how often it has held.
              &quot;Last yr&quot; marks a line built on last season&apos;s numbers because the
              player has none yet this season.
              {!propState.anyRealStats && propState.statsNote && <> {propState.statsNote}</>}
              {' '}A player listed Questionable or Doubtful is projected as if he plays; one ruled
              Out is left off. Second and third options are on each game&apos;s Props tab.
            </p>
          )}
        </div>
        <TrackRecord record={propAccuracy} />
      </section>

      {/* Priced prop plays — only with a real odds feed. Without one there
          is no market to disagree with, and nothing is invented to fill in. */}
      {oddsKey && propsReady && (
        <section className="panel" style={{ marginBottom: 'var(--s6)' }}>
          <div className="panel-head">
            <div>
              <div className="eyebrow">Touchdown, receiving &amp; rushing yards · live prices</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Prop plays</h2>
            </div>
          </div>
          <div style={{ padding: 'var(--s4)' }}>
            {!propState.anyLiveProps && (
              <p className="neg" style={{ fontSize: 12, margin: 0, maxWidth: '78ch' }}>
                No prices came back for this slate
                {propState.liveErrorReason ? ` — ${propState.liveErrorReason.replace(/\.+$/, '')}` : ''}. Check the odds
                API key and remaining quota in Settings. The projections above don&apos;t depend on it.
              </p>
            )}
            {propState.anyLiveProps && propPlays.length === 0 && (
              <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '78ch' }}>
                {propState.checked} game{propState.checked === 1 ? '' : 's'} checked — nothing cleared
                the bar.{' '}
                {flaggedOnlyGames > 0 && (
                  <>
                    {flaggedOnlyGames} game{flaggedOnlyGames === 1 ? '' : 's'} had only a "Check
                    model" candidate — an edge so large it's more likely a bad depth chart than real
                    value — and those are left off rather than shown as a pick.{' '}
                  </>
                )}
                Touchdown props carry a fifteen-to-twenty-five percent hold, and a yardage line only
                qualifies against a player's own real per-game rate — so most days that is the
                correct answer, not a bug.
                {' '}The Card also only ever plays a team's clear QB1, RB1, WR1 or TE1 — a real edge on
                a second or third option still shows up on the Props tab, just not here.
              </p>
            )}
            {propPlays.length > 0 && (
              <>
                <div style={{ display: 'grid', gap: 'var(--s4)' }}>
                  {propPlays.map((pick) => (
                    <PropPlayCard key={`${pick.game.id}:${pick.entry.key}`} pick={pick} dispatch={dispatch} />
                  ))}
                </div>
                <p className="dim" style={{ fontSize: 11, marginTop: 'var(--s4)', marginBottom: 0, maxWidth: '80ch' }}>
                  Touchdown props are the market this app trusts least: the hold is triple a
                  spread's — capped at 2 units even at the top tier. A yardage play only ever
                  prices against a player's own real season rate, never a league-average guess,
                  and devigs the ordinary two-way way a total does, so it can reach the same
                  3-unit ceiling a game line can.
                </p>
              </>
            )}
            {propState.anyLiveProps && !propPlays.some((p) => p.kind === 'volume') && (
              <p className="dim" style={{ fontSize: 11, marginTop: 'var(--s3)', marginBottom: 0, maxWidth: '78ch' }}>
                {propState.volumeOffersSeen === 0 ? (
                  <>
                    Yardage: the odds feed returned zero receiving/rushing-yard lines for this
                    slate — books often post that market later than anytime touchdown, so try again
                    closer to kickoff before assuming something's broken.
                  </>
                ) : propState.volumeCandidatesPriced === 0 && !propState.anyRealStats ? (
                  <>
                    Yardage: the odds feed returned {propState.volumeOffersSeen} line
                    {propState.volumeOffersSeen === 1 ? '' : 's'}, but not one player on either
                    roster matched this season's bundled stats snapshot — likely a name-matching
                    gap between the roster feed and the snapshot, not a missing data source.
                    {propState.statsNote && <> {propState.statsNote}</>}
                  </>
                ) : propState.volumeCandidatesPriced === 0 ? (
                  <>
                    Yardage: the odds feed returned {propState.volumeOffersSeen} line
                    {propState.volumeOffersSeen === 1 ? '' : 's'}, and at least one roster had real
                    per-player rates, but none of those specific players matched a priced line —
                    likely a name-matching gap between the odds feed and the roster.
                  </>
                ) : (
                  <>
                    Yardage: {propState.volumeCandidatesPriced} play
                    {propState.volumeCandidatesPriced === 1 ? '' : 's'} priced against a real rate,
                    just none with enough edge to clear the bar this time.
                  </>
                )}
              </p>
            )}
            {propState.anyLiveProps && (
              <p className="dim" style={{ fontSize: 10, marginTop: 'var(--s2)', marginBottom: 0 }}>
                Receiving-yard lines: {propState.volumeOffersByMarket.receivingYards ?? 0} seen,{' '}
                {propState.volumeCandidatesByMarket.receivingYards ?? 0} priced against a real rate.
                {' '}Rushing-yard lines: {propState.volumeOffersByMarket.rushingYards ?? 0} seen,{' '}
                {propState.volumeCandidatesByMarket.rushingYards ?? 0} priced against a real rate.
              </p>
            )}
          </div>
        </section>
      )}

      {locked && (
        <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
          This card was locked {new Date(locked.lockedAt).toLocaleString()} and will be graded
          under Results once the games go final. Re-locking replaces that snapshot — which is
          worth avoiding once kickoff has passed, since a card changed after the fact is not
          the card you would have bet.
        </p>
      )}

      {!projectionOnly && (
        <>
      {stats.stackedGames > 0 && (
        <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
          {stats.stackedGames} game{stats.stackedGames === 1 ? ' carries' : 's carry'} more than
          one leg, holding {fmtMoney(stats.stackedRisk)} of the risk. Those legs move together:
          a shootout that beats the total tends to beat both team totals with it. Four plays on
          one game is one opinion at four times the stake, not four independent bets.
        </p>
      )}

      {stats.shortfall > 0 && (
        <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
          This card is {stats.shortfall} short of its {stats.target}-leg target. A game offers
          five independent markets — spread, moneyline, total, and each side's team total — and
          this slate has run out of distinct positions. The remaining legs would have to come
          from touchdown props, on the Props tab of each game. Listing the same bet twice at
          two different numbers would fill the count without adding anything.
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
        </>
      )}
    </div>
  )
}

/* ---------- How the projections have actually done ---------- */

const RECORD_ORDER = ['passingYards', 'rushingYards', 'receivingYards', 'receptions']
const pts = (gap) => `${(gap * 100).toFixed(1)} pts`

/**
 * The measured record behind the board, from prop-accuracy.json — regraded
 * against real results by the same scheduled job that refreshes the player
 * stats (scripts/grade-props.mjs), so these are current numbers, not a
 * one-off claim.
 */
function TrackRecord({ record }) {
  if (!record?.playerWeeks) return null
  const rows = RECORD_ORDER.filter((k) => record.markets?.[k]).map((k) => ({ key: k, ...record.markets[k] }))
  return (
    <div style={{ borderTop: '1px solid var(--edge)', padding: 'var(--s4)' }}>
      <div className="eyebrow">
        Track record · {record.season} season, weeks {record.fromWeek}–{record.throughWeek}
      </div>
      <p className="dim" style={{ fontSize: 12, margin: '4px 0 var(--s3)', maxWidth: '82ch' }}>
        Every week so far was projected from only the weeks before it and compared with what
        happened: {record.playerWeeks.toLocaleString()} lead-player games.
      </p>
      <div className="tbl-scroll">
        <table className="tbl compact" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>Stat</th>
              <th title="Average distance between the projection and the real result.">Avg miss</th>
              <th title="How often the real result landed inside the likely range shown.">In range</th>
              <th title="Average gap between the chance stated for an over and how often it actually hit.">Off by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key}>
                <td>{shortMarketLabel(m.label)}</td>
                <td className="num">{m.mae}</td>
                <td className="num">{fmtPct(m.range.inside, 0)}</td>
                <td className="num">{m.calibration.gap == null ? '—' : pts(m.calibration.gap)}</td>
              </tr>
            ))}
            {record.touchdowns && (
              <tr>
                <td>Scores a TD</td>
                <td className="num dim">—</td>
                <td className="num dim">—</td>
                <td className="num">{record.touchdowns.calibration.gap == null ? '—' : pts(record.touchdowns.calibration.gap)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="dim" style={{ fontSize: 11, margin: 'var(--s3) 0 0', maxWidth: '82ch' }}>
        <strong>Avg miss</strong> is how far the projection was from the real result on average.{' '}
        <strong>In range</strong> is how often the result landed inside the likely range — the
        target is about half for yards and nearer two-thirds for receptions.{' '}
        <strong>Off by</strong> is the average gap between the chance the model gave and how
        often it happened: at 2 points, things it called 60% happened roughly 58–62% of the time.
        Lead players are identified by who had the most chances in earlier weeks, since past depth
        charts aren&apos;t published. Updated {new Date(record.generatedAt).toLocaleDateString()}.
      </p>
    </div>
  )
}

/* ---------- Game projections, when there are no real prices ---------- */

const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }

function GameProjections({ rows, day, seasonRecord }) {
  return (
    <section className="panel" style={{ marginBottom: 'var(--s6)' }}>
      <div className="panel-head">
        <div>
          <div className="eyebrow">{fmtDay(day.kickoff)} · winner, score and total</div>
          <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Game projections</h2>
        </div>
        <Badge tone="quiet">{rows.length} game{rows.length === 1 ? '' : 's'}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="dim" style={{ fontSize: 12, margin: 0, padding: 'var(--s4)' }}>
          No games on this day can be projected yet.
        </p>
      ) : (
        <div className="tbl-scroll">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Game</th>
                <th>Model favours</th>
                <th>Projected score</th>
                <th>Margin</th>
                <th>Total</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.game.id}>
                  <td data-label="Game">
                    <a href={href(`game/${r.game.id}`)} className="row gap-2" style={{ flexWrap: 'wrap' }}>
                      <TeamMark abbr={r.game.away} size={16} />
                      <TeamMark abbr={r.game.home} size={16} />
                      <span>{r.game.away} @ {r.game.home}</span>
                      <span className="dim">
                        {r.final ? `Final ${r.game.awayScore}–${r.game.homeScore}` : fmtTime(r.game.kickoff)}
                      </span>
                    </a>
                  </td>
                  <td className="num" data-label="Model favours">
                    <span>
                      {r.favourite} <span className="dim">{fmtPct(r.favouriteProb, 0)}</span>
                      {r.pickCorrect != null && (
                        <span className={r.pickCorrect ? 'pos' : 'neg'} style={{ marginLeft: 8 }}>
                          {r.pickCorrect ? 'won' : 'lost'}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="num" data-label="Projected score">
                    {r.game.away} {r.awayPoints} – {r.game.home} {r.homePoints}
                  </td>
                  <td className="num" data-label="Margin">
                    {r.margin < 0.5 ? 'Pick’em' : `${r.favourite} by ${r.margin.toFixed(1)}`}
                  </td>
                  <td className="num" data-label="Total">{r.total}</td>
                  <td className="num" data-label="Confidence">
                    <span title={r.confidenceFactors.join(' ')}>
                      {CONFIDENCE_LABEL[r.confidence] ?? '—'}
                      {r.qbOut && <span className="neg" style={{ marginLeft: 8 }}>QB out</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dim" style={{ fontSize: 11, padding: 'var(--s3) var(--s4) var(--s4)', margin: 0, maxWidth: '82ch' }}>
        {seasonRecord && (
          <>
            This season so far, across {seasonRecord.n} finished game{seasonRecord.n === 1 ? '' : 's'}: the
            model&apos;s favourite won {fmtPct(seasonRecord.accuracy, 0)} of the time, and its projected
            margin missed the real one by {seasonRecord.marginMae.toFixed(1)} points on average (totals
            by {seasonRecord.totalMae.toFixed(1)}).{' '}
          </>
        )}
        These are the model&apos;s own numbers, not bets. No sportsbook prices are connected, so
        nothing here is compared with a line — an &quot;edge&quot; against made-up prices would mean
        nothing. Connect an odds API key in Settings to see priced plays; tap a game for the full
        breakdown.
      </p>
    </section>
  )
}

/* ---------- One play, as a ticket ---------- */

function PlayCard({ entry, dispatch, ratings }) {
  const { game, best, tier, alternate, stake, kellyStake, reason } = entry
  const isLean = tier.units === 0
  const consensus = game.market?.books?.find((b) => b.sharp) || game.market?.books?.[0]
  // Guard the divide: a lean has no flat stake to compare Kelly against.
  const kellyGap = stake > 0 && kellyStake > 0 ? kellyStake / stake : 0

  const homeTeam = getTeam(game.home)
  const awayTeam = getTeam(game.away)
  const hr = ratings?.[game.home]
  const ar = ratings?.[game.away]

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
      className={`panel play-card${tier.units >= 3 ? ' play-card--best' : ''}${tier.suspicious ? ' play-card--suspicious' : ''}`}
      style={{
        opacity: isLean ? 0.72 : 1,
        '--gcard-away': readable(awayTeam.primary),
        '--gcard-home': readable(homeTeam.primary)
      }}
    >
      <div className="play-card-accent" />
      <div className="gcard-strap">
        <span className="row gap-2">
          <TeamMark abbr={game.away} size={16} />
          <TeamMark abbr={game.home} size={16} />
          {game.away} @ {game.home}
        </span>
        <span>{fmtTime(game.kickoff)}{game.venue ? ` · ${game.venue}` : ''}</span>
      </div>

      {hr && ar && (
        <div
          className="row spread-between gap-3"
          style={{
            padding: '7px var(--s4)',
            borderBottom: '1px solid var(--edge)',
            flexWrap: 'wrap'
          }}
        >
          <span className="dim mono" style={{ fontSize: 11 }}>
            {game.away} {fmtSigned(ar.pointsVsAverage)} pts vs avg{recordFor(ar) ? ` (${recordFor(ar)})` : ''} ·{' '}
            {game.home} {fmtSigned(hr.pointsVsAverage)} pts vs avg{recordFor(hr) ? ` (${recordFor(hr)})` : ''}
          </span>
          {game.projection && (
            <span className="dim mono" style={{ fontSize: 11 }}>
              Model projects {game.away} {game.projection.awayTeamTotal} – {game.home} {game.projection.homeTeamTotal}
            </span>
          )}
        </div>
      )}

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
              {entry.correlated && (
                <Badge tone="quiet">
                  Same game as leg {entry.sameGameIndex}
                </Badge>
              )}
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

/* ---------- One prop play, as a ticket ---------- */

/** Shorten "Receiving yards" -> "Receiving yds" to fit a badge. */
const shortMarketLabel = (label) => label.replace(' yards', ' yds')

const isCountLine = (market) => market === 'receptions' || market === 'rushingAttempts'
const fmtProjection = (line) => (isCountLine(line.market) ? line.mean.toFixed(1) : String(Math.round(line.mean)))
const fmtRange = (line) =>
  line.low == null || line.high == null ? '—' : `${Math.round(line.low)}–${Math.round(line.high)}`

/** One projected stat line: the number, its range, and a box for the user's own sportsbook line. */
function BoardLine({ line, who, value, onChange }) {
  const outlook = lineOutlook(line.market, line.mean, value)
  return (
    <td className="num" data-label={`${line.label}${line.priorSeason ? ' · last yr' : ''}`}>
      {/* minWidth 0 lets this shrink inside the phone layout's flex row, so the over/under text wraps instead of pushing the box off-screen. */}
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div>
          {fmtProjection(line)}
          <span className="dim hide-sm"> {shortMarketLabel(line.label)}{line.priorSeason ? ' · last yr' : ''}</span>
          <span className="dim" style={{ marginLeft: 10 }}>{fmtRange(line)}</span>
        </div>
        <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, whiteSpace: 'normal' }} aria-live="polite">
            {outlook?.invalid && <span className="neg">not a line</span>}
            {outlook && !outlook.invalid && (
              <>
                <span className={outlook.over >= outlook.under ? '' : 'dim'}>Over {fmtPct(outlook.over, 0)}</span>
                <span className="dim"> · </span>
                <span className={outlook.under > outlook.over ? '' : 'dim'}>Under {fmtPct(outlook.under, 0)}</span>
                {outlook.push > 0.005 && <span className="dim"> · push {fmtPct(outlook.push, 0)}</span>}
              </>
            )}
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="line"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value.trim())}
            style={{ width: 66, textAlign: 'right' }}
            aria-label={`Your sportsbook's ${line.label.toLowerCase()} line for ${who}`}
          />
        </div>
      </div>
    </td>
  )
}

/** One game's main players: projected stat lines with their likely range, and touchdown chance. */
function PlayerBoard({ entry, lines, onLine }) {
  const { game, board } = entry
  const homeTeam = getTeam(game.home)
  const awayTeam = getTeam(game.away)
  return (
    <div
      style={{
        borderTop: '1px solid var(--edge)',
        '--gcard-away': readable(awayTeam.primary),
        '--gcard-home': readable(homeTeam.primary)
      }}
    >
      <div className="gcard-strap">
        <span className="row gap-2">
          <TeamMark abbr={game.away} size={16} />
          <TeamMark abbr={game.home} size={16} />
          {game.away} @ {game.home}
        </span>
        <span className="row gap-3">
          {fmtTime(game.kickoff)}
          <a href={href(`game/${game.id}`)} style={{ color: 'var(--gold)' }}>Props</a>
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="tbl responsive">
          <thead>
            <tr>
              <th>Player</th>
              <th>Projection · likely range</th>
              <th>Also · likely range</th>
              <th>Scores a TD</th>
            </tr>
          </thead>
          <tbody>
            {board.map((p) => {
              const [first, second] = p.lines
              const lineKey = (l) => `${game.id}|${normPropName(p.name)}|${l.market}`
              return (
                <tr key={`${p.team}:${p.name}`}>
                  <td data-label="Player">
                    <span className="row gap-2" style={{ flexWrap: 'wrap' }}>
                      <TeamMark abbr={p.team} size={16} />
                      <span>{p.name}</span>
                      <span className="dim">{p.role === 'QB' ? 'QB' : p.role.slice(0, 2)}</span>
                      {p.injury && !/active/i.test(p.injury) && <Badge tone="live">{p.injury}</Badge>}
                    </span>
                  </td>
                  {first
                    ? <BoardLine line={first} who={p.name} value={lines[lineKey(first)]} onChange={(v) => onLine(lineKey(first), v)} />
                    : (
                      <td className="num dim" data-label="Projection" title="No real per-game rate on record for this player yet.">
                        no rate yet
                      </td>
                    )}
                  {second
                    ? <BoardLine line={second} who={p.name} value={lines[lineKey(second)]} onChange={(v) => onLine(lineKey(second), v)} />
                    : <td className="num dim hide-sm" data-label="Also">—</td>}
                  <td className="num" data-label="Scores a TD">
                    {p.tdProb == null ? '—' : fmtPct(p.tdProb)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PropPlayCard({ pick, dispatch }) {
  const { game, kind, entry, tier, stake, reason } = pick
  const homeTeam = getTeam(game.home)
  const awayTeam = getTeam(game.away)
  const isVolume = kind === 'volume'
  const isLean = tier.units === 0
  const reasons = reasonsForPick(pick)

  const modelProb = isVolume ? entry.modelProb : entry.model.prob
  const title = isVolume
    ? `${entry.player} ${entry.side === 'over' ? 'Over' : 'Under'} ${entry.line} ${entry.marketLabel}`
    : `${entry.player} anytime TD`
  const badgeLabel = isVolume ? shortMarketLabel(entry.marketLabel) : 'TD prop'

  const add = () =>
    dispatch({
      type: 'addLeg',
      leg: {
        id: `${game.id}:${isVolume ? 'vol' : 'td'}:${entry.key}`,
        label: title,
        matchup: `${game.away} @ ${game.home}`,
        gameId: game.id,
        book: entry.book,
        price: entry.price,
        modelProb,
        marketProb: entry.fair,
        pushProb: 0,
        ev: entry.ev,
        suggestedStake: stake,
        stake: Math.max(1, Math.round(stake))
      }
    })

  return (
    <article
      className={`panel play-card${tier.units >= 2 ? ' play-card--best' : ''}${tier.suspicious ? ' play-card--suspicious' : ''}`}
      style={{
        opacity: isLean ? 0.72 : 1,
        '--gcard-away': readable(awayTeam.primary),
        '--gcard-home': readable(homeTeam.primary)
      }}
    >
      <div className="play-card-accent" />
      <div className="gcard-strap">
        <span className="row gap-2">
          <TeamMark abbr={game.away} size={16} />
          <TeamMark abbr={game.home} size={16} />
          {game.away} @ {game.home}
        </span>
        <span>{fmtTime(game.kickoff)}</span>
      </div>

      <div style={{ padding: 'var(--s4)' }}>
        <div
          className="row spread-between gap-4"
          style={{ flexWrap: 'wrap', marginBottom: 'var(--s4)' }}
        >
          <div style={{ minWidth: 200 }}>
            <div className="row gap-3" style={{ marginBottom: 6 }}>
              <Badge tone={tier.tone}>{isLean ? 'Lean · no stake' : `${tier.units}u · ${tier.label}`}</Badge>
              <Badge tone="quiet">{badgeLabel}</Badge>
            </div>
            <h3 style={{ fontSize: 'var(--t-xl)' }}>
              <span className="row gap-2">
                <TeamMark abbr={entry.team} size={18} />
                {title}
              </span>
            </h3>
            <div className="row gap-3" style={{ marginTop: 4 }}>
              <span className="mono market" style={{ fontSize: 'var(--t-lg)' }}>
                {fmtOdds(entry.price)}
              </span>
              <span className="dim mono" style={{ fontSize: 12 }}>{entry.book}</span>
            </div>
          </div>

          <div className="row gap-5" style={{ flexWrap: 'wrap' }}>
            <Metric label="Model" value={fmtPct(modelProb)} />
            <Metric label="Fair" value={fmtPct(entry.fair)} dim />
            <Metric label="Edge" value={`${fmtSigned((entry.edge ?? 0) * 100)}pp`} />
            <Metric
              label="EV"
              value={`${entry.ev >= 0 ? '+' : ''}${(entry.ev * 100).toFixed(1)}%`}
              tone={entry.ev > 0 ? 'pos' : 'neg'}
            />
            <Metric label="Stake" value={isLean ? '—' : fmtMoney(stake)} dim={isLean} />
          </div>
        </div>

        {reasons.length > 0 && (
          <ul className="dim" style={{ fontSize: 11, margin: '0 0 var(--s3)', paddingLeft: 18 }}>
            {reasons.map((reason, i) => <li key={i}>{reason}</li>)}
          </ul>
        )}

        {isVolume && (
          <p className="dim" style={{ fontSize: 11, margin: '0 0 var(--s3)' }}>
            Projected to {entry.mean} {entry.marketLabel.toLowerCase()} for this matchup.
          </p>
        )}

        <div className="perf" />

        <div className="row spread-between gap-3" style={{ flexWrap: 'wrap' }}>
          <p className="dim grow" style={{ fontSize: 11, margin: 0, minWidth: 240 }}>
            {isLean && <span>{reason}. Shown as the model's read on this player, not as a bet. </span>}
            {tier.suspicious && (
              <span className="neg">
                {isVolume
                  ? 'An edge this large on a yardage line is far more likely to be a bad matchup read than free money — check the injury report before betting it. '
                  : 'An edge this large on a touchdown prop is far more likely to be a bad depth chart than free money — check who is actually active before betting it. '}
              </span>
            )}
            {isVolume
              ? "Priced against this player's own season rate, adjusted for this game's projected environment."
              : 'Anytime touchdown markets hold 15–25% and rely on a guessed depth chart; treat this as a lean worth a second look, not a lock.'}
          </p>
          <div className="row gap-2">
            <a className="btn ghost" href={href(`game/${game.id}`)}>Game</a>
            {!isLean && <button className="btn" onClick={add}>Add</button>}
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * A team's record, from whichever ratings shape is on hand: the season
 * replay adds live `w`/`l`/`t` once results exist, but before any games are
 * played (or if that replay failed) ratings fall back to the opening file,
 * which only carries last season's final `wins`/`losses`. Shown either way,
 * never invented — a record this can't find is simply left off the line.
 */
function recordFor(r) {
  if (!r) return null
  if (r.w != null && r.l != null) return fmtRecord(r.w, r.l, r.t ?? 0)
  if (r.wins != null && r.losses != null) return fmtRecord(r.wins, r.losses)
  return null
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
