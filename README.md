# MercedTime

A replacement front-end for UC Merced's Banner 9 registration pages, shipped as a
Chrome MV3 extension.

## What it is

Banner is five databases behind five forms, and the question a student actually has —
*what should I take, may I take it, does it fit, and can I register yet?* — spans all
of them. Term is server-side session state, so every hop resets your world.

MercedTime replaces the read surfaces with one app where your own state is ambient and
term is a client-side filter. **It never writes.** Add, drop and submit stay on
Banner's own page behind a single "Register →" button, because those endpoints are a
state machine with conditional interstitials and the failure modes cost real seats.

## Build

```bash
npm install
npm run build      # or: npm run watch
npm run check      # offline checks: schedule maths, loader, generator, downloads
```

Load `dist/` as an unpacked extension. A service worker redirects
`/ssb/registration` (the Banner menu) to its own page (`dist/app.html`) with `webNavigation`; no content script
runs on Banner pages. The "Not signed in" link sends the tab through Banner's login and
the service worker returns it to the app once it lands back on Banner.

## Layout

```
src/
  main.jsx            shadow-root mount for dist/app.html
  App.jsx             shell: masthead, hash router, notification mirror
  lib/api.js          every network call; owns the four session failure modes
  lib/sections.js     pure Banner data logic — bundles, seats, tiers, search ranking
  lib/banner.js       parses Banner's server-rendered status HTML
  lib/store.js        shared state, plan persistence, and the catalog downloader
  lib/audit.js        reads the uAchieve degree audit (HTML) from the student's session
  lib/degree.js       audit logic: ids, course keys, what a plan would meet
  lib/cache.js        IndexedDB store for downloaded terms (survives restarts)
  lib/courses.js      course options for a term from earlier terms of its season
  routes/             Home, Search, Plan, Schedule (built); Standing / History (stubs)
fixtures/             offline test data — see below
scripts/              the scrapers that produced the fixtures
```

## Fixtures

`fixtures/` exists so the fragile parts can be tested with no session and no network:

- `banner-api-reference.md` — the endpoint/session audit. The most valuable file here.
- `sections-202630.json` — a full term (1733 sections) for search and grouping.
- `banner-pages/` — a saved Banner page **with its real stylesheets**. This is what
  makes host-CSS regressions testable: Banner ships
  `input, .combo, select { height: 20px }`, which used to clip our dropdown text.
  Rendering against these files reproduces that class of bug offline.

## Things that will bite you

1. **Any 500 tears down the session.** The failing call returns its 500 normally; the
   *next* authenticated call bounces to re-auth. `getPlans` and `contactCard/retrieveData`
   return 500 at UCM in every context — never call them. `api.POISONED` enforces this.
2. **`fetch` does not reset Banner's idle timer.** Banner hooks jQuery's `ajaxSend`,
   which we never touch, so a 25-minute session dies under an actively-used app.
   `api.startKeepAlive()` handles it.
3. **`saveTerm` is keyed by mode.** Priming `search` does nothing for a page in
   `courseSearch`. Mismatches produce empty results and no error.
4. **Endpoint URLs are not literals in Banner's bundles** — they live in
   `data-endpoint` attributes read at call time. Grepping finds nothing; enumerating
   `[data-endpoint]` on a loaded page finds all 54. Do not probe them blindly (see 1).
