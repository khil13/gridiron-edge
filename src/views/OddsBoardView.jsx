import { useMemo, useState } from 'react'
import { Segmented, Badge, Empty, Slider } from '../components/Controls.jsx'
import TeamMark from '../components/TeamMark.jsx'
import { useStore } from '../lib/store.jsx'
import { toSlipLeg } from '../lib/edges.js'
import { fmtOdds, fmtPct, fmtMoney, fmtKickoff, fmtSigned } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * The board. One row per candidate play across the whole slate, ranked by
 * expected value rather than by kickoff — because a board sorted by time is
 * a schedule, and a board sorted by edge is a tool.
 */
export default function OddsBoardView({ data }) {
  const { settings, dispatch } = useStore()
  const [market, setMarket] = useState('all')
  const [sharpOnly, setSharpOnly] = useState(false)
  const [threshold, setThreshold] = useState(0)

  const rows = useMemo(() => {
    let plays = data.games.flatMap((g) => g.allPlays.map((p) => ({ ...p, game: g })))
    // Keep the best price per side per game so the board is not 6× redundant.
    const byKey = new Map()
    for (const p of plays) {
      const k = `${p.gameId}:${p.type}:${p.side}`
      if (sharpOnly && !p.sharp) continue
      const cur = byKey.get(k)
      if (!cur || p.ev > cur.ev) byKey.set(k, p)
    }
    return [...byKey.values()]
      .filter((p) => market === 'all' || p.type === market)
      .filter((p) => p.ev * 100 >= threshold)
      .sort((a, b) => b.ev - a.ev)
  }, [data.games, market, sharpOnly, threshold])

  const qualified = rows.filter((r) => r.ev >= settings.minEdge)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            {data.simulatedPrices ? 'Simulated prices · set VITE_ODDS_API_KEY for live' : 'Live prices'}
          </div>
          <h1 className="page-title">Odds board</h1>
        </div>
        <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
          <Segmented
            label="Market"
            value={market}
            onChange={setMarket}
            options={[
              { value: 'all', label: 'All' },
              { value: 'spread', label: 'Spread' },
              { value: 'total', label: 'Total' },
              { value: 'moneyline', label: 'ML' }
            ]}
          />
          <Segmented
            label="Books"
            value={sharpOnly ? 'sharp' : 'every'}
            onChange={(v) => setSharpOnly(v === 'sharp')}
            options={[{ value: 'every', label: 'All books' }, { value: 'sharp', label: 'Sharp only' }]}
          />
        </div>
      </header>

      <div className="panel" style={{ padding: 'var(--s4)', marginBottom: 'var(--s4)' }}>
        <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', alignItems: 'end' }}>
          <Slider
            label="Minimum EV"
            value={threshold} min={-5} max={10} step={0.5}
            onChange={setThreshold}
            display={`${threshold > 0 ? '+' : ''}${threshold}%`}
          />
          <Stat label="Plays shown" value={rows.length} />
          <Stat label={`Above your ${(settings.minEdge * 100).toFixed(0)}% bar`} value={qualified.length} tone="pos" />
          <Stat
            label={`Suggested exposure of ${fmtMoney(settings.bankroll)}`}
            value={fmtMoney(qualified.reduce((s, r) => s + r.stake, 0))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nothing clears that bar">
          Lower the minimum EV, or widen the book filter. A quiet board is usually an efficient market,
          not a broken app.
        </Empty>
      ) : (
        <div className="panel">
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Play</th><th style={{ textAlign: 'left' }}>Game</th><th>Kick</th>
                  <th>Price</th><th>Book</th><th>Model</th><th>No-vig</th>
                  <th>Edge</th><th>EV</th><th>Stake</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="row gap-2">
                        <span className="team-name">{p.label}</span>
                        {p.ev >= settings.minEdge && <Badge tone="edge">Play</Badge>}
                        {p.sharp && <Badge tone="chalk">Sharp</Badge>}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <a className="row gap-2 dim" href={href(`game/${p.gameId}`)}>
                        <TeamMark abbr={p.game.away} size={16} />
                        <TeamMark abbr={p.game.home} size={16} />
                        <span className="mono" style={{ fontSize: 11 }}>{p.matchup}</span>
                      </a>
                    </td>
                    <td className="num dim">{fmtKickoff(p.kickoff)}</td>
                    <td className="num market">{fmtOdds(p.price)}</td>
                    <td className="dim">{p.book}</td>
                    <td className="num">{fmtPct(p.modelProb)}</td>
                    <td className="num dim">{fmtPct(p.marketProb)}</td>
                    <td className="num">{fmtSigned(p.edgePoints)} <span className="dim">pts</span></td>
                    <td className={`num ${p.ev > 0 ? 'pos' : 'neg'}`}>{p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}%</td>
                    <td className="num dim">{p.ev > 0 ? fmtMoney(p.stake) : '—'}</td>
                    <td>
                      <button className="btn" onClick={() => dispatch({ type: 'addLeg', leg: toSlipLeg(p) })}>Add</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="dim" style={{ fontSize: 12, marginTop: 'var(--s4)' }}>
        Edge is the gap between the model&apos;s number and the posted number, in points.
        EV is per unit staked, after removing the book&apos;s margin with the{' '}
        <span className="mono">{settings.devigMethod}</span> method. Stake is fractional Kelly, capped
        by your bankroll setting.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className={`mono ${tone || ''}`} style={{ fontSize: 'var(--t-xl)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        {value}
      </div>
    </div>
  )
}
