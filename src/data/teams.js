/**
 * The 32 franchises. Abbreviations follow the feed convention (JAC, LA, WAS);
 * `logo` maps to ESPN's public CDN slug, which differs for three clubs.
 */

const T = (abbr, location, name, conf, div, primary, secondary, logo) => ({
  abbr, location, name, conference: conf, division: div,
  full: `${location} ${name}`, primary, secondary,
  logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${logo || abbr.toLowerCase()}.png`
})

export const TEAMS = {
  ARI: T('ARI', 'Arizona', 'Cardinals', 'NFC', 'West', '#97233F', '#FFB612'),
  ATL: T('ATL', 'Atlanta', 'Falcons', 'NFC', 'South', '#A71930', '#000000'),
  BAL: T('BAL', 'Baltimore', 'Ravens', 'AFC', 'North', '#241773', '#9E7C0C'),
  BUF: T('BUF', 'Buffalo', 'Bills', 'AFC', 'East', '#00338D', '#C60C30'),
  CAR: T('CAR', 'Carolina', 'Panthers', 'NFC', 'South', '#0085CA', '#101820'),
  CHI: T('CHI', 'Chicago', 'Bears', 'NFC', 'North', '#0B162A', '#C83803'),
  CIN: T('CIN', 'Cincinnati', 'Bengals', 'AFC', 'North', '#FB4F14', '#000000'),
  CLE: T('CLE', 'Cleveland', 'Browns', 'AFC', 'North', '#311D00', '#FF3C00'),
  DAL: T('DAL', 'Dallas', 'Cowboys', 'NFC', 'East', '#041E42', '#869397'),
  DEN: T('DEN', 'Denver', 'Broncos', 'AFC', 'West', '#FB4F14', '#002244'),
  DET: T('DET', 'Detroit', 'Lions', 'NFC', 'North', '#0076B6', '#B0B7BC'),
  GB:  T('GB',  'Green Bay', 'Packers', 'NFC', 'North', '#203731', '#FFB612'),
  HOU: T('HOU', 'Houston', 'Texans', 'AFC', 'South', '#03202F', '#A71930'),
  IND: T('IND', 'Indianapolis', 'Colts', 'AFC', 'South', '#002C5F', '#A2AAAD'),
  JAC: T('JAC', 'Jacksonville', 'Jaguars', 'AFC', 'South', '#006778', '#D7A22A', 'jax'),
  KC:  T('KC',  'Kansas City', 'Chiefs', 'AFC', 'West', '#E31837', '#FFB81C'),
  LV:  T('LV',  'Las Vegas', 'Raiders', 'AFC', 'West', '#000000', '#A5ACAF'),
  LAC: T('LAC', 'Los Angeles', 'Chargers', 'AFC', 'West', '#0080C6', '#FFC20E'),
  LA:  T('LA',  'Los Angeles', 'Rams', 'NFC', 'West', '#003594', '#FFA300', 'lar'),
  MIA: T('MIA', 'Miami', 'Dolphins', 'AFC', 'East', '#008E97', '#FC4C02'),
  MIN: T('MIN', 'Minnesota', 'Vikings', 'NFC', 'North', '#4F2683', '#FFC62F'),
  NE:  T('NE',  'New England', 'Patriots', 'AFC', 'East', '#002244', '#C60C30'),
  NO:  T('NO',  'New Orleans', 'Saints', 'NFC', 'South', '#D3BC8D', '#101820'),
  NYG: T('NYG', 'New York', 'Giants', 'NFC', 'East', '#0B2265', '#A71930'),
  NYJ: T('NYJ', 'New York', 'Jets', 'AFC', 'East', '#125740', '#000000'),
  PHI: T('PHI', 'Philadelphia', 'Eagles', 'NFC', 'East', '#004C54', '#A5ACAF'),
  PIT: T('PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North', '#FFB612', '#101820'),
  SF:  T('SF',  'San Francisco', '49ers', 'NFC', 'West', '#AA0000', '#B3995D'),
  SEA: T('SEA', 'Seattle', 'Seahawks', 'NFC', 'West', '#002244', '#69BE28'),
  TB:  T('TB',  'Tampa Bay', 'Buccaneers', 'NFC', 'South', '#D50A0A', '#FF7900'),
  TEN: T('TEN', 'Tennessee', 'Titans', 'AFC', 'South', '#0C2340', '#4B92DB'),
  WAS: T('WAS', 'Washington', 'Commanders', 'NFC', 'East', '#5A1414', '#FFB612', 'wsh')
}

export const TEAM_LIST = Object.values(TEAMS)
export const getTeam = (abbr) =>
  TEAMS[abbr] || { abbr, full: abbr, location: '', name: abbr, primary: '#33434F', secondary: '#7F8D9A', logo: '' }

export const DIVISIONS = ['East', 'North', 'South', 'West']
export const CONFERENCES = ['AFC', 'NFC']
