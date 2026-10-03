/**
 * Primary home venues for all 32 franchises: coordinates (for travel
 * distance and weather) and roof type (for deciding whether weather is
 * even a factor). Two teams share a building in two metros (MetLife,
 * SoFi) — both listed, since each still "travels home" independently.
 *
 * Coordinates are the stadium's public location, stable facts rather than
 * anything derived — same category of static data as team colors in
 * teams.js. A neutral-site game (international series, the Hall of Fame
 * Game) is not any team's home venue, so callers must check the slate's
 * own `neutral` flag before using a team's listed venue as "where this
 * game is being played" — this file only answers "where does this team
 * normally play," not "where is this specific game."
 *
 * `roof`:
 *   'dome'        — always climate-controlled, weather is never a factor.
 *   'retractable' — closed or open at the home team's discretion, usually
 *                   to avoid bad weather; the forecast is still worth
 *                   showing since a cold/wet report is exactly the signal
 *                   that predicts a closed roof, but it is not guaranteed
 *                   to apply once the roof is actually shut on game day.
 *   'outdoor'     — always exposed.
 */
export const STADIUMS = {
  ARI: { venue: 'State Farm Stadium', lat: 33.5276, lon: -112.2626, roof: 'retractable' },
  ATL: { venue: 'Mercedes-Benz Stadium', lat: 33.7553, lon: -84.4006, roof: 'dome' },
  BAL: { venue: 'M&T Bank Stadium', lat: 39.2780, lon: -76.6227, roof: 'outdoor' },
  BUF: { venue: 'Highmark Stadium', lat: 42.7738, lon: -78.7870, roof: 'outdoor' },
  CAR: { venue: 'Bank of America Stadium', lat: 35.2258, lon: -80.8528, roof: 'outdoor' },
  CHI: { venue: 'Soldier Field', lat: 41.8623, lon: -87.6167, roof: 'outdoor' },
  CIN: { venue: 'Paycor Stadium', lat: 39.0954, lon: -84.5160, roof: 'outdoor' },
  CLE: { venue: 'Huntington Bank Field', lat: 41.5061, lon: -81.6995, roof: 'outdoor' },
  DAL: { venue: 'AT&T Stadium', lat: 32.7473, lon: -97.0945, roof: 'retractable' },
  DEN: { venue: 'Empower Field at Mile High', lat: 39.7439, lon: -105.0201, roof: 'outdoor' },
  DET: { venue: 'Ford Field', lat: 42.3400, lon: -83.0456, roof: 'dome' },
  GB: { venue: 'Lambeau Field', lat: 44.5013, lon: -88.0622, roof: 'outdoor' },
  HOU: { venue: 'NRG Stadium', lat: 29.6847, lon: -95.4107, roof: 'retractable' },
  IND: { venue: 'Lucas Oil Stadium', lat: 39.7601, lon: -86.1639, roof: 'retractable' },
  JAC: { venue: 'EverBank Stadium', lat: 30.3239, lon: -81.6373, roof: 'outdoor' },
  KC: { venue: 'GEHA Field at Arrowhead Stadium', lat: 39.0489, lon: -94.4839, roof: 'outdoor' },
  LV: { venue: 'Allegiant Stadium', lat: 36.0909, lon: -115.1833, roof: 'dome' },
  LAC: { venue: 'SoFi Stadium', lat: 33.9535, lon: -118.3392, roof: 'dome' },
  LA: { venue: 'SoFi Stadium', lat: 33.9535, lon: -118.3392, roof: 'dome' },
  MIA: { venue: 'Hard Rock Stadium', lat: 25.9580, lon: -80.2389, roof: 'outdoor' },
  MIN: { venue: 'U.S. Bank Stadium', lat: 44.9735, lon: -93.2575, roof: 'dome' },
  NE: { venue: 'Gillette Stadium', lat: 42.0909, lon: -71.2643, roof: 'outdoor' },
  NO: { venue: 'Caesars Superdome', lat: 29.9511, lon: -90.0812, roof: 'dome' },
  NYG: { venue: 'MetLife Stadium', lat: 40.8135, lon: -74.0745, roof: 'outdoor' },
  NYJ: { venue: 'MetLife Stadium', lat: 40.8135, lon: -74.0745, roof: 'outdoor' },
  PHI: { venue: 'Lincoln Financial Field', lat: 39.9008, lon: -75.1675, roof: 'outdoor' },
  PIT: { venue: 'Acrisure Stadium', lat: 40.4468, lon: -80.0158, roof: 'outdoor' },
  SF: { venue: "Levi's Stadium", lat: 37.4030, lon: -121.9700, roof: 'outdoor' },
  SEA: { venue: 'Lumen Field', lat: 47.5952, lon: -122.3316, roof: 'outdoor' },
  TB: { venue: 'Raymond James Stadium', lat: 27.9759, lon: -82.5033, roof: 'outdoor' },
  TEN: { venue: 'Nissan Stadium', lat: 36.1665, lon: -86.7713, roof: 'outdoor' },
  WAS: { venue: 'Northwest Stadium', lat: 38.9077, lon: -76.8645, roof: 'outdoor' }
}

export const stadiumFor = (abbr) => STADIUMS[abbr] ?? null

/**
 * Great-circle distance between two coordinates, in miles. Standard
 * haversine formula — exact for this purpose (travel distance rounded to
 * the nearest ten miles is not where any real precision is needed).
 */
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8 // Earth's mean radius, miles
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * How far the away team is travelling from its own home stadium to this
 * game. Returns null rather than a guess whenever the real location isn't
 * known — a neutral-site game (Hall of Fame Game, international series) is
 * not played at either team's listed venue, and this file has no source for
 * where it actually is, so inventing "zero" or a team's usual travel would
 * be worse than saying nothing.
 */
export function travelMilesFor(awayAbbr, homeAbbr, { neutral = false } = {}) {
  if (neutral) return null
  const away = stadiumFor(awayAbbr)
  const home = stadiumFor(homeAbbr)
  if (!away || !home) return null
  return Math.round(haversineMiles(away.lat, away.lon, home.lat, home.lon))
}
