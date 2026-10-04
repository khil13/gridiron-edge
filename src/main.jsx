import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { StoreProvider } from './lib/store.jsx'
import './styles/global.css'

// Every deploy replaces this app's content-hashed JS chunks. A tab that was
// already open when a new deploy landed still has the OLD chunk filenames
// in its route table, so tapping into a lazy-loaded page (anything but
// Scores — see App.jsx) asks for a file that no longer exists and 404s.
// Vite fires this event specifically for that failure (not for a real bug
// inside a chunk that loaded fine — only for the fetch itself failing), so
// the fix is just a reload: it re-fetches index.html, which points at the
// chunks the CURRENT deploy actually has. Doing that automatically beats
// leaving a visitor stuck on the ErrorBoundary's generic message with no
// idea a refresh would fix it. Guarded by sessionStorage so a chunk that's
// still missing after a reload — a genuinely broken deploy, not a stale tab
// — falls through to that error message instead of reloading forever.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'gridiron-edge:reloaded-after-preload-error'
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — reload once
    // anyway; worst case is one extra reload rather than a page stuck dead.
  }
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>
)
