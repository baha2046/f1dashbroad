# Project Review & Enhancement Plan — 2026-07-04

Scope: full review of the F1 Data Dashboard (Quart backend `app.py`, frontend
`static/js/dashboard.js` / `static/css/styles.css` / `templates/index.html`,
test suite in `tests/`), followed by a prioritized enhancement roadmap.

Status at review time: `main` clean, 45/45 tests passing.

---

## 1. What is working well

- **Backend architecture.** Quart + httpx async stack is a good fit for an
  API-proxy dashboard. The tiered cache (permanent for historical sessions,
  5-min TTL for live, 1-hour for session listings, stale-cache fallback on
  upstream failure) is the strongest part of the codebase.
- **Zero-dependency frontend.** Vanilla JS + raw SVG keeps the deploy story
  trivial (no build step) and the charts are already feature-rich
  (zoom/pan, outlier filtering, pit annotations, qualifying phases).
- **Test discipline.** 45 tests covering compare charts, standings, race
  control, retry logic — including the Node-subprocess pattern for testing
  JS helpers. Design/plan docs in `doc/` give a clear decision trail.

## 2. Issues found

### 2.1 Security (fix first)

- **Path traversal via query params.** `session_key`, `driver_number`,
  `meeting_key`, `year`, `round` are interpolated directly into cache file
  names, e.g. `cache_name = f"laps_{session_key}_{driver_number}.json"`
  (app.py:469). A request like
  `GET /api/laps?session_key=../../somefile` reads/writes outside
  `data_cache/`. The same params are also interpolated into upstream URLs,
  allowing query-string injection toward OpenF1.
  **Fix:** validate all of these as `int` (or whitelist-pattern for `date`)
  at the top of each route; return 400 otherwise.
- **API key sprayed across four header names** (`Authorization`, `x-api-key`,
  `api-key`, `apikey`) in `fetch_url` (app.py:172-176). Use only the header
  OpenF1 actually documents.
- **Debug server in `__main__`.** `app.run(debug=True)` on `0.0.0.0`
  (app.py:598). Fine for dev, but the deployment guide should be the only
  production path (hypercorn); consider gating `debug` on an env var.

### 2.2 Correctness / robustness

- **Blocking file I/O inside async handlers.** Every cache read/write is
  synchronous `open()`; `find_session_year` (app.py:60) scans the entire
  cache directory (353+ files) on every `/api/drivers` miss. Under
  concurrent load this stalls the event loop.
- **Cache stampede.** N simultaneous requests for an uncached key all fetch
  from OpenF1. Add a per-cache-key `asyncio.Lock` so only one fetch flies.
- **Non-atomic cache writes.** A crash or concurrent write mid-`json.dump`
  leaves a truncated file (silently treated as cache miss forever after,
  refetched every request). Write to a temp file then `os.replace`.
- **Silent error swallowing.** `get_cached_api` returns `[]` and
  `get_cached_jolpica_api` returns `{}` on failure, so the frontend cannot
  distinguish "no data" from "upstream down". Return a 502/503 with a body
  the frontend can render as a banner (the live-restriction banner pattern
  already exists and could be reused).
- **Hardcoded 2026.** `find_session_year` default, `is_historical`,
  and the TTL checks (`int(year) >= 2026`, `"sessions" in cache_name`) all
  pin the current season. This silently breaks caching semantics in 2027.
  Use `datetime.now(timezone.utc).year` in one place.

### 2.3 Maintainability

- **`dashboard.js` is a 4,932-line monolith** (plus 3,288 lines of CSS).
  It has grown ~5x over the feature history and each new tab makes it worse.
  Since there is no build step, split into native ES modules
  (`<script type="module">`): `api.js`, `state.js`, `charts/`, `tabs/`.
- **Duplicated constants across backend and frontend.**
  `NATIONALITY_TO_FLAG` exists in both app.py:18 and dashboard.js:1670;
  `COUNTRY_FLAGS`/`TEAM_COLORS` live only in JS but overlap conceptually.
  Single source of truth: keep them in the backend and expose once via a
  small `/api/meta` endpoint, or keep them in one shared JS module and have
  the backend stop duplicating flags (it only needs them for `/api/drivers`
  enrichment — that could move client-side).
- **Eight nearly identical proxy routes** (`/api/weather`, `/api/laps`,
  `/api/stints`, `/api/pit`, `/api/position`, `/api/results`,
  `/api/race_control`, `/api/drivers` core). Replace with one generic
  route factory driven by a `{name: openf1_endpoint}` table; keeps
  `drivers` and `race_standings` as the only bespoke handlers.
- **Unbounded cache growth.** `data_cache/` is already 11 MB / 353 files.
  Add a simple eviction pass (e.g. on startup, delete non-permanent entries
  older than N days) or a max-size cap.
- **Shared httpx client.** A new `AsyncClient` is created per request; use
  one app-lifetime client (`app.before_serving`) for connection pooling.

## 3. Enhancement roadmap

### Phase 0 — Hardening (small, do before new features)
1. Integer/format validation of all query params (closes path traversal).
2. Shared `httpx.AsyncClient` with connection pooling.
3. Atomic cache writes (`tempfile` + `os.replace`) and per-key fetch lock.
4. Async file I/O (`asyncio.to_thread` around cache read/write is enough).
5. Surface upstream failures as HTTP errors + frontend banner.
6. Derive "current season" from the clock; remove hardcoded 2026.

### Phase 1 — Code health
1. Generic proxy route factory for the eight OpenF1 endpoints.
2. Split `dashboard.js` into ES modules; split `styles.css` per-tab.
3. Deduplicate flag/team-color maps into a single source of truth.
4. Cache eviction policy + `data_cache` size logging.
5. Add gzip (`quart-compress` or hypercorn config) and `Cache-Control`/ETag
   headers on `/api/*` responses — the JSON payloads (laps, position) are
   large and highly compressible.

### Phase 2 — Features (highest user value first)
1. **Live mode.** Auto-refresh the active session: poll `/api/position` +
   `/api/intervals` + `/api/race_control` on the existing 5-min (or
   tighter) TTL, with a visible "LIVE" indicator and countdown. OpenF1's
   `intervals` endpoint is not consumed yet and is the natural data source
   for live gaps.
2. **Championship progression chart.** The Jolpica standings integration
   already fetches per-round standings; plot points-per-round lines for
   drivers/constructors across the season (reuses the SVG chart engine).
3. **Car telemetry deep-dive.** OpenF1 `car_data` (speed, throttle, brake,
   gear, DRS) for a selected lap — speed trace chart on the Laps tab.
   Needs date-range querying and downsampling; cache permanently for
   historical sessions.
4. **Track position replay.** OpenF1 `location` data animated on the
   existing circuit SVG map — a lap/race replay scrubber. Flashiest
   feature; also the heaviest data volume, so scope to single-lap replay
   first.
5. **Team radio.** OpenF1 `team_radio` returns audio URLs; add a playable
   feed alongside Race Control.
6. **Weather trend chart.** The weather widget shows the latest sample;
   the endpoint returns a full time series — plot air/track temp and
   rainfall over the session.

### Phase 3 — Ops & polish
1. Mobile/responsive pass (the compare charts especially) + PWA manifest.
2. Export: chart-as-PNG (serialize the SVG) and lap-table-as-CSV.
3. Deployment hygiene: env-gated debug, hypercorn systemd unit already in
   the Ubuntu guide — add a health-check endpoint (`/api/health`).
4. CI: run the unittest suite on push (GitHub Actions).

## 4. Suggested execution order

Phase 0 is one focused PR (backend only, low regression risk, testable —
add tests for param validation and the fetch lock). Phase 1 items 1–3 are
each an independent PR. Phase 2 features should each follow the existing
design-doc → plan → implement flow in `doc/`; recommend starting with the
championship progression chart (smallest lift, reuses everything) and
live mode (most visible value during race weekends).
