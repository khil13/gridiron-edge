import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

/**
 * Every scheduled data-refresh job under scripts/ (fetch-player-stats.mjs,
 * fetch-injury-report.mjs, ...) runs via plain `node scripts/*.mjs` in CI —
 * not through Vite, which is lenient about a bare `import x from './y.json'`
 * with no import attribute. Plain Node is not: it throws
 * ERR_IMPORT_ATTRIBUTE_MISSING at import time, before any of the script's
 * own code runs.
 *
 * This broke silently for about four weeks (confirmed live: the
 * update-player-stats and update-injury-report GitHub Actions workflows
 * both failed on every scheduled run from the day props.js started
 * importing teamDefense.js until this test was added) because every test
 * in this repo runs under Vitest, which shares Vite's leniency — the whole
 * suite stayed green while the actual cron jobs were broken. Running the
 * real module graph through a real `node` subprocess, with no Vite in the
 * path, is the only way this test suite can catch that again.
 */
describe('scripts/*.mjs run under plain node, not just Vite', () => {
  it('imports the shared lib/props.js graph (teamDefense.js -> team-defense.json) without a bare-JSON-import error', () => {
    const result = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "import('./src/lib/props.js').then(() => process.stdout.write('ok'))"],
      { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }
    )
    expect(result).toBe('ok')
  })
})
