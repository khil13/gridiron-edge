/**
 * 2026 preseason schedule. Kickoff times are UTC; the UI localises them.
 * `week: 0` is the Hall of Fame Game.
 */

export const PRESEASON_2026 = [
  { id: 'hof-ari-car', week: 0, label: 'Hall of Fame Game', kickoff: '2026-08-07T00:00:00Z', home: 'ARI', away: 'CAR', status: 'final', homeScore: 30, awayScore: 33, venue: 'Tom Benson Hall of Fame Stadium', neutral: true },

  { id: 'p1-cin-det', week: 1, kickoff: '2026-08-13T23:00:00Z', home: 'CIN', away: 'DET', status: 'scheduled', venue: 'Paycor Stadium' },
  { id: 'p1-pit-gb',  week: 1, kickoff: '2026-08-13T23:00:00Z', home: 'PIT', away: 'GB',  status: 'scheduled', venue: 'Acrisure Stadium' },
  { id: 'p1-ne-ind',  week: 1, kickoff: '2026-08-13T23:30:00Z', home: 'NE',  away: 'IND', status: 'scheduled', venue: 'Gillette Stadium' },
  { id: 'p1-lv-ari',  week: 1, kickoff: '2026-08-14T00:00:00Z', home: 'LV',  away: 'ARI', status: 'scheduled', venue: 'Allegiant Stadium' },
  { id: 'p1-hou-lac', week: 1, kickoff: '2026-08-14T00:00:00Z', home: 'HOU', away: 'LAC', status: 'scheduled', venue: 'NRG Stadium' },
  { id: 'p1-sf-ten',  week: 1, kickoff: '2026-08-14T01:00:00Z', home: 'SF',  away: 'TEN', status: 'scheduled', venue: "Levi's Stadium" },
  { id: 'p1-was-mia', week: 1, kickoff: '2026-08-14T23:00:00Z', home: 'WAS', away: 'MIA', status: 'scheduled', venue: 'Northwest Stadium' },
  { id: 'p1-nyj-tb',  week: 1, kickoff: '2026-08-14T23:00:00Z', home: 'NYJ', away: 'TB',  status: 'scheduled', venue: 'MetLife Stadium' },
  { id: 'p1-atl-den', week: 1, kickoff: '2026-08-14T23:00:00Z', home: 'ATL', away: 'DEN', status: 'scheduled', venue: 'Mercedes-Benz Stadium' },
  { id: 'p1-chi-cle', week: 1, kickoff: '2026-08-15T17:00:00Z', home: 'CHI', away: 'CLE', status: 'scheduled', venue: 'Soldier Field' },
  { id: 'p1-nyg-min', week: 1, kickoff: '2026-08-15T17:00:00Z', home: 'NYG', away: 'MIN', status: 'scheduled', venue: 'MetLife Stadium' },
  { id: 'p1-buf-car', week: 1, kickoff: '2026-08-15T17:00:00Z', home: 'BUF', away: 'CAR', status: 'scheduled', venue: 'Highmark Stadium' },
  { id: 'p1-no-jac',  week: 1, kickoff: '2026-08-15T20:00:00Z', home: 'NO',  away: 'JAC', status: 'scheduled', venue: 'Caesars Superdome' },
  { id: 'p1-kc-la',   week: 1, kickoff: '2026-08-15T20:00:00Z', home: 'KC',  away: 'LA',  status: 'scheduled', venue: 'GEHA Field at Arrowhead' },
  { id: 'p1-bal-phi', week: 1, kickoff: '2026-08-15T23:00:00Z', home: 'BAL', away: 'PHI', status: 'scheduled', venue: 'M&T Bank Stadium' },
  { id: 'p1-sea-dal', week: 1, kickoff: '2026-08-16T00:00:00Z', home: 'SEA', away: 'DAL', status: 'scheduled', venue: 'Lumen Field' }
]

export const SPORTSBOOKS = [
  { key: 'dk',   name: 'DraftKings' },
  { key: 'fd',   name: 'FanDuel' },
  { key: 'mgm',  name: 'BetMGM' },
  { key: 'czr',  name: 'Caesars' },
  { key: 'circa',name: 'Circa' },
  { key: 'pin',  name: 'Pinnacle' }
]
