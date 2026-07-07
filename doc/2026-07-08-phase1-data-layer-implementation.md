# Phase 1 — Data-Layer Performance Implementation Notes (2026-07-08)

Implements Phase 1 of doc/2026-07-07-project-review-and-enhancement-plan.md,
plus the two accepted findings from the Phase 0 cross-model review.
Suite: 266 tests passing.

## Phase 0 review follow-ups

- `loadSessions()` now also bumps `sessionLoadSequence`, so a year switch
  invalidates any in-flight `selectSession()` (a stale detail load could
  otherwise repaint the dashboard the year switch had hidden).
- `enrich_results_with_jolpica` accepts `session_type == "Sprint"` alongside
  Livetiming's usual `"Race"` typing, and derives `is_sprint` from type or
  name. (The third review finding — UTC-midnight date mismatch — was checked
  against real data and dismissed: Jolpica/Ergast dates are UTC, e.g. Las
  Vegas GP `date 2026-11-22, time 04:00:00Z`, matching our UTC `date_start`.)

## 1. Raw feed cache (`fetch_livetiming_feed_cached`)

Raw Livetiming feeds are now cached on disk per session+feed as
`raw_{session_key}_{feed}_{stream|keyframe}.json.gz`, gzip level 6, with the
same liveness TTLs as normalized payloads (30 s live / 5 min recent /
permanent historical) via the extracted `session_cache_ttl()`. All heavy
consumers go through it: the endpoint factory, laps reconstruction
(TimingData + SessionStatus), the Heartbeat stream anchor, `/api/car_telemetry`
(CarData.z) and `/api/track_replay` (Position.z).

Effect (measured against the live server, British GP race):
- track_replay uncached lap: 4.8 s cold (one-time upstream download) →
  1.1 s for every subsequent uncached lap (raw cache hit)
- car_telemetry uncached lap: 7.0 s → 1.1 s
- a cold session load no longer downloads the TimingData stream 4×
  (position/intervals/results/laps all reuse the raw copy)

Note: records round-trip through JSON, so `(timestamp, payload)` tuples come
back as 2-element lists — all normalizers unpack both.

## 2. CPU work off the event loop

- `fetch_livetiming_stream` parses the line-delimited stream in
  `asyncio.to_thread` (streams reach tens of MB).
- `flatten_car_data_z` / `flatten_position_z` list materialization and the
  laps/endpoint normalizers run via `to_thread`.
- gzip cache reads/writes are `to_thread` too.

## 3. Degraded payloads are never cached permanently

`fetch_livetiming_feed` gained a `meta` out-param: a requested stream that
falls back to its keyframe snapshot sets `meta["degraded"]`. A missing
Heartbeat anchor (timestamps then anchored to the advertised session start)
marks payloads degraded as well. `DegradedPayload` wrappers flow through
`get_cached_livetiming` / the raw cache, which skip the write when the cache
slot would be permanent (historical session) — degraded data still serves the
request but is retried next time. Tests cover both layers.

## 4. Year threading

All session-scoped endpoints accept an optional `year` (400 on garbage);
`sessionYearParam()` (01-state-helpers.js) appends it on every frontend call
(session load, live polling, replay context, laps, telemetry, track replay).
With the year present the backend skips `find_session_year`'s cache-directory
scan and — crucially — stops mis-resolving evicted sessions to the current
year. Omitting the year keeps the old behavior (API compatibility).

## 5. Liveness-aware Cache-Control

`session_response()` sets per-payload headers: `no-store` while the session
is live (live mode polls every 30 s; intermediaries must not serve stale
positions), `public, max-age=3600` for historical sessions, `max-age=60`
otherwise. The blanket `after_request` default only applies where a handler
didn't set one.

## Test notes

- `fetch_livetiming_feed` mocks now need `meta=None` in their signatures;
  call assertions include `meta={}`.
- `test_successful_fetch_writes_cache_atomically` gained a real Heartbeat
  fixture — with a TimingData-shaped Heartbeat the payload is correctly
  degraded and (by design) not permanently cached.
- New: tests/test_phase1_data_layer.py (raw cache hit/skip, degraded
  semantics at both layers, cache headers, year threading).
