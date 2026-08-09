import { useState } from 'react'
import { getTeam } from '../data/teams.js'
import { readable } from '../lib/format.js'

/** Team logo with a coloured wordmark fallback for when the CDN is blocked. */
export default function TeamMark({ abbr, size = 24 }) {
  const team = getTeam(abbr)
  const [failed, setFailed] = useState(false)

  if (failed || !team.logo) {
    return (
      <span
        className="mark-fallback"
        style={{
          width: size, height: size,
          background: readable(team.primary),
          fontSize: Math.max(8, size * 0.36)
        }}
        aria-hidden="true"
      >
        {abbr}
      </span>
    )
  }

  return (
    <img
      className="mark"
      src={team.logo}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
