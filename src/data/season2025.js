/**
 * Real results from the 2025 NFL season, as of the 2026 offseason.
 * Final regular-season records, the full playoff bracket, and Super Bowl LX.
 */

export const SEASON_2025 = {
  season: 2025,
  champion: 'SEA',
  runnerUp: 'NE',
  standings: [
    // AFC East
    { abbr: 'NE',  w: 14, l: 3, seed: 2,  result: 'Lost Super Bowl LX' },
    { abbr: 'BUF', w: 12, l: 5, seed: 6,  result: 'Lost Divisional' },
    { abbr: 'MIA', w: 7,  l: 10, seed: null, result: 'Missed playoffs' },
    { abbr: 'NYJ', w: 3,  l: 14, seed: null, result: 'Missed playoffs' },
    // AFC North
    { abbr: 'PIT', w: 10, l: 7, seed: 4,  result: 'Lost Wild Card' },
    { abbr: 'BAL', w: 8,  l: 9, seed: null, result: 'Missed playoffs' },
    { abbr: 'CIN', w: 6,  l: 11, seed: null, result: 'Missed playoffs' },
    { abbr: 'CLE', w: 5,  l: 12, seed: null, result: 'Missed playoffs' },
    // AFC South
    { abbr: 'JAC', w: 13, l: 4, seed: 3,  result: 'Lost Wild Card' },
    { abbr: 'HOU', w: 12, l: 5, seed: 5,  result: 'Lost Divisional' },
    { abbr: 'IND', w: 8,  l: 9, seed: null, result: 'Missed playoffs' },
    { abbr: 'TEN', w: 3,  l: 14, seed: null, result: 'Missed playoffs' },
    // AFC West
    { abbr: 'DEN', w: 14, l: 3, seed: 1,  result: 'Lost AFC Championship' },
    { abbr: 'LAC', w: 11, l: 6, seed: 7,  result: 'Lost Wild Card' },
    { abbr: 'KC',  w: 6,  l: 11, seed: null, result: 'Missed playoffs' },
    { abbr: 'LV',  w: 3,  l: 14, seed: null, result: 'Missed playoffs' },
    // NFC East
    { abbr: 'PHI', w: 11, l: 6, seed: 3,  result: 'Lost Wild Card' },
    { abbr: 'DAL', w: 7,  l: 9, seed: null, result: 'Missed playoffs' },
    { abbr: 'WAS', w: 5,  l: 12, seed: null, result: 'Missed playoffs' },
    { abbr: 'NYG', w: 4,  l: 13, seed: null, result: 'Missed playoffs' },
    // NFC North
    { abbr: 'CHI', w: 11, l: 6, seed: 2,  result: 'Lost Divisional' },
    { abbr: 'GB',  w: 9,  l: 7, seed: 7,  result: 'Lost Wild Card' },
    { abbr: 'MIN', w: 9,  l: 8, seed: null, result: 'Missed playoffs' },
    { abbr: 'DET', w: 9,  l: 8, seed: null, result: 'Missed playoffs' },
    // NFC South
    { abbr: 'CAR', w: 8,  l: 9, seed: 4,  result: 'Lost Wild Card' },
    { abbr: 'TB',  w: 8,  l: 9, seed: null, result: 'Missed playoffs' },
    { abbr: 'ATL', w: 8,  l: 9, seed: null, result: 'Missed playoffs' },
    { abbr: 'NO',  w: 6,  l: 11, seed: null, result: 'Missed playoffs' },
    // NFC West
    { abbr: 'SEA', w: 14, l: 3, seed: 1,  result: 'Won Super Bowl LX' },
    { abbr: 'LA',  w: 12, l: 5, seed: 5,  result: 'Lost NFC Championship' },
    { abbr: 'SF',  w: 12, l: 5, seed: 6,  result: 'Lost Divisional' },
    { abbr: 'ARI', w: 3,  l: 14, seed: null, result: 'Missed playoffs' }
  ],
  /** Every postseason game, plus the Week 18 slate that set the bracket. */
  results: [
    { id: 'r18-chi-det', round: 'Week 18',  kickoff: '2026-01-04T21:25:00Z', home: 'CHI', away: 'DET', homeScore: 16, awayScore: 19 },
    { id: 'r18-phi-was', round: 'Week 18',  kickoff: '2026-01-04T21:25:00Z', home: 'PHI', away: 'WAS', homeScore: 17, awayScore: 24 },
    { id: 'r18-buf-nyj', round: 'Week 18',  kickoff: '2026-01-04T21:25:00Z', home: 'BUF', away: 'NYJ', homeScore: 35, awayScore: 8 },
    { id: 'r18-lv-kc',   round: 'Week 18',  kickoff: '2026-01-04T21:25:00Z', home: 'LV',  away: 'KC',  homeScore: 14, awayScore: 12 },
    { id: 'r18-den-lac', round: 'Week 18',  kickoff: '2026-01-04T21:25:00Z', home: 'DEN', away: 'LAC', homeScore: 19, awayScore: 3 },
    { id: 'r18-pit-bal', round: 'Week 18',  kickoff: '2026-01-05T01:20:00Z', home: 'PIT', away: 'BAL', homeScore: 26, awayScore: 24, title: 'Sunday Night Football' },

    { id: 'wc-car-la',   round: 'Wild Card', kickoff: '2026-01-10T21:30:00Z', home: 'CAR', away: 'LA',  homeScore: 31, awayScore: 34, title: 'NFC Wild Card' },
    { id: 'wc-chi-gb',   round: 'Wild Card', kickoff: '2026-01-11T01:00:00Z', home: 'CHI', away: 'GB',  homeScore: 31, awayScore: 27, title: 'NFC Wild Card' },
    { id: 'wc-jac-buf',  round: 'Wild Card', kickoff: '2026-01-11T18:00:00Z', home: 'JAC', away: 'BUF', homeScore: 24, awayScore: 27, title: 'AFC Wild Card' },
    { id: 'wc-phi-sf',   round: 'Wild Card', kickoff: '2026-01-11T21:30:00Z', home: 'PHI', away: 'SF',  homeScore: 19, awayScore: 23, title: 'NFC Wild Card' },
    { id: 'wc-ne-lac',   round: 'Wild Card', kickoff: '2026-01-12T01:15:00Z', home: 'NE',  away: 'LAC', homeScore: 16, awayScore: 3,  title: 'AFC Wild Card' },
    { id: 'wc-pit-hou',  round: 'Wild Card', kickoff: '2026-01-13T01:15:00Z', home: 'PIT', away: 'HOU', homeScore: 6,  awayScore: 30, title: 'AFC Wild Card' },

    { id: 'dv-den-buf',  round: 'Divisional', kickoff: '2026-01-17T21:30:00Z', home: 'DEN', away: 'BUF', homeScore: 33, awayScore: 30, title: 'AFC Divisional' },
    { id: 'dv-sea-sf',   round: 'Divisional', kickoff: '2026-01-18T01:00:00Z', home: 'SEA', away: 'SF',  homeScore: 41, awayScore: 6,  title: 'NFC Divisional' },
    { id: 'dv-ne-hou',   round: 'Divisional', kickoff: '2026-01-18T20:00:00Z', home: 'NE',  away: 'HOU', homeScore: 28, awayScore: 16, title: 'AFC Divisional' },
    { id: 'dv-chi-la',   round: 'Divisional', kickoff: '2026-01-18T23:30:00Z', home: 'CHI', away: 'LA',  homeScore: 17, awayScore: 20, title: 'NFC Divisional' },

    { id: 'cc-den-ne',   round: 'Conference', kickoff: '2026-01-25T20:00:00Z', home: 'DEN', away: 'NE',  homeScore: 7,  awayScore: 10, title: 'AFC Championship' },
    { id: 'cc-sea-la',   round: 'Conference', kickoff: '2026-01-25T23:30:00Z', home: 'SEA', away: 'LA',  homeScore: 31, awayScore: 27, title: 'NFC Championship' },

    { id: 'sb-ne-sea',   round: 'Super Bowl', kickoff: '2026-02-08T23:30:00Z', home: 'NE',  away: 'SEA', homeScore: 13, awayScore: 29, title: 'Super Bowl LX', neutral: true }
  ]
}

export const recordOf = (abbr) => SEASON_2025.standings.find((s) => s.abbr === abbr)
