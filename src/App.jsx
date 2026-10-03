import { lazy, Suspense } from 'react'
import { useRoute } from './lib/router.js'
import { useDataset } from './lib/useDataset.js'
import AppShell from './components/AppShell.jsx'
import ScoresView from './views/ScoresView.jsx'
import { Empty } from './components/Controls.jsx'

// Scores is the landing page — nearly every visit hits it, so it stays in
// the main bundle. Everything else is a tap away at the earliest, so it is
// only fetched once a visitor actually asks for it: Model Lab's internals
// and the per-game props/model panels are real weight (projections,
// simulation, charts) that most visits never touch at all.
const GameView = lazy(() => import('./views/GameView.jsx'))
const CardView = lazy(() => import('./views/CardView.jsx'))
const OddsBoardView = lazy(() => import('./views/OddsBoardView.jsx'))
const TeamsView = lazy(() => import('./views/TeamsView.jsx'))
const TeamView = lazy(() => import('./views/TeamView.jsx'))
const ModelLabView = lazy(() => import('./views/ModelLabView.jsx'))

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
        <Suspense fallback={<div className="page"><Empty title="Loading">Pulling this page's own code.</Empty></div>}>
          <Router route={route} data={data} />
        </Suspense>
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
    case 'teams':
      return <TeamsView data={data} initialView={route.query?.view} />
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
