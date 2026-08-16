/**
 * boxscore.js — turn ESPN's flat stat dump into something readable.
 *
 * The feed returns ~25 statistics in its own order with no grouping. Poured
 * straight into a table that is a wall of numbers, and on a phone it becomes
 * a wall of numbers you have to scroll sideways to read.
 *
 * So: group into the categories people actually think in, order them within
 * each group, and give every row a comparable number so the two teams can be
 * shown side by side with a bar instead of in separate columns.
 */

/** Curated order. Anything the feed sends that is not listed lands in Other. */
const GROUPS = [
  {
    title: 'Moving the ball',
    stats: ['totalYards', 'yardsPerPlay', 'totalPlays', 'firstDowns', 'totalDrives']
  },
  {
    title: 'Passing',
    stats: ['netPassingYards', 'completionAttempts', 'yardsPerPass', 'interceptions', 'sacksYardsLost']
  },
  {
    title: 'Rushing',
    stats: ['rushingYards', 'rushingAttempts', 'yardsPerRushAttempt']
  },
  {
    title: 'Converting',
    stats: ['thirdDownEff', 'fourthDownEff', 'redZoneAttempts', 'firstDownsPassing', 'firstDownsRushing', 'firstDownsPenalty']
  },
  {
    title: 'Keeping the ball',
    stats: ['possessionTime', 'turnovers', 'fumblesLost', 'interceptionsThrown']
  },
  {
    title: 'Discipline',
    stats: ['totalPenaltiesYards', 'defensiveTouchdowns']
  }
]

/**
 * Pull a comparable number out of a display string.
 *
 * ESPN mixes plain numbers ("274"), ratios ("4-11"), fractions ("17/30") and
 * clock values ("32:46") in the same list. A bar needs one number per side,
 * and comparing "4-11" to "7-13" as raw text is meaningless — what matters is
 * the rate. Returns null when nothing sensible can be derived, in which case
 * the row still renders, just without a bar.
 */
export function comparable(value, mode = 'auto') {
  if (value == null) return null
  const s = String(value).trim()
  // An em dash or blank means the feed has no value, which is not zero.
  if (!s || s === '—' || s === '-') return null

  // Clock: 32:46 -> seconds
  const clock = s.match(/^(\d+):(\d{2})$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])

  // Two numbers. Sometimes a rate (4-11 third downs, 17/30 passing) and
  // sometimes two unrelated counts (2-17 = two sacks for seventeen yards,
  // 5-45 = five penalties for forty-five). Reading the second kind as a
  // rate produces a comparison that means nothing, so callers can ask for
  // the leading count instead.
  const pair = s.match(/^(\d+)\s*[-/]\s*(\d+)$/)
  if (pair) {
    const first = Number(pair[1])
    const second = Number(pair[2])
    if (mode === 'first') return first
    return second > 0 ? first / second : first
  }

  // Plain number, possibly signed or decimal
  const cleaned = s.replace(/[^0-9.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

/** Pairs that are two separate counts rather than made-of-attempted. */
const COUNT_PAIRS = new Set(['sacksYardsLost', 'totalPenaltiesYards'])

/** Some stats are better when lower. Used only to colour the leader. */
const LOWER_IS_BETTER = new Set([
  'turnovers', 'interceptions', 'interceptionsThrown', 'fumblesLost',
  'sacksYardsLost', 'totalPenaltiesYards', 'defensiveTouchdowns'
])

/**
 * @param {{teams:string[], rows:Array}} teamStats  parsed feed output
 * @returns {Array<{title:string, rows:Array}>}
 */
export function groupTeamStats(teamStats) {
  if (!teamStats?.rows?.length) return []

  const byName = new Map(teamStats.rows.map((r) => [r.name, r]))
  const used = new Set()
  const out = []

  for (const group of GROUPS) {
    const rows = []
    for (const name of group.stats) {
      const row = byName.get(name)
      if (!row) continue
      used.add(name)
      rows.push(decorate(row))
    }
    if (rows.length) out.push({ title: group.title, rows })
  }

  // Never silently drop a stat the feed decided to send.
  const leftovers = teamStats.rows.filter((r) => !used.has(r.name)).map(decorate)
  if (leftovers.length) out.push({ title: 'Other', rows: leftovers })

  return out
}

function decorate(row) {
  const mode = COUNT_PAIRS.has(row.name) ? 'first' : 'auto'
  const nums = row.values.map((v) => comparable(v, mode))
  const [a, b] = nums
  const lowerBetter = LOWER_IS_BETTER.has(row.name)

  let leader = null
  if (a != null && b != null && a !== b) {
    const awayAhead = lowerBetter ? a < b : a > b
    leader = awayAhead ? 0 : 1
  }

  // Bar widths. Both zero, or non-numeric, means no bar.
  const total = (a ?? 0) + (b ?? 0)
  const share = a != null && b != null && total > 0
    ? [(a / total) * 100, (b / total) * 100]
    : null

  return { ...row, nums, share, leader, lowerBetter }
}
