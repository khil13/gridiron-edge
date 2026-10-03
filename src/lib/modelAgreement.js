/**
 * modelAgreement.js — comparing two genuinely independent projections.
 *
 * model.js's Elo model and epaModel.js's EPA model share almost no inputs:
 * one is built entirely from who-beat-whom-by-how-much, the other entirely
 * from real per-play efficiency data. Where they land on nearly the same
 * number, that is two different angles on the game agreeing — a real
 * signal. Where they diverge, that is genuine uncertainty, not noise to be
 * blended away.
 *
 * The consensus below is a plain average, not a fitted ensemble weight —
 * forcing agreement with a tuned blend would hide exactly the disagreement
 * this module exists to surface. See confidence.js for how disagreement
 * feeds into an honest confidence read.
 */

import { winProbFromMargin } from './odds.js'

/**
 * A disagreement of a field goal or less between two independently-built
 * models is unremarkable; the categories below exist to say plainly when
 * it's bigger than that, not to manufacture false precision.
 */
export function agreementLevel(disagreementPoints) {
  if (disagreementPoints == null) return 'unknown'
  if (disagreementPoints < 2.5) return 'high'
  if (disagreementPoints < 6) return 'medium'
  return 'low'
}

/**
 * @param {{margin:number, homeWinProb:number}|null} elo   model.js's projection
 * @param {{margin:number, homeWinProb:number}|null} epa   epaModel.js's projection
 * @param {object} settings  only marginSigma is used, to restate the
 *                           consensus margin as a win probability the same
 *                           way each individual model does
 * @returns {object|null} null when only one (or neither) model has a real
 *                         projection for this game — there is nothing to
 *                         compare, and showing a single model's number
 *                         dressed up as a "consensus" would overstate it
 */
export function combineProjections(elo, epa, settings = {}) {
  if (!elo || !epa) return null

  const disagreementPoints = Math.round(Math.abs(elo.margin - epa.margin) * 10) / 10
  const consensusMargin = (elo.margin + epa.margin) / 2
  const sigma = settings.marginSigma ?? 13.2
  const consensusWinProb = winProbFromMargin(consensusMargin, sigma)

  return {
    models: {
      elo: { margin: round1(elo.margin), homeWinProb: elo.homeWinProb },
      epa: { margin: round1(epa.margin), homeWinProb: epa.homeWinProb }
    },
    consensusMargin: round1(consensusMargin),
    consensusWinProb,
    disagreementPoints,
    agreement: agreementLevel(disagreementPoints)
  }
}

const round1 = (n) => Math.round(n * 10) / 10
