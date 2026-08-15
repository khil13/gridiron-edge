# Gridiron Edge

An NFL app that behaves like a scoreboard on the surface and an analytics desk underneath. Scores, standings and team pages up front; power ratings, no-vig pricing, expected value and Kelly staking one tap deeper.

Built with React and Vite. Two runtime dependencies. No backend required.

---

## What's in it

**Scores** — the slate grouped by day, with a persistent ticker strip. Every upcoming game carries an *Edge Rail*: a spread number line showing where the market has the game (gold) against where the model has it (blue). The band between them is the disagreement.

**Game detail** — a **Stats** tab on live and finished games with the real box score: scoring by quarter, team statistics, game leaders, and for games in progress the current down, distance, possession and last play. It polls while the game is live. Plus market-vs-model breakdown, a full odds comparison across six books with best-price highlighting, line movement since open, win probability charts for finished games, and a Model tab that shows every input that produced the number.

**Card of the day** — every game on the slate gets the model's read, but only some carry a stake. Games where the model beats the market are tiered in units; games where it agrees are shown as zero-unit **leans** with a reason attached. A lean means the model likes a side but there is no edge left after the vig, and betting those is how a card bleeds — so staked units, risk and expected return count qualifying plays only, and leans are never locked for grading. At most one play per game, chosen at the best price across all books and tiered by conviction in units. Every game that *doesn't* make the card is listed underneath with a specific reason, because a card with a play on every game isn't selective — it's a schedule. Preseason slates carry a visible low-confidence banner.

**Results** — locked cards graded against final scores, with a running record in units, ROI, and a split by market. Leads with whether the sample is big enough to mean anything, because a betting record without a sample-size caveat is decoration.

**Odds board** — one row per candidate play across the whole slate, ranked by expected value rather than kickoff time. Filter by market, restrict to reduced-juice books, set a minimum EV bar. Each row shows the model's probability, the book's no-vig probability, the edge in points, EV, and a fractional-Kelly stake.

**Model lab** — every assumption is a slider: home field advantage, Elo-to-points conversion, margin standard deviation, rest, preseason shrink, devig method, Kelly fraction, bankroll. Move one and the entire app re-prices instantly.

**Standings & teams** — 2025 final tables with playoff seeds, plus 2026 opening power ratings for all 32 clubs.

**Bet slip** — straight or parlay, priced with model probabilities rather than book probabilities, so you can see exactly what stacking legs costs you. Stored in your browser only. Nothing is transmitted and no money moves.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run ratings      # rebuild power ratings from 2025 results
npm run build        # production build to dist/
npm run preview      # serve the production build
```

---

## Push it to GitHub

The repo is ready to go — `.gitignore`, MIT licence, and two workflows are already in place.

```bash
git init
git add .
git commit -m "Gridiron Edge: NFL scores and market analytics"
git branch -M main
git remote add origin https://github.com/<you>/gridiron-edge.git
git push -u origin main
```

Or, with the GitHub CLI:

```bash
gh repo create gridiron-edge --public --source=. --push
```

**Live site, free.** In your repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included `deploy.yml` builds on every push to `main` and publishes to `https://<you>.github.io/gridiron-edge/`. It sets the Vite base path from the repo name automatically, and the app uses hash routing, so deep links work with no server rewrites.

`ci.yml` runs a build on every push and pull request.

---

## Data: what's real and what isn't

Being straight about this matters more than the app looking impressive.

| Data | Source | Real? |
| --- | --- | --- |
| 2025 final records, playoff bracket, Super Bowl LX | Bundled | **Real** |
| 2026 preseason schedule and venues | Bundled | **Real** |
| Power ratings | Derived from the above by `scripts/build-ratings.mjs` | **Computed** |
| Points for / against / pace | Derived from each team's rating | **Synthetic** |
| Sportsbook prices | `src/data/markets.js` generator | **Simulated** |
| In-game win probability paths | Brownian bridge from pregame number to final score | **Simulated** |

Simulated prices exist so the analytics have something coherent to work on with no network and no API key. They are labelled as simulated everywhere they appear in the UI. Connect a real feed before you take any of it seriously.

### Connecting live data

Copy `.env.example` to `.env`:

```bash
# VITE_DATA_SOURCE=mock        # live is the default; set this to force bundled data
VITE_ENABLE_ESPN=true          # ESPN's public scoreboard, no key needed
VITE_ODDS_API_KEY=your_key     # the-odds-api.com, free tier is plenty
VITE_ODDS_BOOKS=draftkings,fanduel,betmgm,pinnacle
```

Live scores are on by default and need no configuration. The app polls ESPN every 45 seconds while a game is in progress and stops polling when nothing is live. Two ESPN hosts are tried in turn, because `site.api.espn.com` began refusing some callers in August 2026 and `site.web.api.espn.com` serves the same payload.

Live sources are best-effort. If ESPN or The Odds API is unreachable the app falls back to the bundled slate and tells you why in a banner rather than showing an empty page. Odds API events are matched back to schedule games by team, so the two feeds do not have to agree on IDs.

To add a different provider, write a module exposing `fetchSlate()` and/or `fetchMarkets()` that returns the shapes in `src/data/providers/`, then wire it into `src/data/provider.js`. Nothing downstream knows or cares where the data came from.

---

## The model

A margin-aware Elo on the familiar 1500 scale.

1. Each team's 2025 win percentage maps onto a 600-point Elo range.
2. Postseason wins add 15 points each; the title adds 25. Records alone under-reward a deep run.
3. The result is regressed 25% toward 1500, because the offseason resets more than it feels like it should.
4. Ratings convert to points at **25 Elo ≈ 1 point of spread** — the one opinionated constant, and a slider in Model Lab so you can refit it.

Game projection is `(home rating − away rating) / 25 + home field + rest`, converted to a win probability through a normal margin distribution with σ ≈ 13.2.

Preseason projections are deliberately pulled toward a pick'em. Starters play a handful of snaps, and a model that reads a preseason roster like a real one will hand you edges that aren't there.

### Odds math (`src/lib/odds.js`)

- American ↔ decimal ↔ implied probability
- Vig removal by **multiplicative**, **additive**, **power** and **Shin** methods
- Cover and total probabilities with an NFL push-mass table — 3 and 7 carry far more probability than a normal curve implies, which is exactly why whole-number spreads price differently from half-points
- Expected value, full and fractional Kelly, parlay pricing, closing line value

### Card selection rules

Two constraints do the work:

**One play per game.** A spread and a total on the same game express the same opinion about the same roster. Stacking them silently doubles your exposure to one team being mis-rated, so the card takes the strongest view per game and stops. The runner-up is named on the card so you can see what was left off and why.

**Both bars must clear.** A tier requires a minimum EV *and* a minimum points of disagreement. A large EV built on a quarter-point gap is mostly rounding error in the ratings, not a real edge, so it doesn't make the card.

| Tier | Units | Min EV | Min edge |
| --- | --- | --- | --- |
| Best bet | 3u | 5.0% | 1.5 pts |
| Strong | 2u | 3.0% | 1.0 pts |
| Lean | 1u | 1.5% | 0.5 pts |

One unit is 1% of bankroll. The card reports expected *winners* rather than projected profit, because a positive-EV card still loses money more often than people expect.

---

## Layout

```
src/
├── data/
│   ├── teams.js            32 clubs: colours, divisions, logo slugs
│   ├── season2025.js       real final records + every playoff game
│   ├── schedule.js         2026 preseason slate
│   ├── markets.js          simulated book prices + best-price search
│   ├── generated/          output of npm run ratings
│   ├── providers/          bundled, ESPN, The Odds API
│   └── provider.js         source selection with graceful fallback
├── lib/
│   ├── odds.js             pricing math, no React
│   ├── model.js            Elo, projections, power rankings
│   ├── edges.js            where model meets market
│   ├── format.js           every displayed number goes through here
│   ├── router.js           40-line hash router
│   ├── store.jsx           settings + bet slip, persisted
│   └── useDataset.js       loads once, re-derives on settings change
│   ├── card.js             card-of-the-day selection, tiers, passes
│   ├── grading.js          settling locked cards, record, significance
├── components/             shell, ticker, game card, Edge Rail, charts, slip
├── views/                  scores, card, game, odds board, standings, teams, model lab
└── styles/                 design tokens and one global sheet
```

`lib/odds.js` and `lib/model.js` are pure — no React, no data imports beyond each other. They can be lifted into a Node script or a test runner as-is.

---

## Design notes

Surfaces are a blue-shifted near-black; type is warm bone rather than white. Three accents, each strictly semantic and used nowhere else:

- **gold** — what the market says
- **mint** — what the model says, and positive EV
- **flare** — live game state

Numbers are set in a monospace with tabular figures throughout, because every number in this app exists to be compared to another number. The Edge Rail is the one place the design spends its boldness; everything around it stays quiet.

Responsive to phone width, keyboard focus is visible, charts and the Edge Rail are narrated for screen readers, and `prefers-reduced-motion` is respected.

---

## Licence

MIT. Team names, marks and logos belong to their respective clubs and the NFL; logo images are loaded from ESPN's public CDN and are not redistributed in this repo.

Model output is an estimate, not advice. If betting has stopped being fun, the US national helpline is **1-800-522-4700**.
