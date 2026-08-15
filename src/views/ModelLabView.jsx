import { useMemo, useState } from 'react'
import TeamMark from '../components/TeamMark.jsx'
import { Slider, Segmented, Badge } from '../components/Controls.jsx'
import { useStore } from '../lib/store.jsx'
import { PRESETS, presetFor } from '../lib/model.js'
import { americanToDecimal } from '../lib/odds.js'
import { fmtSigned, fmtSpread, fmtMoney, fmtKickoff } from '../lib/format.js'
import { href } from '../lib/router.js'

/**
 * Model Lab.
 *
 * Two questions decide almost everything: how picky should the card be, and
 * how much should a play risk. Those get plain language and sit at the top.
 * The model internals — Elo conversion, margin sigma, home field, rest — are
 * real controls, but they are for refitting the model rather than for using
 * the app, so they live behind a toggle and stay shut by default.
 */
export default function ModelLabView({ data }) {
  const { settings, dispatch } = useStore()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const set = (key) => (value) => dispatch({ type: 'setting', key, value })

  const active = presetFor(settings)

  const qualified = useMemo(
    () => data.board.filter((p) => p.ev >= settings.minEdge),
    [data.board, settings.minEdge]
  )
  const exposure = qualified.reduce((s, p) => s + p.stake, 0)

  const applyPreset = (preset) => {
    for (const [k, v] of Object.entries(preset.settings)) {
      dispatch({ type: 'setting', key: k, value: v })
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">How the card behaves</div>
          <h1 className="page-title">Model lab</h1>
        </div>
        <button className="btn" onClick={() => dispatch({ type: 'resetSettings' })}>
          Reset everything
        </button>
      </header>

      <section className="panel" style={{ marginBottom: 'var(--s4)' }}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Start here</div>
            <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 4 }}>Pick a style</h2>
          </div>
          {active ? <Badge tone="chalk">{active.label}</Badge> : <Badge tone="quiet">Custom</Badge>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {PRESETS.map((p, i) => {
            const on = active?.key === p.key
            return (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                style={{
                  textAlign: 'left',
                  padding: 'var(--s4)',
                  borderRight: i < PRESETS.length - 1 ? '1px solid var(--line)' : 'none',
                  background: on ? 'var(--slab-hi)' : 'transparent'
                }}
              >
                <div
                  className="team-name"
                  style={{ fontSize: 'var(--t-lg)', color: on ? 'var(--gold)' : 'var(--bone)' }}
                >
                  {p.label}
                </div>
                <p className="dim" style={{ fontSize: 12, margin: '6px 0 0' }}>{p.blurb}</p>
              </button>
            )
          })}
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gap: 'var(--s4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          marginBottom: 'var(--s4)'
        }}
      >
        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>How picky is the card?</h2>
          </div>
          <div style={{ padding: 'var(--s4)' }}>
            <Slider
              label="Minimum edge before a play counts"
              value={settings.minEdge}
              min={0} max={0.1} step={0.005}
              onChange={set('minEdge')}
              display={`${(settings.minEdge * 100).toFixed(1)}%`}
            />
            <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 'var(--s3)' }}>
              {settings.minEdge <= 0.01
                ? 'Very low. Almost any disagreement becomes a play, including ones that are just noise in the ratings.'
                : settings.minEdge >= 0.04
                  ? 'High. Only clear disagreements get through, so expect quiet days — which is usually the correct answer.'
                  : 'A sensible bar. Small edges are ignored because they are mostly rounding error.'}
            </p>
            <div className="perf" />
            <div className="row spread-between">
              <span className="eyebrow">Plays right now</span>
              <span className="mono" style={{ fontSize: 'var(--t-lg)', color: 'var(--bone)' }}>
                {qualified.length}
              </span>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 style={{ fontSize: 'var(--t-base)' }}>How much do you risk?</h2>
            <span className="eyebrow">Kelly</span>
          </div>
          <div style={{ padding: 'var(--s4)' }}>
            <Slider
              label="Kelly fraction"
              value={settings.kellyFraction}
              min={0.05} max={1} step={0.05}
              onChange={set('kellyFraction')}
              display={`${settings.kellyFraction.toFixed(2)}x`}
            />
            <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 'var(--s3)' }}>
              {kellyBlurb(settings.kellyFraction)}
            </p>

            <div className="perf" />

            <div className="field">
              <label><span>Bankroll</span></label>
              <input
                type="number" min="1" step="50"
                value={settings.bankroll}
                onChange={(e) => set('bankroll')(Number(e.target.value))}
              />
            </div>

            <div className="perf" />

            <div className="row spread-between" style={{ marginBottom: 4 }}>
              <span className="eyebrow">A typical 55% play at -110</span>
              <span className="mono" style={{ color: 'var(--bone)' }}>
                {fmtMoney(exampleStake(settings))}
              </span>
            </div>
            <div className="row spread-between">
              <span className="eyebrow">Total at risk today</span>
              <span className="mono" style={{ color: 'var(--bone)' }}>
                {fmtMoney(exposure)}{' '}
                <span className="dim">({((exposure / settings.bankroll) * 100).toFixed(1)}%)</span>
              </span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginBottom: 'var(--s5)' }}>
        <button
          className="panel-head"
          style={{ width: '100%', cursor: 'pointer' }}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <div style={{ textAlign: 'left' }}>
            <div className="eyebrow">For refitting the model, not for using the app</div>
            <h2 style={{ fontSize: 'var(--t-base)', marginTop: 4 }}>Model internals</h2>
          </div>
          <span className="mono dim" style={{ fontSize: 12 }}>
            {showAdvanced ? 'Hide' : 'Show'}
          </span>
        </button>

        {showAdvanced && (
          <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s5)' }}>
            <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '75ch' }}>
              These are the assumptions the projections rest on. They are worth changing only if
              you have data saying the current value is wrong — moving them to produce more plays
              does not create edges, it just lowers the evidence needed to claim one.
            </p>

            <div style={{ display: 'grid', gap: 'var(--s4)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              <Explained title="Home field advantage" note="Points added to the home side. Post-2020 the NFL has run about 1.5 to 2.0.">
                <Slider label="Home field" value={settings.homeField} min={0} max={4} step={0.1}
                        onChange={set('homeField')} display={`${settings.homeField.toFixed(1)} pts`} />
              </Explained>

              <Explained title="Rating scale" note="How many Elo points equal one point of spread. Lower makes the model more opinionated.">
                <Slider label="Elo per point" value={settings.eloPerPoint} min={15} max={35} step={1}
                        onChange={set('eloPerPoint')} display={settings.eloPerPoint} />
              </Explained>

              <Explained title="Margin spread" note="How much NFL results scatter around the projection. About 13.2 historically. Lowering it invents confidence.">
                <Slider label="Margin std dev" value={settings.marginSigma} min={10} max={16} step={0.1}
                        onChange={set('marginSigma')} display={settings.marginSigma.toFixed(1)} />
              </Explained>

              <Explained title="Rest" note="Points per extra day of rest over the opponent.">
                <Slider label="Rest per day" value={settings.restPointsPerDay} min={0} max={0.5} step={0.01}
                        onChange={set('restPointsPerDay')} display={`${settings.restPointsPerDay.toFixed(2)} pts`} />
              </Explained>

              <Explained title="Preseason shrink" note="How far preseason projections are pulled toward a pick'em. Starters play a handful of snaps, so the model deliberately distrusts itself. Drop this to 0 once the regular season starts.">
                <Slider label="Preseason shrink" value={settings.preseasonShrink} min={0} max={0.9} step={0.05}
                        onChange={set('preseasonShrink')} display={`${Math.round(settings.preseasonShrink * 100)}%`} />
              </Explained>

              <Explained title="Vig removal" note={DEVIG_NOTES[settings.devigMethod]}>
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
              </Explained>
            </div>
          </div>
        )}
      </section>

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
          {Math.round(data.ratingsMeta.method.offseasonRegression * 100)}% toward 1500, because rosters turn
          over and last season predicts less than it feels like it should.
        </p>
        <p className="dim" style={{ fontSize: 12, marginBottom: 0, marginTop: 'var(--s3)' }}>
          {data.ratingsMeta.note}
        </p>
      </section>
    </div>
  )
}

function kellyBlurb(f) {
  if (f <= 0.15) return 'Very cautious. Roughly a sixth of what the maths calls optimal, which is sensible when the model\u2019s probabilities are themselves estimates.'
  if (f <= 0.3) return 'Quarter Kelly, the common default. Gives up some growth to survive a bad run, which is the trade almost everyone should take.'
  if (f <= 0.6) return 'Half Kelly. Noticeably bigger stakes and noticeably deeper losing streaks.'
  return 'Near full Kelly. Only correct if the model\u2019s probabilities are exactly right, and they are not. Expect brutal swings.'
}

/** Concrete example so the slider has a real number attached to it. */
function exampleStake(s) {
  const p = 0.55
  const b = americanToDecimal(-110) - 1
  const f = Math.max(0, (p * b - (1 - p)) / b)
  return f * s.kellyFraction * (s.bankroll || 0)
}

const DEVIG_NOTES = {
  multiplicative: 'Scales all outcomes equally. Fast, and slightly too kind to favourites.',
  additive: 'Subtracts the margin evenly. Distorts longshots least at short prices.',
  power: 'Solves an exponent so probabilities sum to one. Handles longshot bias.',
  shin: 'Models the book\u2019s exposure to informed money. Usually closest to the true close.'
}

function Explained({ title, note, children }) {
  return (
    <div>
      <div className="team-name" style={{ fontSize: 'var(--t-base)', marginBottom: 2 }}>{title}</div>
      <p className="dim" style={{ fontSize: 11, margin: '0 0 var(--s3)', lineHeight: 1.5 }}>{note}</p>
      {children}
    </div>
  )
}
