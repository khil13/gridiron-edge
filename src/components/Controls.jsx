/** Small shared controls: tabs, segmented switches, badges, sliders. */

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          className="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count != null && <span className="dim"> {t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ tone = 'quiet', children }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Slider({ label, value, min, max, step, onChange, display }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <span className="mono" style={{ color: 'var(--bone)' }}>{display ?? value}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  )
}
