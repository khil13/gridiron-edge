/**
 * props.js — anytime touchdown and quarterback passing-touchdown props.
 *
 * These are the hardest markets in the app to model and the easiest to lose
 * money on, so the maths is written to be conservative and the uncertainty
 * is surfaced rather than buried.
 *
 * The chain:
 *   1. The game model already projects each team's points.
 *   2. Points convert to an expected number of touchdowns.
 *   3. A player's share of his team's touchdowns comes from real season
 *      data, shrunk hard toward a positional prior while the sample is thin.
 *   4. Touchdowns per player are Poisson, so P(scores at least one) is
 *      1 - e^-lambda.
 *
 * Every step after the first depends on data that may be missing, stale, or
 * about to be invalidated by an inactive list. Nothing here is invented when
 * the data is absent — the player is omitted instead.
 */

/**
 * Points to touchdowns.
 *
 * An average NFL team scores about 22 points from roughly 2.3 touchdowns
 * plus field goals and extra points. The ratio is not points/7, because a
 * meaningful share of scoring comes from kicks.
 */
export const TOUCHDOWN_RATE = 0.105

export const expectedTouchdowns = (teamPoints) =>
  Math.max(0, (teamPoints ?? 0) * TOUCHDOWN_RATE)

/** Roughly 60% of NFL touchdowns are thrown rather than run. */
export const PASSING_TD_SHARE = 0.6

/**
 * Prior share of a team's touchdowns by role, used before real data exists
 * and blended with it afterwards. These are rough league-wide averages, not
 * team-specific, which is exactly why they get replaced as games are played.
 */
export const ROLE_PRIORS = {
  QB: 0.06,   // rushing only; passing touchdowns are handled separately
  RB1: 0.20, RB2: 0.08, RB: 0.05,
  WR1: 0.16, WR2: 0.11, WR3: 0.06, WR: 0.03,
  TE1: 0.09, TE: 0.03,
  K: 0, DEF: 0.02
}

/**
 * How much to trust observed touchdown share over the prior.
 *
 * Touchdowns are rare, so a player's share is a very noisy statistic early
 * on: one score in two games is not a 50% share. Weight reaches half at
 * about six team games and approaches full trust near the end of a season.
 */
export function sampleWeight(teamGames) {
  if (!teamGames || teamGames <= 0) return 0
  return teamGames / (teamGames + 6)
}

/**
 * Blend observed share with the positional prior.
 *
 * @param {number} playerTds     touchdowns scored by the player
 * @param {number} teamTds       touchdowns scored by the team
 * @param {number} teamGames     games the team has played
 * @param {string} role          key into ROLE_PRIORS
 */
export function touchdownShare(playerTds, teamTds, teamGames, role) {
  const prior = ROLE_PRIORS[role] ?? 0.04
  if (!teamTds || !teamGames) return prior
  const observed = playerTds / teamTds
  const w = sampleWeight(teamGames)
  return observed * w + prior * (1 - w)
}

/* ---------- Poisson ---------- */

export const poissonAtLeastOne = (lambda) => 1 - Math.exp(-Math.max(0, lambda))

export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 2; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

/** P(X > line) for a half-point line, i.e. P(X >= ceil(line)). */
export function poissonOver(lambda, line) {
  const need = Math.ceil(line)
  let below = 0
  for (let k = 0; k < need; k++) below += poissonPmf(k, lambda)
  return Math.max(0, Math.min(1, 1 - below))
}

/** Probability of landing exactly on a whole-number line, which pushes. */
export const poissonPush = (lambda, line) =>
  Number.isInteger(line) ? poissonPmf(line, lambda) : 0

/* ---------- Player projections ---------- */

/**
 * Project every listed player's anytime-touchdown probability.
 *
 * @param {Array}  players  [{ id, name, team, role, tds }]
 * @param {object} teamCtx  { [abbr]: { expectedTds, teamTds, games } }
 */
export function projectAnytimeTouchdowns(players, teamCtx) {
  return players
    .map((p) => {
      const ctx = teamCtx[p.team]
      if (!ctx || !ctx.expectedTds) return null

      // A flat share means the caller could not establish a depth chart, so
      // there is nothing to blend an observed rate against.
      const share = p.flatShare != null
        ? p.flatShare
        : touchdownShare(p.tds ?? 0, ctx.teamTds, ctx.games, p.role)
      const lambda = ctx.expectedTds * share
      return {
        ...p,
        share: round3(share),
        lambda: round3(lambda),
        prob: poissonAtLeastOne(lambda),
        // Carried through so the UI can say how much of this is a guess.
        sampleWeight: round2(sampleWeight(ctx.games)),
        teamGames: ctx.games ?? 0
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.prob - a.prob)
}

/**
 * Normalise the field so the projected touchdown scorers add up.
 *
 * Independent per-player probabilities do not have to be consistent with the
 * number of touchdowns the game model expects. Scaling the field to match is
 * what keeps the two halves of the model honest with each other.
 */
export function normaliseField(projections, teamCtx) {
  const byTeam = {}
  for (const p of projections) (byTeam[p.team] ??= []).push(p)

  const out = []
  for (const [team, players] of Object.entries(byTeam)) {
    const ctx = teamCtx[team]
    const target = ctx?.expectedTds ?? 0
    const sum = players.reduce((s, p) => s + p.lambda, 0)
    const scale = sum > 0 && target > 0 ? target / sum : 1
    for (const p of players) {
      const lambda = p.lambda * scale
      out.push({ ...p, lambda: round3(lambda), prob: poissonAtLeastOne(lambda) })
    }
  }
  return out.sort((a, b) => b.prob - a.prob)
}

/**
 * Quarterback passing touchdowns.
 *
 * The team's expected touchdowns, split to the passing share, then treated
 * as Poisson. A starter is assumed to take essentially all of a team's
 * passing touchdowns; a backup taking over mid-game is exactly the sort of
 * thing this model cannot see, which is why the UI says so.
 */
export function projectPassingTouchdowns(teamPoints, { passShare = PASSING_TD_SHARE, starterShare = 0.93 } = {}) {
  const lambda = expectedTouchdowns(teamPoints) * passShare * starterShare
  return {
    lambda: round3(lambda),
    /** @param {number} line e.g. 1.5 */
    over: (line) => {
      const push = poissonPush(lambda, line)
      const win = poissonOver(lambda, line)
      return { win, push, lose: Math.max(0, 1 - win - push) }
    },
    under: (line) => {
      const push = poissonPush(lambda, line)
      const over = poissonOver(lambda, line)
      return { win: Math.max(0, 1 - over - push), push, lose: over }
    }
  }
}

/* ---------- Removing the vig from a many-outcome market ---------- */

/**
 * Anytime touchdown is not a two-way market.
 *
 * A book posts a list of "yes" prices whose implied probabilities sum well
 * above the number of players who will actually score — holds of ten to
 * twenty percent are normal here, several times what a spread carries.
 * Treating each price as a fair two-way market would manufacture an edge on
 * almost every player.
 *
 * Two things make this easy to get wrong, and both are guarded:
 *
 *   1. The posted field covers BOTH teams, but players compete for their own
 *      team's touchdowns. Normalising a whole-game field against one team's
 *      expected scorers halves every probability. So the field is split by
 *      team and each side normalised against its own expectation.
 *
 *   2. It only works on a COMPLETE field. Devigging a subset scales the
 *      survivors up to cover the missing players and invents an edge on
 *      every one of them.
 *
 * @param {Array<{team:string, impliedProb:number}>} entries whole posted field
 * @param {object} teamCtx { [abbr]: { expectedTds } }
 * @param {number} minField smallest per-team list treated as complete
 */
export function devigField(entries, teamCtx, { minField = 6 } = {}) {
  const byTeam = {}
  for (const e of entries) (byTeam[e.team] ??= []).push(e)

  const out = new Map()
  const teams = {}

  for (const [team, list] of Object.entries(byTeam)) {
    const target = expectedScorers(teamCtx[team]?.expectedTds ?? 0)
    const sum = list.reduce((s, e) => s + e.impliedProb, 0)
    const scale = sum > 0 && target > 0 ? target / sum : 1

    // A scale above 1 means the prices imply FEWER scorers than the game is
    // expected to produce, which does not happen in a real market: a book
    // always sells more probability than exists. Together with a short list
    // it means the field is incomplete, so it is left alone and flagged.
    const complete = list.length >= minField && scale <= 1 && target > 0

    teams[team] = {
      players: list.length,
      impliedSum: round3(sum),
      expectedScorers: round3(target),
      hold: complete ? round3(sum / target - 1) : null,
      complete
    }

    for (const e of list) {
      out.set(e, complete ? Math.min(0.99, e.impliedProb * scale) : e.impliedProb)
    }
  }

  return {
    fair: entries.map((e) => out.get(e)),
    teams,
    complete: Object.values(teams).every((t) => t.complete)
  }
}

/**
 * Distinct scorers expected, given a number of touchdowns.
 *
 * Fewer than the touchdown count, because one player scoring twice is common.
 * From a Poisson field spread over roughly n contributors, the expected
 * number of distinct scorers is n(1 - e^(-tds/n)).
 */
export function expectedScorers(totalTds, contributors = 6.5) {
  if (totalTds <= 0) return 0
  return contributors * (1 - Math.exp(-totalTds / contributors))
}


/* ------------------------------------------------------------------ */
/* Yardage, receptions and volume props                                */
/* ------------------------------------------------------------------ */

import { overProbabilityFor, VARIABILITY } from './distributions.js'

/** Markets that can be projected from season rate data. */
export const VOLUME_MARKETS = [
  { key: 'receivingYards', label: 'Receiving yards', stat: 'receivingYards', positions: ['WR', 'TE', 'RB'] },
  { key: 'receptions', label: 'Receptions', stat: 'receptions', positions: ['WR', 'TE', 'RB'] },
  { key: 'rushingYards', label: 'Rushing yards', stat: 'rushingYards', positions: ['RB', 'QB', 'WR'] },
  { key: 'rushingAttempts', label: 'Rush attempts', stat: 'rushingAttempts', positions: ['RB', 'QB'] },
  { key: 'passingYards', label: 'Passing yards', stat: 'passingYards', positions: ['QB'] }
]

/**
 * Positional-average per-game rates, used only when a player's own season
 * rate is unavailable (ESPN's per-athlete stats feed has been unreliable —
 * see playerData.js). Rough, public, well-known NFL per-game norms by
 * depth-chart role, not this player's own numbers.
 *
 * This is exactly the same tradeoff the touchdown model already makes —
 * blend toward a positional prior when real data is thin — extended to
 * volume markets, which the rest of this file used to refuse outright ("a
 * positional average is worthless for a yardage line"). That is still true
 * as a *substitute* for real data; it is better than refusing to show
 * anything at all, provided it is never presented as this player's own
 * rate. Every row built from this is flagged `synthetic: true` so the UI
 * can say so.
 */
export const VOLUME_PRIORS = {
  QB:  { passingYards: 235, passingAttempts: 33, rushingYards: 14, rushingAttempts: 3 },
  RB1: { rushingYards: 65, rushingAttempts: 14, receivingYards: 18, receptions: 2.5 },
  RB2: { rushingYards: 30, rushingAttempts: 7, receivingYards: 8, receptions: 1.2 },
  RB:  { rushingYards: 12, rushingAttempts: 3, receivingYards: 4, receptions: 0.6 },
  WR1: { receivingYards: 68, receptions: 5.2 },
  WR2: { receivingYards: 45, receptions: 3.8 },
  WR3: { receivingYards: 28, receptions: 2.5 },
  WR:  { receivingYards: 14, receptions: 1.3 },
  TE1: { receivingYards: 42, receptions: 3.6 },
  TE2: { receivingYards: 24, receptions: 2.2 },
  TE:  { receivingYards: 16, receptions: 1.5 }
}

/**
 * Project a player's volume statistic for one game.
 *
 * Two inputs, both real: the player's per-game rate this season, and how
 * this game's environment compares with the games behind that rate. A
 * receiver on a team projected for 30 points against a season average of 20
 * gets scaled up, because more possessions and more scoring means more
 * production to go around.
 *
 * The environment adjustment is deliberately damped. Game totals move more
 * than any individual's share of them, so passing the full ratio through
 * would overstate every projection in a shootout and understate it in a
 * defensive game.
 */
export const ENVIRONMENT_DAMPING = 0.6

export function projectVolume(player, market, { teamPoints, teamAverage }) {
  const stats = player.stats
  const games = stats?.games
  const total = stats?.[market.stat]

  let perGame
  let synthetic
  if (games >= 1 && total != null) {
    perGame = total / games
    synthetic = false
  } else {
    // No real rate for this player. Fall back to a positional average
    // rather than refusing outright — clearly flagged as synthetic so nothing
    // downstream can present it as this player's own number.
    const prior = VOLUME_PRIORS[player.role]?.[market.stat]
    if (prior == null) return null
    perGame = prior
    synthetic = true
  }
  if (perGame <= 0) return null

  const ratio = teamAverage > 0 ? teamPoints / teamAverage : 1
  const damped = 1 + (ratio - 1) * ENVIRONMENT_DAMPING
  const mean = perGame * clampRatio(damped)

  return {
    market: market.key,
    label: market.label,
    perGame: round1(perGame),
    games: games ?? 0,
    synthetic,
    environment: round2(damped),
    mean: round1(mean),
    variability: VARIABILITY[market.key] ?? null,
    /** @param {number} line */
    over: (line) => overProbabilityFor(market.key, mean, line),
    under: (line) => {
      const o = overProbabilityFor(market.key, mean, line)
      return o ? { win: o.lose, push: o.push, lose: o.win } : null
    }
  }
}

/** Keep the environment adjustment inside believable bounds. */
const clampRatio = (r) => Math.max(0.65, Math.min(1.45, r))

/**
 * Which markets a player can actually be projected for.
 *
 * Real season data wins when it exists. Otherwise a market is still offered
 * if a positional average exists for this role — synthetic, and flagged as
 * such by projectVolume, but a rough number beats none. A player whose role
 * carries no prior at all for a given stat (e.g. a WR's passing yards) still
 * gets nothing invented for it.
 */
export function availableMarkets(player) {
  const base = player.position === 'FB' ? 'RB' : player.position
  return VOLUME_MARKETS.filter((m) => {
    if (!m.positions.includes(base)) return false
    const hasReal = (player.stats?.[m.stat] ?? 0) > 0 && (player.stats?.games ?? 0) > 0
    const hasPrior = (VOLUME_PRIORS[player.role]?.[m.stat] ?? 0) > 0
    return hasReal || hasPrior
  })
}

/* ---------- First quarter ---------- */

/**
 * Share of a game's points scored in the first quarter.
 *
 * Scoring builds through a game: opening drives are scripted and defences
 * are fresh, and the fourth quarter carries catch-up scoring and two-minute
 * drills. Roughly a fifth of the game's points land in the first quarter.
 */
export const FIRST_QUARTER_SHARE = 0.20

/**
 * First-quarter team and game totals.
 *
 * Only team-level markets are offered here. First-quarter PLAYER props need
 * drive-level and snap-level data this app does not have — projecting them
 * from a full-game rate would assume usage is spread evenly through a game,
 * and it is not.
 */
export function projectFirstQuarter(homePoints, awayPoints) {
  const home = homePoints * FIRST_QUARTER_SHARE
  const away = awayPoints * FIRST_QUARTER_SHARE

  const homeDist = quarterPointsDistribution(home)
  const awayDist = quarterPointsDistribution(away)
  const totalDist = convolve(homeDist, awayDist)

  return {
    homeMean: round1(home),
    awayMean: round1(away),
    totalMean: round1(home + away),
    homeDist,
    awayDist,
    totalDist,
    overTotal: (line) => tailAbove(totalDist, line),
    pushTotal: (line) => (Number.isInteger(line) ? (totalDist[line] ?? 0) : 0),
    homeOver: (line) => tailAbove(homeDist, line),
    awayOver: (line) => tailAbove(awayDist, line)
  }
}

/**
 * Distribution over a team's first-quarter points.
 *
 * A first quarter is not a smooth curve. It is overwhelmingly 0, then 7,
 * then 3, and the gaps between are genuinely unreachable — no team scores
 * exactly 1, 2, 4 or 5 points in a quarter. Treating it as continuous
 * returned identical probabilities for a 6.5 and a 9.5 line, which is
 * useless for pricing.
 *
 * So scoring events are Poisson, each event is a touchdown or a field goal,
 * and the possible totals are built by combining them.
 */
export const TOUCHDOWN_FRACTION = 0.58   // of scoring events, not of points

export function quarterPointsDistribution(expectedPoints, maxScores = 4) {
  // Average points per scoring event, from the touchdown/field-goal mix.
  const perScore = TOUCHDOWN_FRACTION * 6.95 + (1 - TOUCHDOWN_FRACTION) * 3
  const lambda = Math.max(0, expectedPoints / perScore)

  const dist = {}
  for (let scores = 0; scores <= maxScores; scores++) {
    const pScores = poissonPmf(scores, lambda)
    if (pScores < 1e-9) continue
    // Within `scores` events, how many were touchdowns.
    for (let tds = 0; tds <= scores; tds++) {
      const pMix = binomialPmf(tds, scores, TOUCHDOWN_FRACTION)
      const points = Math.round(tds * 6.95 + (scores - tds) * 3)
      dist[points] = (dist[points] ?? 0) + pScores * pMix
    }
  }
  return dist
}

function binomialPmf(k, n, p) {
  if (k < 0 || k > n) return 0
  let logC = 0
  for (let i = 1; i <= k; i++) logC += Math.log((n - k + i) / i)
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p))
}

/** Distribution of the sum of two independent point totals. */
function convolve(a, b) {
  const out = {}
  for (const [x, px] of Object.entries(a)) {
    for (const [y, py] of Object.entries(b)) {
      const s = Number(x) + Number(y)
      out[s] = (out[s] ?? 0) + px * py
    }
  }
  return out
}

/** P(total > line) over a discrete distribution. */
function tailAbove(dist, line) {
  let p = 0
  for (const [points, prob] of Object.entries(dist)) {
    if (Number(points) > line) p += prob
  }
  return Math.min(1, Math.max(0, p))
}

const round1 = (v) => Math.round(v * 10) / 10
const round2 = (v) => Math.round(v * 100) / 100
const round3 = (v) => Math.round(v * 1000) / 1000
