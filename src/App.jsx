import { useRoute } from './lib/router.js'
import { useDataset } from './lib/useDataset.js'
import AppShell from './components/AppShell.jsx'
import ScoresView from './views/ScoresView.jsx'
import GameView from './views/GameView.jsx'
import CardView from './views/CardView.jsx'
import OddsBoardView from './views/OddsBoardView.jsx'
import StandingsView from './views/StandingsView.jsx'
import TeamsView from './views/TeamsView.jsx'
import TeamView from './views/TeamView.jsx'
import ModelLabView from './views/ModelLabView.jsx'
import { Empty } from './components/Controls.jsx'

export default function App() {
  const route = useRoute()
  const data = useDataset()

  const footNote = data.simulatedPrices
    ? 'Records, schedule and results are real; sportsbook prices in this build are simulated.'
    : 'Prices are live from your configured sportsbook feed.'

  return (
    <AppShell route={route} games={data.games} footNote={footNote}>
      {data.loading ? (
        <div className="page"><Empty title="Loading the slate">Pulling games, ratings and prices.</Empty></div>
      ) : (
        <Router route={route} data={data} />
      )}
    </AppShell>
  )
}

function Router({ route, data }) {
  switch (route.view) {
    case 'game': {
      const game = data.games.find((g) => g.id === route.param)
      return game ? <GameView game={game} data={data} /> : <NotFound what="game" />
    }
    case 'team': {
      return <TeamView abbr={route.param} data={data} />
    }
    case 'card':
      return <CardView data={data} />
    case 'odds':
      return <OddsBoardView data={data} />
    case 'standings':
      return <StandingsView data={data} />
    case 'teams':
      return <TeamsView data={data} />
    case 'model':
      return <ModelLabView data={data} />
    case 'scores':
    default:
      return <ScoresView data={data} />
  }
}

function NotFound({ what }) {
  return (
    <div className="page">
      <Empty title={`No such ${what}`}>
        That link points at something the current slate does not include. Head back to <a href="#/scores" style={{ color: 'var(--gold)' }}>Scores</a>.
      </Empty>
    </div>
  )
}
