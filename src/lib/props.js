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

const round2 = (v) => Math.round(v * 100) / 100
const round3 = (v) => Math.round(v * 1000) / 1000
