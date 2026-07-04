# Phase 1 Code Health — Implementation Note (2026-07-04)

Implements Phase 1 of `doc/2026-07-04-project-review-and-enhancement-plan.md`.
No user-visible feature changes; verified in-browser (session load, drivers
grid, compare charts, standings, race control) with zero console errors.

## 1. Generic proxy route factory (`app.py`)

The six identical session-scoped routes (`/api/weather`, `/api/stints`,
`/api/pit`, `/api/position`, `/api/results`, `/api/race_control`) are now
generated from the `OPENF1_SESSION_ENDPOINTS` table via
`_make_session_endpoint()` + `app.add_url_rule`. Cache file names are
unchanged (`<route>_<session_key>.json`). `/api/laps` (extra
`driver_number` param), `/api/drivers` (enrichment) and
`/api/race_standings` (Jolpica) remain bespoke handlers.

## 2. JS split (`static/js/`)

`dashboard.js` (4,932 lines) is split at function boundaries into nine
files loaded in order by `templates/index.html`, all sharing the global
scope — the concatenation was verified byte-identical to the original
before functional edits, so runtime semantics are exactly preserved:

| File | Contents |
|---|---|
| 01-state-helpers.js | state, constants (COUNTRY_FLAGS, TEAM_COLORS), formatters |
| 02-dom.js | `DOM` element map |
| 03-api-settings.js | `customFetch`, banners, API key panel, `setupEventListeners`, init |
| 04-sessions-sidebar.js | session list, filter/search, autofocus |
| 05-session-load.js | `selectSession`, data loading, qualifying axis, pit annotations |
| 06-overview-tabs.js | header, weather, circuit, results, standings, race control |
| 07-driver-grids.js | drivers grid, laps sidebar, compare selector/toggles |
| 08-compare-charts.js | compare chart engine (all five charts, zoom/crosshair) |
| 09-laps-tab.js | laps & stints tab, lap chart, loading helpers |

Deliberate deviation from the plan: ordered classic scripts instead of ES
modules. Everything shares one implicit state/DOM namespace; converting to
real modules means threading exports/imports through ~150 functions and is
better done gradually per-file later. This split gets the maintainability
win (small files, clear ownership) with zero runtime risk. The
`??v=` cache-buster typo in the script tag was fixed in passing.

`styles.css` was NOT split (deferred): pure churn until the JS module
boundaries settle.

Tests that assert on dashboard JS source now read the concatenation of
`static/js/*.js` (sorted = load order) via `tests/js_sources.py`.

## 3. Flag map dedupe

`NATIONALITY_TO_FLAG` existed in both `app.py` and the frontend. Flags are
purely presentational, and the frontend map is the richer one (country
names + demonyms, needed for Jolpica standings), so the frontend is now the
single source of truth:

- `app.py` no longer defines the map nor sets `nationality_flag` on
  `/api/drivers` (it still passes through `nationality`, `birthday`,
  `wiki_url`, `driver_id`).
- The two consumers of `nationality_flag` (drivers grid, laps-tab profile
  header) now call the existing `getNationalityFlag(d.nationality)`.

## 4. Cache eviction + size logging (`app.py`)

On startup (`before_serving`), `_evict_cache_if_over_limit()` logs the
cache file count/size and, if the total exceeds `F1_CACHE_MAX_MB`
(default 512 MB), deletes oldest-mtime files until under the limit.
Evicted historical files are simply refetched on demand.

## 5. gzip + Cache-Control (`app.py`)

`after_request` on `/api/*`: sets `Cache-Control: public, max-age=60` and
`Vary: Accept-Encoding`; gzips 200-responses ≥ 1 KB when the client
accepts gzip (compression runs in a thread). A cached 1,002-lap payload
round-trips correctly in-browser. ETag support deferred — short max-age
covers the browser-refresh case; revisit alongside live mode in Phase 2.

## Tests

- New: `tests/test_phase1_maintenance.py` — factory route registration,
  gzip + Cache-Control headers (with decompression round-trip), no
  compression for small/identity requests, eviction ordering, no-op under
  limit.
- Updated: static-wiring tests read concatenated JS via
  `tests/js_sources.py`; the two `@app.route(...)` source-text assertions
  became `url_map` + registry assertions.
- Suite: 66 tests, all passing.
