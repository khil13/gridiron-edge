/** Line icons drawn on a 20px grid so they sit consistently in the rail. */

const base = {
  width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.5,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
}

export const IconScores = (p) => (
  <svg {...base} {...p}><rect x="2.5" y="4" width="15" height="12" rx="1.5" /><path d="M10 4v12M2.5 10h3M14.5 10h3" /></svg>
)
export const IconOdds = (p) => (
  <svg {...base} {...p}><path d="M3 16.5V9M7.7 16.5V4.5M12.3 16.5v-5M17 16.5V7" /></svg>
)
export const IconModel = (p) => (
  <svg {...base} {...p}><path d="M3 6h14M3 10h14M3 14h14" /><circle cx="7" cy="6" r="1.9" fill="currentColor" stroke="none" /><circle cx="13" cy="10" r="1.9" fill="currentColor" stroke="none" /><circle cx="9" cy="14" r="1.9" fill="currentColor" stroke="none" /></svg>
)
export const IconStandings = (p) => (
  <svg {...base} {...p}><path d="M3 5h14M3 10h10M3 15h6" /></svg>
)
export const IconTeams = (p) => (
  <svg {...base} {...p}><path d="M10 2.8l6 2.1v5.3c0 3.4-2.4 6.1-6 7.1-3.6-1-6-3.7-6-7.1V4.9l6-2.1z" /></svg>
)
export const IconSlip = (p) => (
  <svg {...base} {...p}><path d="M5 3h10v14l-2.5-1.6L10 17l-2.5-1.6L5 17V3z" /><path d="M8 7h4M8 10.5h4" /></svg>
)
export const IconCard = (p) => (
  <svg {...base} {...p}><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="M2.5 8.5h15M6 12h3" /></svg>
)
export const IconBack = (p) => (
  <svg {...base} {...p}><path d="M12 4l-6 6 6 6" /></svg>
)
