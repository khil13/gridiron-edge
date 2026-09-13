/**
 * espn-proxy.js — un-blocks ESPN's per-athlete stats feed for the browser.
 *
 * `/athletes/{id}/stats` has real per-player season data (see
 * src/data/providers/playerData.js's statsForSeason(), whose parser is
 * verified against it) but refuses cross-origin fetch() calls with no
 * Access-Control-Allow-Origin header — confirmed live, a static policy on
 * ESPN's side, not something a browser can work around. This worker makes
 * the same request server-side, where that policy does not apply, and
 * re-serves the response with the header the browser needs.
 *
 * It only ever proxies this one path shape. It is not a general-purpose
 * relay: an open proxy that forwards arbitrary URLs is a much bigger
 * liability (abuse, SSRF) for no benefit this app actually needs.
 *
 * Deploy with Wrangler — see README.md in this directory. Once deployed,
 * paste the worker's URL into Model Lab's "Stats proxy" field.
 */

const HOSTS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl',
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
]

const ATHLETE_STATS = /^\/athletes\/(\d+)\/stats\/?$/

// ESPN returns 403 to a request with no User-Agent — confirmed live, a
// Cloudflare Worker's default outbound fetch sends none. This is not
// working around a login wall or a paywall: the feed is the same public,
// unauthenticated data a browser gets for free, just gated on looking like
// one. A real browser's User-Agent is enough; nothing else about the
// request needs to change.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json'
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin'
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: cors })
    }

    const url = new URL(request.url)
    const match = url.pathname.match(ATHLETE_STATS)
    if (!match) {
      return new Response('Not found. Expected /athletes/{id}/stats', { status: 404, headers: cors })
    }
    const athleteId = match[1]

    let upstream = null
    let lastStatus = null
    for (const host of HOSTS) {
      try {
        const res = await fetch(`${host}/athletes/${athleteId}/stats`, {
          headers: BROWSER_HEADERS,
          // Cloudflare's edge cache. A player's season stats change at most
          // once a week, so an hour of caching cuts repeat load on ESPN's
          // feed (and on this worker's own request quota) without ever
          // serving stale-within-the-same-game-week data.
          cf: { cacheTtl: 3600, cacheEverything: true }
        })
        lastStatus = res.status
        if (res.ok) { upstream = res; break }
      } catch {
        // Try the next host before giving up.
      }
    }

    if (!upstream) {
      return new Response(`ESPN returned ${lastStatus ?? 'no response'}`, { status: 502, headers: cors })
    }

    const body = await upstream.text()
    return new Response(body, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    })
  }
}
