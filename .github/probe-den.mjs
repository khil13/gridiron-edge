// One-off diagnostic: fetch the exact same weekly ESPN data the app's
// fetchSeasonResults() uses, for the 2026 regular season, and dump every
// game involving DEN so we can see the raw truth behind the "Broncos 3-0
// vs real 2-1" discrepancy. Mirrors fetchWeek() in src/data/providers/espnProvider.js
// exactly (same endpoints, same parsing), without going through React/app state.

const ENDPOINTS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
]
const ABBR = { WSH: 'WAS', LAR: 'LA', JAX: 'JAC' }
const norm = (a) => ABBR[a] || a

async function fetchWeek(year, seasontype, week) {
  let lastError
  for (const base of ENDPOINTS) {
    try {
      const url = `${base}?dates=${year}&seasontype=${seasontype}&week=${week}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`returned ${res.status}`)
      const json = await res.json()
      return { url, raw: json, games: (json.events || []).map((event) => {
        const comp = event.competitions?.[0] || {}
        const home = comp.competitors?.find((c) => c.homeAway === 'home')
        const away = comp.competitors?.find((c) => c.homeAway === 'away')
        const state = event.status?.type?.state
        const h = Number(home?.score)
        const a = Number(away?.score)
        return {
          id: event.id,
          name: event.name,
          date: event.date,
          state,
          statusDetail: event.status?.type?.detail,
          home: norm(home?.team?.abbreviation),
          away: norm(away?.team?.abbreviation),
          homeScoreRaw: home?.score,
          awayScoreRaw: away?.score,
          homeScore: h,
          awayScore: a,
          countedAsRateable: state === 'post' && Number.isFinite(h) && Number.isFinite(a)
        }
      }) }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

async function main() {
  const year = 2026
  for (let week = 1; week <= 5; week++) {
    try {
      const { url, games } = await fetchWeek(year, 2, week)
      const denGames = games.filter((g) => g.home === 'DEN' || g.away === 'DEN')
      console.log(`\n=== Week ${week} (${url}) ===`)
      console.log(`Total events: ${games.length}`)
      if (denGames.length) {
        for (const g of denGames) {
          console.log(JSON.stringify(g, null, 2))
        }
      } else {
        console.log('No DEN game found this week.')
      }
    } catch (err) {
      console.log(`Week ${week}: FAILED (${err.message})`)
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
