# Gridiron Edge

An NFL app that behaves like a scoreboard on the surface and an analytics desk underneath. Scores, standings and team pages up front; power ratings, no-vig pricing, expected value and Kelly staking one tap deeper.

Built with React and Vite. Two runtime dependencies. No backend required.

---

## What's in it

**Scores** — the slate grouped by day, with a persistent ticker strip. Every upcoming game carries an *Edge Rail*: a spread number line showing where the market has the game (gold) against where the model has it (blue). The band between them is the disagreement.

**Game detail** — a **Stats** tab on live and finished games with the real box score: scoring by quarter, team statistics, game leaders, and for games in progress the current down, distance, possession and last play. It polls while the game is live. Plus market-vs-model breakdown, a full odds comparison across six books with best-price highlighting, line movement since open, win probability charts for finished games, and a Model tab that shows every input that produced the number.

**Card of the day** — every game on the slate gets the model's read, but only some carry a stake. Games where the model beats the market are tiered in units; games where it agrees are shown as zero-unit **leans** with a reason attached. A lean means the model likes a side but there is no edge left after the vig, and betting those is how a card bleeds — so staked units, risk and expected return count qualifying plays only, and leans are never locked for grading. At most one play per game, chosen at the best price across all books and tiered by conviction in units. Every game that *doesn't* make the card is listed underneath with a specific reason, because a card with a play on every game isn't selective — it's a schedule. Preseason slates carry a visible low-confidence banner.

**Player props** — anytime touchdowns, quarterback passing touchdowns, receiving yards, receptions, rushing yards, carries, passing yards, and first-quarter team totals.

The distributions are where the honesty lives. Yardage uses a **gamma**, not a bell curve, because that is how it behaves: a hard floor at zero and a long right tail. On a 60-yard projection a normal curve puts 8% of its probability below zero yards and reads the line at the mean as a coin flip; the gamma says 40%. Receptions use a **negative binomial** rather than Poisson, because catch counts are overdispersed. First-quarter points are built from discrete scoring events, since a quarter lands on 0, 3, 7 or 10 and never on 1, 2, 4 or 5 — a continuous model returned the same probability for a 6.5 and a 9.5 line, which is useless for pricing.

Volume markets only appear for players with a real per-game rate this season. A positional average is adequate for a touchdown share, which is a proportion, and worthless for a yardage line where being twenty yards out is the whole bet. First-quarter *player* props are deliberately not offered: they need drive and snap data this app does not have. You can type in the price your sportsbook is showing and get EV, edge and a stake immediately; no odds key is needed for that, because the price you are actually being offered is the number that decides the bet. Prices you enter are saved per game and survive a reload.

Depth is taken from the published depth chart where available, falling back to who has actually scored, and — if neither is available — every player at a position shares the group's expected touchdowns evenly, with the tab saying plainly that it cannot yet tell them apart. Loaded only when you ask for them, because props cost roughly 20 API credits per game and a whole slate would spend most of a free month's quota on games you never opened.

The model chain: the game projection gives each team's points; points convert to expected touchdowns at about 0.105 each; a player's share of his team's touchdowns comes from real season data shrunk hard toward a positional prior while the sample is thin; touchdowns are Poisson, so the anytime probability is 1 − e^−λ.

Removing the vig here is the part that matters. Anytime touchdown is not a two-way market — a book posts a list of "yes" prices whose implied probabilities sum far above the number of players who will actually score, with holds of 10–25% against 4.5% on a spread. Treating each price as a fair two-way market would manufacture an edge on nearly every player. Instead the posted field is split by team and each side normalised against its own expected number of distinct scorers. If a team's list is too short to be the complete field, the margin cannot be removed and **no EV is claimed for those players at all** — an edge computed against a price that still contains the vig is not an edge.

**Results** — locked cards graded against final scores, with a running record in units, ROI, and a split by market. Leads with whether the sample is big enough to mean anything, because a betting record without a sample-size caveat is decoration.

**Odds board** — one row per candidate play across the whole slate, ranked by expected value rather than kickoff time. Filter by market, restrict to reduced-juice books, set a minimum EV bar. Each row shows the model's probability, the book's no-vig probability, the edge in points, EV, and a fractional-Kelly stake.

**Model lab** — every assumption is a slider: home field advantage, Elo-to-points conversion, margin standard deviation, rest, preseason shrink, devig method, Kelly fraction, bankroll. Move one and the entire app re-prices instantly.

**Teams** — two views of the same 32 clubs answering different questions. *Standings* is how last season finished: record, seed, how far they went. *Power* is how good the model thinks each team is now, ranked across the whole league, which is the number every projection is built from.

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
VITE_ODDS_BOOKS=draftkings,fanduel,betmgm,pinnacle
```

**Live odds** are connected in the app, not in the build: open **Model lab** and paste a free key from [the-odds-api.com](https://the-odds-api.com). The key is stored in your browser only. This is deliberate — the app deploys as a static site, so a key baked in at build time would be readable by anyone who visits. Remaining API quota is shown next to the field so the free tier does not run out invisibly.

Odds API events are matched to the slate on the two teams plus a kickoff within 36 hours, since its event IDs will never line up with ESPN's. Any game that cannot be matched keeps simulated prices and is reported in a banner. Books that have not posted a given market are dropped from that market rather than filled in with a placeholder.

**Back up your record.** Locked cards and graded results live in this browser only — Model lab has Export and Import. The export deliberately omits the API key.

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

### Keeping the ratings current

Opening ratings are only a starting point. As the season is played, the app fetches every finished game and **replays** them onto the opening ratings in chronological order, applying the margin-aware Elo update.

The rule is that ratings are always rebuilt from the opening values plus the full result set — never mutated in place. Incremental mutation looks cheaper and is a trap: a game applied twice, or out of order, silently corrupts the ratings with no way to notice or undo it. A full replay is deterministic and auditable, and a season is only a few hundred games.

Preseason results are excluded, since they say almost nothing about a roster. Real points scored and allowed replace the synthetic figures once a team has eight games, blended in gradually before that. Teams shows how far each club has moved since opening, and says plainly whether it is showing current or opening ratings.

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
│   ├── ratings.js          replaying results onto the opening ratings
│   ├── props.js            touchdown props: Poisson, field devig, priors
│   ├── backup.js           export and import of cards, results and settings
│   ├── grading.js          settling locked cards, record, significance
│   ├── boxscore.js         grouping and parsing ESPN's flat stat dump
├── components/             shell, ticker, game card, Edge Rail, charts, slip
├── views/                  scores, card, game, odds board, teams, model lab
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
