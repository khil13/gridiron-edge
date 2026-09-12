/** Small shared controls: tabs, segmented switches, badges, sliders. */

import { useEffect, useRef, useState } from 'react'

/**
 * The tab strip scrolls sideways when it doesn't fit, with the scrollbar
 * itself hidden for a cleaner look — but that leaves nothing telling you
 * there's more to scroll to. A tab pushed off the right edge (Props, on a
 * narrow phone with Stats also showing) then reads as simply not existing.
 * So a fade is shown on whichever edge still has content past it.
 */
export function Tabs({ tabs, value, onChange }) {
  const scrollRef = useRef(null)
  const [canScroll, setCanScroll] = useState({ left: false, right: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const update = () => {
      setCanScroll({
        left: el.scrollLeft > 2,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      })
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [tabs])

  return (
    <div
      className={
        'tabs-wrap' +
        (canScroll.left ? ' can-scroll-left' : '') +
        (canScroll.right ? ' can-scroll-right' : '')
      }
    >
      <div className="tabs" role="tablist" ref={scrollRef}>
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
