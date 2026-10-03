/**
 * freshness.js — how old each real, bundled data source actually is right
 * now, not just that it exists.
 *
 * Every generated file already carries its own real `generatedAt` from the
 * script that fetched it, but nothing in the app ever read it back out —
 * so a visitor had no way to tell a snapshot refreshed an hour ago from
 * one quietly stuck for a month (exactly the kind of silent failure a
 * scheduled GitHub Action can have without anyone noticing: a changed
 * nflverse file shape, a lapsed token, a renamed release). Each source
 * gets its own threshold from its own real refresh schedule (see each
 * source's fetch script/workflow) rather than one blanket number, because
 * a quiet injury report for a week means something different than a quiet
 * Next Gen Stats file, which nflverse itself only republishes on a slow,
 * season-behind cadence by design.
 */

import ratingsFile from '../data/generated/ratings.json'
import playerStatsMeta from '../data/generated/player-stats-meta.json'
import teamEfficiencyFile from '../data/generated/team-efficiency.json'
import teamDefenseFile from '../data/generated/team-defense.json'
import playerNgsFile from '../data/generated/player-ngs.json'
import injuryReportFile from '../data/generated/injury-report.json'

function entry(label, file, { expectedDays, note, extra } = {}) {
  const generatedAt = file?.generatedAt ?? null
  const ageDays = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 86400000 : null
  const level =
    ageDays == null ? 'unknown'
      : expectedDays == null ? 'ok'
        : ageDays <= expectedDays ? 'ok'
          : ageDays <= expectedDays * 2 ? 'aging'
            : 'stale'
  return { label, generatedAt, ageDays, level, note: note ?? null, extra: extra ?? null, source: file?.source ?? null }
}

/** One row per real data source this app ships with. */
export function dataSources() {
  return [
    entry('Power ratings (season opener)', ratingsFile, {
      note: 'Rebuilt once per offseason from the prior season’s final record — not expected to move in-season.'
    }),
    entry('Player season stats', playerStatsMeta, {
      expectedDays: 4, // scheduled Tue/Fri
      extra: playerStatsMeta.latestSeason ? `${playerStatsMeta.latestSeason} season` : null
    }),
    entry('Team efficiency (EPA, success rate)', teamEfficiencyFile, {
      expectedDays: 4, // scheduled Tue/Fri
      extra: teamEfficiencyFile.latestSeason ? `${teamEfficiencyFile.latestSeason} season` : null
    }),
    entry('Team defense allowed', teamDefenseFile, {
      expectedDays: 4, // same script/schedule as player season stats
      extra: teamDefenseFile.latestSeason ? `${teamDefenseFile.latestSeason} season` : null
    }),
    entry('Next Gen Stats', playerNgsFile, {
      expectedDays: 14, // nflverse's own slower publishing schedule, not this app's
      extra: playerNgsFile.latestSeason ? `${playerNgsFile.latestSeason} season` : null,
      note: 'Published on nflverse’s own slower schedule — often a season behind even when this snapshot is fresh.'
    }),
    entry('Injury report', injuryReportFile, {
      expectedDays: 3, // scheduled Wed/Thu/Fri/Sun
      extra: injuryReportFile.week ? `week ${injuryReportFile.week}` : null
    })
  ]
}
