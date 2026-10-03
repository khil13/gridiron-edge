/**
 * injuries.js — a real, bounded projection adjustment when a team's
 * starting quarterback is ruled out.
 *
 * scripts/fetch-injury-report.mjs bundles the NFL's own official weekly
 * injury report (via nflverse) — real Out/Doubtful/Questionable
 * designations, not estimated — and, at build time, cross-checks every
 * QB marked Out against real season passing volume (the same bundled
 * nflverse player-stats data used everywhere else in the app) so a
 * third-string QB who has barely played doesn't count as "the starter."
 * That cross-check already produced `injuryReport.starterQbOut`, so
 * nothing here needs the (much larger) player-stats file at runtime.
 *
 * The adjustment itself is a single, modest, fixed point value, not a
 * player-specific one — this app has no real per-QB value model (that
 * would need real starter-vs-backup scoring data this app does not have),
 * so it does not pretend a star QB's injury and a replacement-level
 * starter's injury are worth different, precisely-computed amounts. 3
 * points is a deliberately conservative estimate within the range
 * sportsbook lines commonly move for a starting-QB change; it is stated
 * here, not hidden in a fitted constant, so it can be argued with.
 */

import { winProbFromMargin } from './odds.js'

export const QB_OUT_POINTS = 3

/** @returns {{name: string, injury: string|null}|null} */
export function starterQbOut(team, injuryReport) {
  return injuryReport?.starterQbOut?.[team] ?? null
}

/**
 * Re-derive a projection's margin, win probabilities and team totals
 * around a starting-QB-out shift. Returns the same shape useDataset.js's
 * own preseason-shrink step already produces (base fields plus the ones
 * that move), so callers that already read `projection.margin` etc. don't
 * need to change.
 *
 * @param {object} game             { home, away }
 * @param {object|null} projection  projectGame()'s output (or already preseason-shrunk)
 * @param {object} injuryReport     generated/injury-report.json
 * @param {object} s                settings — only marginSigma is used
 */
export function applyInjuryAdjustment(game, projection, injuryReport, s) {
  if (!projection) return projection

  const homeOut = starterQbOut(game.home, injuryReport)
  const awayOut = starterQbOut(game.away, injuryReport)
  const qbOut = { home: homeOut, away: awayOut }

  if (!homeOut && !awayOut) return { ...projection, qbOut }

  const shift = (awayOut ? QB_OUT_POINTS : 0) - (homeOut ? QB_OUT_POINTS : 0)
  const margin = projection.margin + shift
  const homeWinProb = winProbFromMargin(margin, s?.marginSigma ?? 13.2)
  const homeTeamTotal = Math.round(((projection.total + margin) / 2) * 2) / 2
  const awayTeamTotal = Math.round(((projection.total - margin) / 2) * 2) / 2

  return {
    ...projection,
    margin,
    modelSpreadHome: -margin,
    modelSpreadAway: margin,
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    homeTeamTotal,
    awayTeamTotal,
    qbOut
  }
}
