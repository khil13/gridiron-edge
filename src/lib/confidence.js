/**
 * confidence.js — an honest read on how much to trust one game's
 * projection, built from real signals already computed elsewhere rather
 * than a new invented score.
 *
 * Deliberately NOT "how far the model is from the market" — a projection
 * that disagrees with the market by a lot is not more trustworthy for
 * disagreeing harder; card.js's IMPLAUSIBLE_EV flag already exists
 * specifically to catch that shape of false confidence, and nothing here
 * should erode it.
 *
 * What actually goes into this:
 *   - model agreement (modelAgreement.js) — two genuinely independent
 *     methods landing close together is real signal, far apart is real
 *     doubt
 *   - sample size — ratings.js already flags a team's ppg/papg as
 *     `synthetic` when fewer than 8 real games back them; reused here
 *     rather than re-deriving a second games-played threshold
 *   - simulation vs. the closed-form Normal approximation (simulation.js)
 *     — real disagreement there means this particular matchup's scoring
 *     shape genuinely isn't a clean bell curve, which is exactly the kind
 *     of situation a single point estimate hides
 *   - preseason, where the model already shrinks its own output because
 *     it knows the rosters aren't real yet
 */

const LEVELS = ['low', 'medium', 'high']

function downgrade(level, steps = 1) {
  const i = Math.max(0, LEVELS.indexOf(level) - steps)
  return LEVELS[i]
}

/**
 * @param {object} opts
 * @param {object} opts.game             the dataset game (for .home/.away/.preseason)
 * @param {object|null} opts.epaProjection
 * @param {object|null} opts.modelAgreement
 * @param {object|null} opts.simulation
 * @param {object} opts.ratings          data.ratings, for each team's `synthetic` flag
 * @returns {{ level: 'high'|'medium'|'low', factors: string[] }}
 */
export function confidenceFor({ game, epaProjection, modelAgreement, simulation, ratings }) {
  const factors = []
  let level = 'high'

  if (game?.preseason) {
    return {
      level: 'low',
      factors: ['Preseason: rosters and depth charts are not real yet, and the model already shrinks its own output to say so.']
    }
  }

  const home = ratings?.[game?.home]
  const away = ratings?.[game?.away]
  const thinHome = home?.synthetic?.length > 0
  const thinAway = away?.synthetic?.length > 0
  if (thinHome || thinAway) {
    const which = thinHome && thinAway ? `${game.home} and ${game.away} are` : `${thinHome ? game.home : game.away} is`
    factors.push(`${which} still mostly on last season's scoring rate — too few real games played this season yet.`)
    level = downgrade(level)
  }

  if (!epaProjection) {
    factors.push('Only one projection method available for this game — nothing real to cross-check it against yet.')
    level = 'low'
  } else if (modelAgreement) {
    factors.push(`The power-rating and EPA models are ${modelAgreement.disagreementPoints.toFixed(1)} points apart.`)
    if (modelAgreement.agreement === 'low') level = downgrade(level, 2)
    else if (modelAgreement.agreement === 'medium') level = downgrade(level, 1)
  }

  if (simulation?.analyticalWinProb != null) {
    const gap = Math.abs(simulation.homeWinProb - simulation.analyticalWinProb)
    if (gap >= 0.05) {
      factors.push(
        `The simulation and the formula-based estimate differ by ${Math.round(gap * 100)} points of win probability — this matchup's scoring shape isn't a clean bell curve.`
      )
      level = downgrade(level)
    }
  }

  if (!factors.length) factors.push('Both models agree closely, both teams have a real season sample, and the simulation matches the formula.')

  return { level, factors }
}
