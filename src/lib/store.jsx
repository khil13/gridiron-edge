/**
 * App state: model settings and the bet slip. Both persist locally so a
 * refresh does not wipe your work, and both fall back to memory when
 * storage is blocked.
 */

import { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import { DEFAULT_SETTINGS } from './model.js'
import { load, save } from './storage.js'

const StoreContext = createContext(null)

const initial = () => ({
  settings: { ...DEFAULT_SETTINGS, preseasonShrink: 0.55, ...load('settings', {}) },
  slip: load('slip', []),
  tickets: load('tickets', []),
  lockedCards: load('lockedCards', []),
  slipOpen: false,
  mode: load('mode', 'straight') // 'straight' | 'parlay'
})

function reducer(state, action) {
  switch (action.type) {
    case 'setting':
      return { ...state, settings: { ...state.settings, [action.key]: action.value } }
    case 'resetSettings':
      return { ...state, settings: { ...DEFAULT_SETTINGS, preseasonShrink: 0.55 } }
    case 'addLeg': {
      if (state.slip.some((l) => l.id === action.leg.id)) return state
      return { ...state, slip: [...state.slip, action.leg], slipOpen: true }
    }
    case 'removeLeg':
      return { ...state, slip: state.slip.filter((l) => l.id !== action.id) }
    case 'clearSlip':
      return { ...state, slip: [] }
    case 'setStake':
      return {
        ...state,
        slip: state.slip.map((l) => (l.id === action.id ? { ...l, stake: action.stake } : l))
      }
    case 'toggleSlip':
      return { ...state, slipOpen: action.open ?? !state.slipOpen }
    case 'setMode':
      return { ...state, mode: action.mode }
    case 'lockCard': {
      // One lock per slate date. Re-locking replaces it, so a day cannot be
      // quietly logged twice with different numbers.
      const rest = state.lockedCards.filter((c) => c.dayKey !== action.card.dayKey)
      return { ...state, lockedCards: [action.card, ...rest] }
    }
    case 'unlockCard':
      return { ...state, lockedCards: state.lockedCards.filter((c) => c.id !== action.id) }
    case 'placeTickets':
      return { ...state, tickets: [...action.tickets, ...state.tickets], slip: [], slipOpen: false }
    case 'removeTicket':
      return { ...state, tickets: state.tickets.filter((t) => t.id !== action.id) }
    default:
      return state
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial)

  useEffect(() => { save('settings', state.settings) }, [state.settings])
  useEffect(() => { save('slip', state.slip) }, [state.slip])
  useEffect(() => { save('tickets', state.tickets) }, [state.tickets])
  useEffect(() => { save('lockedCards', state.lockedCards) }, [state.lockedCards])
  useEffect(() => { save('mode', state.mode) }, [state.mode])

  const value = useMemo(() => ({ ...state, dispatch }), [state])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
