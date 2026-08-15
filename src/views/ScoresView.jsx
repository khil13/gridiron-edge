import { useMemo, useState } from 'react'
import GameCard from '../components/GameCard.jsx'
import { Tabs, Empty, Badge } from '../components/Controls.jsx'
import { fmtDay, dayKey, relativeDay, fmtOdds } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * The front page. Games first, always — the analytics live one tap deeper.
 * The only thing promoted above the slate is the handful of plays where the
 * model and the market disagree most, because that is what this app is for.
 */
export default function ScoresView({ data }) {
  const [filter, setFilter] = useState('all')

  const counts = useMemo(() => ({
    all: data.games.length,
    live: data.games.filter((g) => g.status === 'live').length,
    scheduled: data.games.filter((g) => g.status === 'scheduled').length,
    final: data.games.filter((g) => g.status === 'final').length
  }), [data.games])

  const visible = useMemo(
    () => (filter === 'all' ? data.games : data.games.filter((g) => g.status === filter)),
    [data.games, filter]
  )

  const byDay = useMemo(() => {
    const map = new Map()
    for (const g of [...visible].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))) {
      const k = dayKey(g.kickoff)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(g)
    }
    return [...map.entries()]
  }, [visible])

  const topEdges = data.board.filter((p) => p.qualified).slice(0, 4)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="row gap-2" style={{ marginBottom: 2 }}>
            {data.source === 'espn' ? (
              <span className="badge live"><span className="live-dot" /> Live data</span>
            ) : (
              <span className="badge quiet">Bundled data</span>
            )}
            <span className="eyebrow">{data.label}</span>
          </div>
          <h1 className="page-title">Scores</h1>
        </div>
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'live', label: 'Live', count: counts.live },
            { value: 'scheduled', label: 'Upcoming', count: counts.scheduled },
            { value: 'final', label: 'Final', count: counts.final }
          ]}
        />
      </header>

      {data.warnings?.map((w) => (
        <div key={w} className="panel" style={{ padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s4)', borderColor: 'rgba(242,193,78,0.35)' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--gold)' }}>{w}</span>
        </div>
      ))}

      {topEdges.length > 0 && (
        <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
          <div className="panel-head">
            <div>
              <div className="eyebrow">Where the model disagrees most</div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Today&apos;s biggest edges</h2>
            </div>
            <a className="btn ghost" href={href('odds')}>Full board</a>
          </div>
          <div className="edge-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {topEdges.map((p, i) => (
              <a
                key={p.id}
                href={href(`game/${p.gameId}`)}
                style={{
                  padding: 'var(--s4)',
                  borderRight: i < topEdges.length - 1 ? '1px solid var(--line)' : 'none'
                }}
              >
                <div className="mono dim" style={{ fontSize: 11, marginBottom: 6 }}>{p.matchup}</div>
                <div className="team-name" style={{ fontSize: 'var(--t-lg)', marginBottom: 4 }}>{p.label}</div>
                <div className="row gap-2">
                  <span className="mono market">{fmtOdds(p.price)}</span>
                  <span className="dim mono" style={{ fontSize: 11 }}>{p.book}</span>
                </div>
                <div style={{ marginTop: 'var(--s2)' }}>
                  <Badge tone="edge">+{(p.ev * 100).toFixed(1)}% EV</Badge>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {byDay.length === 0 && (
        <Empty title={filter === 'live' ? 'Nothing in progress right now' : 'No games match that filter'}>
          {filter === 'live'
            ? data.source === 'espn'
              ? 'Scores are coming from ESPN and no game is currently being played. This page refreshes itself while a game is live.'
              : 'This build is showing the bundled slate, which has fixed results and never goes live.'
            : 'Try the All tab, or check back when the next slate posts.'}
        </Empty>
      )}

      {byDay.map(([day, games]) => (
        <section key={day} style={{ marginBottom: 'var(--s6)' }}>
          <div className="row gap-3" style={{ marginBottom: 'var(--s3)' }}>
            <h2 style={{ fontSize: 'var(--t-base)', letterSpacing: '0.02em' }}>{fmtDay(games[0].kickoff)}</h2>
            {relativeDay(games[0].kickoff) && <Badge tone="chalk">{relativeDay(games[0].kickoff)}</Badge>}
            <span className="dim mono" style={{ fontSize: 11 }}>{games.length} game{games.length === 1 ? '' : 's'}</span>
          </div>
          <div className="card-grid">
            {games.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
