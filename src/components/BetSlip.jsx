import { useMemo } from 'react'
import { useStore } from '../lib/store.jsx'
import { parlayPrice, expectedValue, payout } from '../lib/odds.js'
import { fmtOdds, fmtMoney, fmtPct } from '../lib/format.js'
import { Segmented, Empty } from './Controls.jsx'

/**
 * The slip is a stack of paper tickets. Straight mode grades each leg on its
 * own; parlay mode multiplies the prices and, more usefully, multiplies the
 * model probabilities so you can see what correlation-free stacking costs.
 */
export default function BetSlip() {
  const { slip, slipOpen, mode, settings, tickets, dispatch } = useStore()

  const summary = useMemo(() => {
    if (!slip.length) return null
    if (mode === 'parlay') {
      const price = parlayPrice(slip.map((l) => l.price))
      const modelProb = slip.reduce((p, l) => p * l.modelProb, 1)
      const marketProb = slip.reduce((p, l) => p * l.marketProb, 1)
      const stake = slip[0]?.stake ?? 25
      return {
        price: price.american,
        modelProb,
        marketProb,
        ev: expectedValue(modelProb, price.american),
        stake,
        toWin: payout(stake, price.american) - stake
      }
    }
    const stake = slip.reduce((s, l) => s + (l.stake ?? 25), 0)
    const ev = slip.reduce((s, l) => s + expectedValue(l.modelProb, l.price, l.pushProb) * (l.stake ?? 25), 0)
    const toWin = slip.reduce((s, l) => s + (payout(l.stake ?? 25, l.price) - (l.stake ?? 25)), 0)
    return { stake, ev, toWin, evPct: ev / (stake || 1) }
  }, [slip, mode])

  if (!slipOpen) return null

  const place = () => {
    const now = new Date().toISOString()
    const newTickets =
      mode === 'parlay'
        ? [{ id: `t${Date.now()}`, placedAt: now, type: 'parlay', legs: slip, price: summary.price, stake: summary.stake }]
        : slip.map((l, i) => ({ id: `t${Date.now()}-${i}`, placedAt: now, type: 'straight', legs: [l], price: l.price, stake: l.stake ?? 25 }))
    dispatch({ type: 'placeTickets', tickets: newTickets })
  }

  return (
    <>
      <div className="slip-scrim" onClick={() => dispatch({ type: 'toggleSlip', open: false })} />
      <aside className="slip" aria-label="Bet slip">
        <div className="row spread-between" style={{ padding: 'var(--s4)', borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ fontSize: 'var(--t-lg)' }}>Slip</h2>
          <button className="btn ghost" onClick={() => dispatch({ type: 'toggleSlip', open: false })}>Close</button>
        </div>

        <div style={{ padding: 'var(--s4)', overflowY: 'auto', flex: 1 }}>
          <Segmented
            label="Slip mode"
            value={mode}
            onChange={(m) => dispatch({ type: 'setMode', mode: m })}
            options={[{ value: 'straight', label: 'Straight' }, { value: 'parlay', label: 'Parlay' }]}
          />

          <div style={{ marginTop: 'var(--s4)' }}>
            {!slip.length && (
              <Empty title="Nothing on the slip">
                Add a play from any game or from the Odds Board to price it here.
              </Empty>
            )}

            {slip.map((leg) => (
              <div className="ticket" key={leg.id}>
                <div className="row spread-between gap-2">
                  <div style={{ minWidth: 0 }}>
                    <div className="team-name truncate">{leg.label}</div>
                    <div className="mono dim" style={{ fontSize: 11 }}>{leg.matchup} · {leg.book}</div>
                  </div>
                  <button
                    className="btn ghost"
                    style={{ padding: '2px 6px' }}
                    onClick={() => dispatch({ type: 'removeLeg', id: leg.id })}
                    aria-label={`Remove ${leg.label}`}
                  >
                    ✕
                  </button>
                </div>

                <div className="perf" />

                <div className="row spread-between mono" style={{ fontSize: 12 }}>
                  <span className="market">{fmtOdds(leg.price)}</span>
                  <span className="dim">model {fmtPct(leg.modelProb, 0)} · market {fmtPct(leg.marketProb, 0)}</span>
                  <span className={leg.ev > 0 ? 'pos' : 'neg'}>{leg.ev > 0 ? '+' : ''}{(leg.ev * 100).toFixed(1)}%</span>
                </div>

                {mode === 'straight' && (
                  <div className="row gap-2" style={{ marginTop: 'var(--s2)' }}>
                    <span className="eyebrow">Stake</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={leg.stake ?? 25}
                      onChange={(e) => dispatch({ type: 'setStake', id: leg.id, stake: Number(e.target.value) })}
                      style={{ width: 90 }}
                      aria-label={`Stake for ${leg.label}`}
                    />
                    <span className="mono dim" style={{ fontSize: 11 }}>
                      Kelly suggests {fmtMoney(leg.suggestedStake ?? 0)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {summary && (
            <div className="panel" style={{ marginTop: 'var(--s4)', padding: 'var(--s4)' }}>
              {mode === 'parlay' && (
                <>
                  <Row label="Parlay price" value={fmtOdds(summary.price)} tone="market" />
                  <Row label="Model probability" value={fmtPct(summary.modelProb)} />
                  <Row label="Market probability" value={fmtPct(summary.marketProb)} />
                </>
              )}
              <Row label="Total stake" value={fmtMoney(summary.stake)} />
              <Row label="To win" value={fmtMoney(summary.toWin)} />
              <Row
                label="Expected value"
                value={`${summary.ev > 0 ? '+' : ''}${fmtMoney(summary.ev)}`}
                tone={summary.ev > 0 ? 'pos' : 'neg'}
              />
              <div className="perf" />
              <div className="row gap-2">
                <button className="btn primary grow" style={{ justifyContent: 'center' }} onClick={place}>
                  Log {mode === 'parlay' ? 'parlay' : `${slip.length} bet${slip.length === 1 ? '' : 's'}`}
                </button>
                <button className="btn" onClick={() => dispatch({ type: 'clearSlip' })}>Clear</button>
              </div>
              <p className="dim" style={{ fontSize: 11, marginBottom: 0, marginTop: 'var(--s3)' }}>
                Logging records the bet in this browser only. Nothing is sent anywhere and no money moves.
              </p>
            </div>
          )}

          {tickets.length > 0 && (
            <div style={{ marginTop: 'var(--s5)' }}>
              <div className="eyebrow" style={{ marginBottom: 'var(--s2)' }}>Logged · {tickets.length}</div>
              {tickets.slice(0, 8).map((t) => (
                <div className="ticket" key={t.id} style={{ opacity: 0.75 }}>
                  <div className="row spread-between gap-2">
                    <span className="truncate">{t.legs.map((l) => l.label).join(' + ')}</span>
                    <span className="mono market">{fmtOdds(t.price)}</span>
                  </div>
                  <div className="row spread-between mono dim" style={{ fontSize: 11 }}>
                    <span>{fmtMoney(t.stake)} · {new Date(t.placedAt).toLocaleDateString()}</span>
                    <button className="btn ghost" style={{ padding: 0 }} onClick={() => dispatch({ type: 'removeTicket', id: t.id })}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

function Row({ label, value, tone }) {
  return (
    <div className="row spread-between" style={{ padding: '4px 0' }}>
      <span className="eyebrow">{label}</span>
      <span className={`mono ${tone || ''}`} style={{ fontSize: 13 }}>{value}</span>
    </div>
  )
}
