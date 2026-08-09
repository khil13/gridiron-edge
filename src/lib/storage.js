/**
 * Persistence that degrades quietly. localStorage throws in private windows
 * and sandboxed frames, so every call falls back to an in-memory map.
 */

const memory = new Map()
const NS = 'gridiron-edge:'

let available = (() => {
  try {
    const k = NS + 'probe'
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
})()

export function load(key, fallback) {
  try {
    const raw = available ? window.localStorage.getItem(NS + key) : memory.get(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function save(key, value) {
  const raw = JSON.stringify(value)
  try {
    if (available) window.localStorage.setItem(NS + key, raw)
    else memory.set(key, raw)
  } catch {
    available = false
    memory.set(key, raw)
  }
}

export function clear(key) {
  try {
    if (available) window.localStorage.removeItem(NS + key)
  } catch { /* ignore */ }
  memory.delete(key)
}
