import { useMemo } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Slider, Segmented, Badge } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { DEFAULT_SETTINGS } from '../lib/model.js'
import { fmtSigned, fmtSpread, fmtMoney, fmtKickoff } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * Model Lab. Every assumption the projections rest on is a control here,
 * and every control updates the whole app the instant you move it — the
 * scores page, the board and the slip all read from the same settings.
 */
export default function ModelLabView({ data }) {
  const { settings, dispatch } = useStore()
  const set = (key) => (value) => dispatch({ type: 'setting', key, value })

  const qualified = useMemo(
    () => data.board.filter((p) => p.ev >= settings.minEdge),
    [data.board, settings.minEdge]
  )
  const exposure = qualified.reduce((s, p) => s + p.stake, 0)
  const dirty = JSON.stringify({ ...DEFAULT_SETTINGS, preseasonShrink: 0.55 }) !== JSON.stringify(settings)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{data.ratingsMeta.basis}</div>
          <h1 className="page-title">Model lab</h1>
        </div>
        <div className="row gap-3">
          {dirty && <Badge tone="chalk">Modified</Badge>}
          <button className="btn" onClick={() => dispatch({ type: 'resetSettings' })}>Reset to defaults</button>
        </div>
      </header>

      <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 'var(--s5)' }}>
        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>Game projection</h2>
            <span className="eyebrow">Points</span>
          </div>
          <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
            <Slider label="Home field advantage" value={settings.homeField} min={0} max={4} step={0.1}
                    onChange={set('homeField')} display={`${settings.homeField.toFixed(1)} pts`} />
            <Slider label="Elo points per game point" value={settings.eloPerPoint} min={15} max={35} step={1}
                    onChange={set('eloPerPoint')} display={settings.eloPerPoint} />
            <Slider label="Margin std dev" value={settings.marginSigma} min={10} max={16} step={0.1}
                    onChange={set('marginSigma')} display={settings.marginSigma.toFixed(1)} />
            <Slider label="Rest advantage per day" value={settings.restPointsPerDay} min={0} max={0.5} step={0.01}
                    onChange={set('restPointsPerDay')} display={`${settings.restPointsPerDay.toFixed(2)} pts`} />
            <Slider label="Preseason shrink" value={settings.preseasonShrink} min={0} max={0.9} step={0.05}
                    onChange={set('preseasonShrink')} display={`${Math.round(settings.preseasonShrink * 100)}%`} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>Pricing &amp; staking</h2>
            <span className="eyebrow">Bankroll</span>
          </div>
          <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
            <div className="field">
              <label><span>Vig removal</span></label>
              <Segmented
                label="Devig method"
                value={settings.devigMethod}
                onChange={set('devigMethod')}
                options={[
                  { value: 'multiplicative', label: 'Mult' },
                  { value: 'additive', label: 'Add' },
                  { value: 'power', label: 'Power' },
                  { value: 'shin', label: 'Shin' }
                ]}
              />
              <p className="dim" style={{ fontSize: 11, margin: 0 }}>{DEVIG_NOTES[settings.devigMethod]}</p>
            </div>
            <Slider label="Kelly fraction" value={settings.kellyFraction} min={0.05} max={1} step={0.05}
                    onChange={set('kellyFraction')} display={`${settings.kellyFraction.toFixed(2)}×`} />
            <Slider label="Minimum EV to flag a play" value={settings.minEdge} min={0} max={0.1} step={0.005}
                    onChange={set('minEdge')} display={`${(settings.minEdge * 100).toFixed(1)}%`} />
            <div className="field">
              <label><span>Bankroll</span></label>
              <input type="number" min="1" step="50" value={settings.bankroll}
                     onChange={(e) => set('bankroll')(Number(e.target.value))} />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>What these settings produce</h2>
          </div>
          <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
            <Big label="Qualifying plays" value={qualified.length} />
            <Big label="Suggested exposure" value={fmtMoney(exposure)}
                 sub={`${((exposure / settings.bankroll) * 100).toFixed(1)}% of bankroll`} />
            <Big label="Average edge" value={qualified.length
              ? `+${((qualified.reduce((s, p) => s + p.ev, 0) / qualified.length) * 100).toFixed(1)}%`
              : '—'} tone="pos" />
            <p className="dim" style={{ fontSize: 11, margin: 0 }}>
              Raising home field or lowering σ widens the model&apos;s disagreement with the market and
              produces more plays. That is a warning, not a feature: a model that finds edges everywhere
              is usually wrong, not sharp.
            </p>
          </div>
        </section>
      </div>

      <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>Power ratings</h2>
            <span className="eyebrow">2026 opening</span>
          </div>
          <div className="tbl-scroll" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>#</th><th style={{ textAlign: 'left' }}>Team</th><th>Elo</th><th>vs Avg</th><th>2025</th></tr></thead>
              <tbody>
                {data.rankings.map((r) => (
                  <tr key={r.abbr}>
                    <td className="num dim">{r.rank}</td>
                    <td style={{ textAlign: 'left' }}>
                      <a className="row gap-2" href={href(`team/${r.abbr}`)}>
                        <TeamMark abbr={r.abbr} size={18} />
                        <span className="team-name">{r.abbr}</span>
                      </a>
                    </td>
                    <td className="num">{Math.round(r.elo)}</td>
                    <td className={`num ${r.pointsVsAverage > 0 ? 'pos' : 'neg'}`}>{fmtSigned(r.pointsVsAverage)}</td>
                    <td className="num dim">{r.wins}-{r.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>Projections vs market</h2>
            <span className="eyebrow">Home spread</span>
          </div>
          <div className="tbl-scroll" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th style={{ textAlign: 'left' }}>Game</th><th>Kick</th><th>Market</th><th>Model</th><th>Diff</th><th>Total</th></tr></thead>
              <tbody>
                {data.games.filter((g) => g.projection && g.market).map((g) => {
                  const mkt = g.market.consensus.spreadHome
                  const mdl = g.projection.modelSpreadHome
                  const diff = mkt - mdl
                  return (
                    <tr key={g.id}>
                      <td style={{ textAlign: 'left' }}>
                        <a className="row gap-2" href={href(`game/${g.id}`)}>
                          <span className="mono" style={{ fontSize: 11 }}>{g.away} @ {g.home}</span>
                        </a>
                      </td>
                      <td className="num dim">{fmtKickoff(g.kickoff)}</td>
                      <td className="num market">{fmtSpread(mkt)}</td>
                      <td className="num model">{fmtSpread(Math.round(mdl * 10) / 10)}</td>
                      <td className={`num ${Math.abs(diff) >= 1 ? (diff > 0 ? 'pos' : 'neg') : 'dim'}`}>
                        {fmtSigned(diff)}
                      </td>
                      <td className="num dim">{g.projection.total.toFixed(1)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 'var(--s4)', padding: 'var(--s5)' }}>
        <h2 style={{ fontSize: 'var(--t-base)', marginBottom: 'var(--s3)' }}>How the ratings were built</h2>
        <p className="dim" style={{ fontSize: 13, margin: 0, maxWidth: '70ch' }}>
          Each team&apos;s 2025 win percentage maps onto a {data.ratingsMeta.method.winPctScale}-point Elo range,
          plus {data.ratingsMeta.method.playoffWinBonus} points per postseason win and{' '}
          {data.ratingsMeta.method.titleBonus} for the title. That figure is then regressed{' '}
          {Math.round(data.ratingsMeta.method.offseasonRegression * 100)}% toward 1500, because rosters turn over
          and last season predicts less than it feels like it should. Run{' '}
          <span className="mono" style={{ color: 'var(--gold)' }}>npm run ratings</span> to rebuild the file
          after editing <span className="mono">scripts/build-ratings.mjs</span>.
        </p>
        <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 'var(--s3)' }}>
          {data.ratingsMeta.note}
        </p>
      </section>
    </div>
  )
}

const DEVIG_NOTES = {
  multiplicative: 'Scales all outcomes equally. Fast, and slightly too kind to favourites.',
  additive: 'Subtracts the margin evenly. Distorts longshots least at short prices.',
  power: 'Solves an exponent so probabilities sum to one. Handles longshot bias.',
  shin: 'Models the book’s exposure to informed money. Usually closest to the true close.'
}

function Big({ label, value, sub, tone }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 2 }}>{label}</div>
      <div className={tone || ''} style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--t-xl)' }}>{value}</div>
      {sub && <div className="dim mono" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  )
}
