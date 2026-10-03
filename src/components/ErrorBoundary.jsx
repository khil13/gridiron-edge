import { Component } from 'react'
import { href } from '../lib/router.js'

/**
 * Nothing in this app caught a render-time error before this — a null
 * dereference in a chart, a malformed game shape, any bug at all during
 * render — unmounted the whole React tree and left a blank white page with
 * no explanation and nothing a visitor could do about it. React only offers
 * this as a class component; there is no hook equivalent.
 *
 * The real error message is shown rather than hidden, matching how the rest
 * of this app treats failure (a dead feed, a stale slate): say what broke,
 * do not pretend it didn't.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Browser console only — this app has no error-reporting backend to
    // send it to, and inventing one here would be the opposite of "only
    // use data that can actually be obtained."
    console.error('Render error caught by ErrorBoundary:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="page">
        <div className="empty" role="alert">
          <h3>Something broke on this page</h3>
          <p style={{ margin: 0 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <p style={{ marginTop: 'var(--s3)', marginBottom: 0 }}>
            <a href={href('scores')} style={{ color: 'var(--gold)' }}>Back to Scores</a>
            {' '}— the rest of the app is unaffected; this page's own code is what failed.
          </p>
        </div>
      </div>
    )
  }
}
