import { useEffect, useMemo, useRef, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import EdgeRail from '../components/EdgeRail.jsx'
import { Badge, Empty, Tabs } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { toSlipLeg } from '../lib/edges.js'
import { buildCard, daysFrom, confidenceOf, lockCard, tierForProp, tierForVolume, pickPropsForGame, sortPropPicks, isMainPlayer } from '../lib/card.js'
import { analyseAnytimeTouchdowns, volumePlaysForGame } from '../lib/props.js'
import { reasonsForPick } from '../lib/reasons.js'
import { fetchGameRosters } from '../data/providers/playerData.js'
import { fetchGameProps, CARD_PROP_MARKETS, CARD_PROP_CREDIT_COST } from '../data/providers/oddsApiProvider.js'
import { buildPropOffers } from '../data/propMarkets.js'
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
 * closer. A game already final never needs re-checking regardless.
 *
 * `liveStatus` must come from the current slate, not from `g.game.status` —
 * that field is a snapshot frozen at whatever moment this game was last
 * fetched, and a game checked while it was still scheduled never updates its
 * own copy to 'final' on its own. Trusting the frozen copy would recheck an
 * already-finished game forever, spending API credits on nothing.
 */
const needsRecheck = (g, liveStatus) =>
  liveStatus !== 'final' && (g.anytimeOffers ?? 0) === 0 && (g.volumeOffers ?? 0) === 0

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
    // Whether any game on this slate priced against a simulated board rather
    // than a live one — because no key is connected, or the live fetch
    // failed (a bad key, an exhausted quota) for that specific game.
    anySimulatedProps: perGame.some((g) => g.simulated),
    allSimulatedProps: perGame.length > 0 && perGame.every((g) => g.simulated),
    simulatedPropsReason: perGame.find((g) => g.simulated && g.liveError)?.liveError ?? null
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
    for (const { game, anytime, volume } of propState.perGame) {
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
        continue
      }
      for (const leg of legs) {
        picks.push({ game, kind: leg.kind, entry: leg.entry, tier: leg.tier, stake: leg.tier.units * unit })
      }
    }
    return { picks: sortPropPicks(picks).slice(0, 12), flaggedOnly }
  }, [propsReady, propState, settings, day])
  const { picks: propPlays, flaggedOnly: flaggedOnlyGames } = propResult

  // Shared by the manual "Check this slate" button and the auto-recheck
  // effect below, so a game is only ever priced through this one path.
  const checkGames = async (games) => {
    const settled = await Promise.allSettled(
      games.map(async (g) => {
        const rosters = await fetchGameRosters(g)

        // Live prices when a key is connected; a simulated board — built the
        // same way markets.js already fills in game lines with no odds key —
        // whenever there is no key, or the live fetch for this specific game
        // fails (a bad key, an exhausted quota). That keeps the Card able to
        // produce prop plays even with the API unavailable, while still
        // carrying the real failure reason through so it stays visible
        // rather than silently swallowed.
        let props = null
        let liveError = null
        if (oddsKey) {
          try {
            props = await fetchGameProps({ apiKey: oddsKey, game: g, markets: CARD_PROP_MARKETS })
          } catch (err) {
            liveError = err.message
          }
        }
        const simulated = !props
        if (simulated) {
          props = buildPropOffers({ game: g, proj: g.projection, rosters, ratings: data.ratings })
        }

        const { anytime } = analyseAnytimeTouchdowns({ game: g, proj: g.projection, rosters, props })
        const volume = volumePlaysForGame({ game: g, proj: g.projection, rosters, offers: props?.volume, ratings: data.ratings })
        return {
          game: g, anytime, volume, simulated, liveError,
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
    // just hasn't posted anything." A bad or quota-exhausted odds key no
    // longer lands here: it is caught per-game above and priced against a
    // simulated board instead, surfaced via `simulated`/`liveError` rather
    // than failing the whole game.
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

      {/* Touchdown props — never fetched automatically when a key is
          connected, same reasoning as the Props tab: checking a whole slate
          costs real API credits. With no key, or a key whose quota is used
          up, this checks for free against a simulated board instead — see
          propMarkets.js — so the card can still produce prop plays. */}
      <section className="panel" style={{ marginBottom: 'var(--s6)' }}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">
              Touchdown, receiving &amp; rushing yards
              {oddsKey ? ' · opt-in, costs API credits' : ' · simulated without an odds API key'}
            </div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Prop plays</h2>
          </div>
          {!propsLoading && (
            <button className="btn" onClick={loadProps}>
              {propsReady
                ? 'Re-check props'
                : oddsKey
                  ? `Check this slate (~${day.games.length * CARD_PROP_CREDIT_COST} credits)`
                  : 'Check this slate (simulated)'}
            </button>
          )}
        </div>
        <div style={{ padding: 'var(--s4)' }}>
          {!propsReady && !propsLoading && (
            <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '78ch' }}>
              {oddsKey
                ? 'Connect an odds API key in Settings to check the slate for touchdown, receiving-yard and rushing-yard prop value.'
                : <>No odds API key is connected (or its quota is used up), so this prices against a
                  simulated board instead — the model's own numbers against a plausible market
                  disagreement, the same way the card already fills in spreads and totals with no
                  key. Connect a working key in Settings for real prices.</>}
            </p>
          )}
          {propsLoading && (
            <p className="dim" style={{ fontSize: 12, margin: 0 }}>
              Pulling rosters and prop prices for {day.games.filter((g) => g.projection && g.status !== 'final').length} game
              {day.games.length === 1 ? '' : 's'}…
            </p>
          )}
          {propsReady && propState.anySimulatedProps && (
            <p className="dim" style={{ fontSize: 12, margin: '0 0 var(--s3)', maxWidth: '78ch' }}>
              {propState.allSimulatedProps
                ? 'Every game on this slate priced against a simulated board'
                : `${propState.perGame.filter((g) => g.simulated).length} of ${propState.checked} game${propState.checked === 1 ? '' : 's'} priced against a simulated board`}
              {propState.simulatedPropsReason ? ` (${propState.simulatedPropsReason})` : ' (no odds API key connected)'} — model numbers against a
              plausible market disagreement, not a real quote. Connect a working odds API key in
              Settings for live prices.
            </p>
          )}
          {propsReady && propState.failed > 0 && propState.failureReason && (
            <p className="neg" style={{ fontSize: 12, margin: '0 0 var(--s3)', maxWidth: '78ch' }}>
              {propState.failed} of {propState.checked} game{propState.checked === 1 ? '' : 's'} failed
              to check outright — {propState.failureReason} That is a real fetch failure, not "nothing
              posted yet." If this keeps happening, check the odds API key and remaining quota in
              Settings before assuming there's no value on the slate.
            </p>
          )}
          {propsReady && propPlays.length === 0 && (
            <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '78ch' }}>
              {propState.checked} game{propState.checked === 1 ? '' : 's'} checked
              {propState.failed ? `, ${propState.failed} could not be priced` : ''} — nothing cleared
              the bar.{' '}
              {flaggedOnlyGames > 0 && (
                <>
                  {flaggedOnlyGames} game{flaggedOnlyGames === 1 ? '' : 's'} had only a "Check
                  model" candidate — an edge so large it's more likely a bad depth chart than real
                  value — and those are left off rather than shown as a pick.{' '}
                </>
              )}
              Touchdown props carry a fifteen-to-twenty-five percent hold on top of a
              depth chart the model is often guessing at, and a yardage line only qualifies against
              a player's own real per-game rate — so most days that is the correct answer, not a bug.
              {' '}The Card also only ever plays a team's clear QB1, RB1, WR1 or TE1 — a real edge on
              a second or third option still shows up on the Props tab, just not here.
            </p>
          )}
          {propsReady && propPlays.length > 0 && (
            <>
              <div style={{ display: 'grid', gap: 'var(--s4)' }}>
                {propPlays.map((pick) => (
                  <PropPlayCard key={`${pick.game.id}:${pick.entry.key}`} pick={pick} dispatch={dispatch} />
                ))}
              </div>
              <p className="dim" style={{ fontSize: 11, marginTop: 'var(--s4)', marginBottom: 0, maxWidth: '80ch' }}>
                Touchdown props are the market this app trusts least: the hold is triple a
                spread's, and early in a season every player at a position can show the same
                number because there is no depth chart to rank yet — capped at 2 units even at the
                top tier. A yardage play only ever prices against a player's own real season rate,
                never a league-average guess, and devigs the ordinary two-way way a total does, so
                it can reach the same 3-unit ceiling a game line can.
              </p>
            </>
          )}
          {propsReady && !propPlays.some((p) => p.kind === 'volume') && (
            <p className="dim" style={{ fontSize: 11, marginTop: propPlays.length > 0 ? 'var(--s3)' : 0, marginBottom: 0, maxWidth: '78ch' }}>
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
          {propsReady && (
            <p className="dim" style={{ fontSize: 10, marginTop: 'var(--s2)', marginBottom: 0 }}>
              Receiving-yard lines: {propState.volumeOffersByMarket.receivingYards ?? 0} seen,{' '}
              {propState.volumeCandidatesByMarket.receivingYards ?? 0} priced against a real rate.
              {' '}Rushing-yard lines: {propState.volumeOffersByMarket.rushingYards ?? 0} seen,{' '}
              {propState.volumeCandidatesByMarket.rushingYards ?? 0} priced against a real rate.
            </p>
          )}
        </div>
      </section>

      {locked && (
        <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)', maxWidth: '80ch' }}>
          This card was locked {new Date(locked.lockedAt).toLocaleString()} and will be graded
          under Results once the games go final. Re-locking replaces that snapshot — which is
          worth avoiding once kickoff has passed, since a card changed after the fact is not
          the card you would have bet.
        </p>
      )}

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
    </div>
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

function PropPlayCard({ pick, dispatch }) {
  const { game, kind, entry, tier, stake } = pick
  const homeTeam = getTeam(game.home)
  const awayTeam = getTeam(game.away)
  const isVolume = kind === 'volume'
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
              <Badge tone={tier.tone}>{`${tier.units}u · ${tier.label}`}</Badge>
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
            <Metric label="Stake" value={fmtMoney(stake)} />
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
            <button className="btn" onClick={add}>Add</button>
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
