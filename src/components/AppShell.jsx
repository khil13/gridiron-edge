import { useStore } from '../lib/store.jsx'
import { href } from '../lib/router.js'
import TickerRail from './TickerRail.jsx'
import BetSlip from './BetSlip.jsx'
import { IconScores, IconOdds, IconModel, IconStandings, IconTeams, IconSlip } from './Icons.jsx'

const NAV = [
  { view: 'scores', label: 'Scores', Icon: IconScores },
  { view: 'odds', label: 'Odds', Icon: IconOdds },
  { view: 'model', label: 'Model', Icon: IconModel },
  { view: 'standings', label: 'Table', Icon: IconStandings },
  { view: 'teams', label: 'Teams', Icon: IconTeams }
]

export default function AppShell({ route, games, children, footNote }) {
  const { slip, dispatch } = useStore()
  const current = route.view === 'game' || route.view === 'team' ? null : route.view

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <a className="rail-mark" href={href('scores')} aria-label="Gridiron Edge home">GE</a>
        {NAV.map(({ view, label, Icon }) => (
          <a
            key={view}
            className="rail-link"
            href={href(view)}
            aria-current={current === view ? 'page' : undefined}
          >
            <Icon className="rail-glyph" />
            <span className="rail-label">{label}</span>
          </a>
        ))}
      </nav>

      <div className="main">
        <TickerRail games={games} />
        {children}
        <footer className="foot">
          <p style={{ marginTop: 0 }}>
            <strong style={{ color: 'var(--bone-dim)' }}>Gridiron Edge</strong> — an open-source NFL scores
            and market-analytics build. {footNote}
          </p>
          <p>
            Model output is an estimate, not advice. Nothing here places a wager or moves money.
            If betting has stopped being fun, the US national helpline is 1-800-522-4700.
          </p>
        </footer>
      </div>

      {slip.length > 0 && (
        <button className="slip-toggle" onClick={() => dispatch({ type: 'toggleSlip', open: true })}>
          <IconSlip width={16} height={16} />
          Slip · {slip.length}
        </button>
      )}
      <BetSlip />
    </div>
  )
}
