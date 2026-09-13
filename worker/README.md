# ESPN stats proxy

Un-blocks one endpoint for the browser: ESPN's `/athletes/{id}/stats` feed,
which has real per-player season rates (receiving yards, carries, targets,
...) but refuses cross-origin `fetch()` calls — confirmed live, a static
CORS policy on ESPN's side. Visiting the URL directly in a tab works fine;
the app calling it from its own origin does not, and no amount of retrying
or rewriting the request on the client side changes that, because CORS is
enforced by the browser, not by how the request is written.

This worker runs the same request server-side, where that restriction
doesn't apply, and re-serves the JSON with the header the browser needs.
It's the only thing that unblocks real yardage/volume rates — without it,
those markets fall back to a league-average estimate (see `VOLUME_PRIORS`
in `src/lib/props.js`), which is honest but not this player's own numbers.

It is entirely optional. The app works without it; it just estimates
yardage props instead of using real per-player rates.

## Deploy it (free — Cloudflare Workers' free tier covers this easily)

1. [Sign up for Cloudflare](https://dash.cloudflare.com/sign-up) if you
   don't have an account (no credit card needed for the free tier).
2. Install Wrangler, Cloudflare's CLI, if you don't have it:
   ```
   npm install -g wrangler
   ```
3. From this directory, log in and deploy:
   ```
   cd worker
   wrangler login
   wrangler deploy
   ```
4. Wrangler prints the worker's URL when it finishes, something like
   `https://gridiron-edge-espn-proxy.<your-subdomain>.workers.dev`.
5. Paste that URL into **Model Lab → Stats proxy** in the app. That's it —
   the Props tab and the Card's prop-play check will start using it
   automatically the next time they load rosters.

## Locking it down (optional, recommended once you know your app's URL)

By default `wrangler.toml` sets `ALLOWED_ORIGIN = "*"`, so the worker
answers requests from any site. That's fine to start with, but anyone who
finds the worker's URL can use it too, spending your request quota. Once
you know where the app itself is deployed (e.g. your GitHub Pages URL),
change it:

```toml
[vars]
ALLOWED_ORIGIN = "https://<your-username>.github.io"
```

and run `wrangler deploy` again.

## What it does and doesn't do

- Only proxies `GET /athletes/{id}/stats` — nothing else. It is not a
  general-purpose relay for arbitrary URLs, deliberately: that would be a
  much bigger liability (abuse, another site routing traffic through your
  worker) for no benefit this app needs.
- Tries both of ESPN's public hosts before giving up, matching the app's
  own fallback behaviour elsewhere.
- Caches each athlete's response at Cloudflare's edge for an hour. A
  player's season stats don't change faster than that, so this cuts
  repeat load on ESPN's feed and on your own request quota for free,
  without ever serving data that's stale within the same game week.

## Testing it locally

`npm test` from the repo root runs `espn-proxy.test.js` alongside the
rest of the app's tests — it mocks `fetch` rather than calling ESPN, so it
needs no network access and no deployed worker.

To try it against the real ESPN feed before deploying:

```
cd worker
wrangler dev
```

then visit `http://localhost:8787/athletes/4361741/stats` (a real ESPN
athlete ID) in a browser.
