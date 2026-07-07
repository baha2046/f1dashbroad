# Project Review & Enhancement Plan — 2026-07-07

Scope: full review of the F1 Data Dashboard after the Livetiming migration —
backend (`app.py`, `livetiming_client.py`, `livetiming_compat.py`), frontend
(`static/js/01..12-*.js`, `static/css/styles.css`, `templates/index.html`),
and the test suite in `tests/`. Findings were cross-checked with an
independent gpt-5.5 (Codex) review; agreements are merged below.

Status at review time: `main` at 4961ad2, **248 tests, 2 failing** (see 2.1).
The previous review (2026-07-04) has been fully executed: Phase 0 hardening
(param validation, atomic cache writes, per-key fetch locks, shared httpx
client, gzip, eviction), the generic endpoint factory, live mode, car
telemetry, championship progression, track/full-race/full-qualifying replay,
team radio, and the OpenF1 → Livetiming migration are all in.

---

## 1. What is working well

- **The Livetiming compatibility layer.** `livetiming_client.py` +
  `livetiming_compat.py` cleanly isolate stream parsing/`.z` decoding from
  normalization, and keeping the OpenF1-shaped `/api/*` contract meant the
  frontend survived the migration untouched. The delta-merge lap
  reconstruction (`normalize_livetiming_laps`) is genuinely hard to get right
  and is well-commented.
- **Cache engine.** Tiered TTLs (permanent historical / 30 s live / 5 min
  recent / 1 h listings), stale fallback, atomic writes, per-key stampede
  locks, startup eviction with a size cap. This is the strongest subsystem.
- **Endpoint factory.** `LIVETIMING_SESSION_ENDPOINTS` collapsed nine routes
  into config — exactly what the last review asked for.
- **Feature density with zero build tooling.** Live mode, three replay modes,
  team radio playback, telemetry strips — all in vanilla JS/SVG with no
  dependencies.
- **Decision trail.** `doc/` design/plan pairs per feature make the history
  auditable.

## 2. Issues found (prioritized)

### 2.1 Red HEAD: 2 failing qualifying-replay tests

`extractQualifyingPhases()` adds a 3-minute cooldown to each phase end
(`ms + 180000`, static/js/10-track-replay.js:617 — "let them finish the last
lap and back to pit") but `test_extract_qualifying_phases_spans_red_flag_pauses`
and `test_full_session_timeline_slices_phases_and_labels_regions` still expect
phases to end exactly at `Finished`. Both the tweak and the tests were
committed together in 4961ad2. Decide the semantics (the cooldown is
reasonable), extract `REPLAY_PHASE_COOLDOWN_MS`, apply it consistently (the
open-phase/live branch does not get the cooldown), and update the tests.

### 2.2 Correctness

- **Partial TimingData deltas erase live gaps.**
  `normalize_livetiming_intervals` (livetiming_compat.py:368) emits a row for
  *every* driver delta even when `IntervalToPositionAhead`/`GapToLeader` are
  absent, so the row carries `interval: null`. `buildLiveTimingRows`
  (static/js/11-live-mode.js:39) and the replay gap lookup
  (static/js/12-replay-context.js) take the latest row per driver by date —
  a later position-only delta replaces a valid gap with `null`. Fix in the
  normalizer: only emit rows when a gap field is present, or carry the last
  known value forward per driver.
- **Race results lost points/DNS/DSQ in the migration.**
  `normalize_livetiming_results` (livetiming_compat.py:444) hardcodes
  `points: None`, `dns: False`, `dsq: False`, while the Results tab renders
  all of them (static/js/06-overview-tabs.js:424-520) — race points now show
  "-". Enrich completed-race results from Jolpica (`.../results.json` is
  already within the cached-Jolpica pattern) or compute points from
  classification.
- **Stale-response races on session switch.** `selectSession()`
  (static/js/05-session-load.js:2) resets state, awaits a 13-request
  `Promise.all`, then writes state without checking the selection is still
  current — a slow older selection can overwrite a newer one. `loadSessions()`
  has the same year race (static/js/04-sessions-sidebar.js:108). Live mode
  already implements the guard pattern (11-live-mode.js:142); apply a request
  token to both loaders.
- **Silent fallbacks can permanently cache wrong historical data.**
  `fetch_livetiming_feed` (app.py:381) falls back stream → keyframe on any
  stream error, and `fetch_livetiming_stream_start` (app.py:411) falls back
  to the advertised session start (which is by definition not the stream
  anchor). Either produces shifted timestamps / snapshot-only data that
  `get_cached_livetiming` then caches *forever* for historical sessions.
  Fallback results should be cached with a short TTL (or flagged) instead.
- **Wrong-year session resolution.** `find_session_year` (app.py:230)
  returns the *current* year when no cached `sessions_*.json` contains the
  key (e.g. after eviction, or direct API use), sending lookups to the wrong
  year index. The frontend knows the year — pass it on all session-scoped
  calls and thread it through cache-TTL decisions (app.py:872, app.py:988
  call `get_session_info` without a year).
- **Delta normalizers assume well-formed entries.** Race-control and
  team-radio normalizers call `.get()` on collection items without
  `isinstance` guards (livetiming_compat.py:282, :335 — session_status has
  the guard); `iter_timing_lines` casts line keys with bare `int()`
  (livetiming_compat.py:350). A `_deleted` marker or malformed delta can 500
  an endpoint.
- **Lap rows are never revised.** `normalize_livetiming_laps` only trusts
  `LastLapTime` delivered in the same delta as the `NumberOfLaps` increment;
  if it arrives one record later, the wall-clock fallback duration sticks.
  Low frequency, worth a follow-up pass that patches the previous row.

### 2.3 Performance / scalability

- **Full-stream refetch amplification (biggest win available).** Raw feeds
  are never cached — only normalized outputs. One cold historical session
  load downloads and parses the full TimingData stream ~4× (position,
  intervals, results, laps), plus Heartbeat per endpoint for the stream
  anchor. Worse: every `/api/car_telemetry` and `/api/track_replay` cache
  miss re-downloads and re-decodes the *entire* `CarData.z`/`Position.z`
  stream (tens of MB late-race) for one lap window — full-qualifying replay
  multiplies this across ~15 slices per phase. Add a session-scoped raw feed
  cache (fetched stream text or parsed records on disk, permanent for
  historical sessions) and slice locally.
- **CPU-heavy decode on the event loop.** base64/zlib/JSON for `.z` feeds and
  large stream parses run inline in handlers; under concurrency this stalls
  the loop. Wrap in `asyncio.to_thread` alongside the raw-feed cache.
- **`Cache-Control: public, max-age=60` fights live mode.** Every `/api/*`
  response gets it (app.py:133) while live mode polls every 30 s — a browser
  or Apache layer can legally serve stale live positions. Vary the header by
  liveness: `no-store` (or `max-age=5`) for live sessions, long `max-age` +
  `immutable`-ish for historical payloads.
- Minor: `_stream_start_cache` (app.py:409) grows unbounded (one entry per
  session — harmless in practice); eviction runs only at startup, while live
  weekends generate many replay-window files; the per-key fetch locks are
  per-process, so the 2-worker hypercorn deployment can still double-fetch.

### 2.4 Security / hygiene

- **Unescaped `innerHTML` interpolation.** `escapeHtml()` exists and is used
  in newer code (live timing, race control), but driver cards interpolate
  names/teams/wiki URLs raw (static/js/07-driver-grids.js:40), results and
  standings rows interpolate driver/team/headshot fields
  (06-overview-tabs.js), and session cards interpolate meeting/location
  labels (04-sessions-sidebar.js). All of it is upstream-controlled data
  (Livetiming, f1api.dev, Jolpica), so the risk is a compromised/poisoned
  upstream — still worth closing systematically: escape every interpolation
  (incl. attribute contexts like `href`/`src`/`title`) and add a CSP header.
- `print()` is the only logging; switch to the `logging` module with levels
  so the systemd journal is filterable.

### 2.5 Maintainability

- **Global-scope script ordering is fragile.** The 12-file split helped, but
  everything still shares one global scope with `typeof fn === 'function'`
  guards sprinkled where load order is uncertain. The ES-modules refactor
  from the last review remains pending and gets more expensive with each
  feature.
- **Source-shape tests.** Many frontend tests `assertIn` source snippets or
  extract function bodies by brace counting (tests/js_sources.py,
  test_session_replay_tab.py:89). They break on rename/reformat and pass on
  behavior regressions. The Node-subprocess behavior tests are the good
  pattern — grow those; longer term, jsdom/Vitest (or node:test) once ES
  modules land.
- Hardcoded season: year buttons 2023–2026 in templates/index.html:32 and
  `selectedYear: '2026'` in 01-state-helpers.js — generate from the backend's
  `current_season_year()` instead.

## 3. Enhancement roadmap

### Phase 0 — Restore green + correctness (small, do first)
1. Resolve the qualifying-phase cooldown: named constant, consistent
   application, updated tests. **Gets HEAD back to 248/248.**
2. Fix interval-null overwrite in `normalize_livetiming_intervals`.
3. Request tokens for `selectSession()`/`loadSessions()`.
4. Results enrichment: points/DNS/DSQ from Jolpica race results for
   completed Races/Sprints.

### Phase 1 — Data-layer performance
1. Session-scoped raw feed cache (TimingData, CarData.z, Position.z,
   Heartbeat) with local slicing for telemetry/replay; permanent for
   historical sessions, short TTL while live.
2. Move `.z` decode + stream parse off the event loop (`asyncio.to_thread`).
3. Thread `year` through all session-scoped API calls and cache decisions;
   stop defaulting to the current year.
4. Liveness-aware `Cache-Control`; don't cache fallback-derived payloads
   permanently.

### Phase 2 — Hardening
1. Systematic HTML escaping (attribute contexts included) + CSP header.
2. `isinstance` guards / `_deleted` handling in all delta normalizers.
3. `logging` module adoption; periodic (not just startup) cache eviction.

### Phase 3 — Features (highest user value first)
1. **SignalR live streaming** — the migration plan's declared next step:
   subscribe to the Livetiming SignalR hub during live sessions for
   push-based updates (and a true live track map) instead of 30 s polling.
2. **Race results tab polish** — official classification with points,
   podium highlights, fastest-lap marker (falls out of Phase 0.4 data).
3. **Dynamic season/year handling** — year selector generated from
   available Livetiming indexes; removes the annual manual edit.
4. **ES modules refactor** — carry-over; do it before the next large
   frontend feature, not after.
5. **Test-suite modernization** — replace source-shape assertions with
   behavior tests as files are touched; add a JS test runner once modules
   land.
