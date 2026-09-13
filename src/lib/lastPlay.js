/**
 * Turns ESPN's free-text play description into just enough structure to draw
 * where the ball actually went — who had it, who (if anyone) it went to, and
 * how many yards it moved.
 *
 * ESPN's play text is not a stable schema, it is prose meant for a ticker.
 * Every pattern below matches the common, clearly-shaped cases (a complete
 * pass, a rush, a sack) and returns null for anything else — a scramble
 * worded oddly, a lateral, a penalty enforcement — rather than guess at a
 * shape that doesn't fit. A missing trajectory is honest; a wrong one isn't.
 */

const NAME = '[A-Za-z][\\w.\'-]*'

// "for 20 yards" / "for -8 yards" / "for no gain" / "for no yards" — the
// last two are the same thing worded two different ways by different feeds.
const FOR_YARDS = `for\\s+(?:(-?\\d+)\\s+yards?|no\\s+(?:gain|yards?))`

const PASS_RE = new RegExp(
  `^(${NAME})\\s+pass\\s+(?:(?:short|deep)\\s+)?(?:(?:left|right|middle)\\s+)?to\\s+(${NAME})` +
  `(?:\\s+to\\s+[A-Z]{2,3}\\s+\\d{1,2})?\\s+${FOR_YARDS}\\b`,
  'i'
)

// A direction/gap phrase — "right end", "up the middle", "left tackle" — on
// its own, with no "rush" verb at all, is how ESPN's real feed writes a lot
// of running plays ("A.Jeanty left end to LV 22 for -1 yards"). Requiring
// the word "rush" would silently miss those, so it's optional: either it
// says "rush(ed)" (with or without a direction after it), or it skips
// straight to the direction phrase.
const DIRECTION = '(?:(?:up\\s+)?(?:the\\s+)?(?:left|right|middle|end|guard|tackle))'
const RUSH_RE = new RegExp(
  `^(${NAME})\\s+(?:rush(?:ed)?\\b(?:\\s+${DIRECTION})*|${DIRECTION}(?:\\s+${DIRECTION})*)` +
  `(?:\\s+to\\s+[A-Z]{2,3}\\s+\\d{1,2})?\\s+${FOR_YARDS}\\b`,
  'i'
)

// A sack's loss is written either as a signed number ("for -8 yards") or as
// "a loss of 8 yards" — the second form needs the sign added back in code.
const SACK_RE = new RegExp(
  `^(${NAME})\\s+sacked\\b.*?for\\s+(?:(-?\\d+)\\s+yards?|a\\s+loss\\s+of\\s+(\\d+)\\s+yards?)`,
  'i'
)

/**
 * @returns {{ type: 'pass'|'rush'|'sack', yards: number, primary: string, secondary: string|null } | null}
 */
export function parseLastPlay(text) {
  const s = String(text ?? '').trim()
  if (!s) return null

  const pass = s.match(PASS_RE)
  if (pass) {
    return { type: 'pass', yards: pass[3] != null ? Number(pass[3]) : 0, primary: pass[1], secondary: pass[2] }
  }

  const rush = s.match(RUSH_RE)
  if (rush) {
    return { type: 'rush', yards: rush[2] != null ? Number(rush[2]) : 0, primary: rush[1], secondary: null }
  }

  const sack = s.match(SACK_RE)
  if (sack) {
    const yards = sack[2] != null ? Number(sack[2]) : -Number(sack[3])
    return { type: 'sack', yards, primary: sack[1], secondary: null }
  }

  return null
}
