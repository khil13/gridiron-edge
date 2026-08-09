/**
 * A hash router in 40 lines. Routes look like #/game/p1-kc-la.
 * Hash routing means the GitHub Pages build works with no server rewrites.
 */

import { useEffect, useState, useCallback } from 'react'

export const parseHash = () => {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  return {
    view: segments[0] || 'scores',
    param: segments[1] ? decodeURIComponent(segments[1]) : null,
    query: Object.fromEntries(new URLSearchParams(queryPart || ''))
  }
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const go = useCallback((path) => {
    window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`
  }, [])

  return { ...route, go }
}

export const href = (path) => `#/${path.replace(/^\//, '')}`
