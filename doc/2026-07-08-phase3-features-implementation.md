# Phase 3 — Features Implementation Notes (2026-07-08)

Implements Phase 3 of doc/2026-07-07-project-review-and-enhancement-plan.md.
Suite: 290 tests passing.

## 1. Dynamic season/year handling

- `/api/years` probes the Livetiming archive per season (the root Index.json
  only lists the current year, and the archive is irregular — 2022 is
  missing upstream). Probes `current+1` down to 2018 with concurrency 4;
  result cached 24 h; offline fallback (last 4 seasons) is served but never
  cached, so the next request re-probes.
- `initYearSelector()` (03-api-settings.js) replaces the hardcoded HTML
  buttons with the probed list on boot; the static buttons remain as the
  instant/offline fallback. `.year-selector` wraps to multiple rows.
- Verified live: 8 seasons render (2018–2021, 2023–2026), 2022 correctly
  absent, and 2019 loads its 105 sessions end-to-end. Next January, 2027
  appears without a template edit — the review's original complaint.

## 2. Results tab polish

- `merge_jolpica_results` carries Jolpica's `FastestLap` (rank-1 only) into
  `fastest_lap` / `fastest_lap_time` / `fastest_lap_number`.
- The Results tab renders a purple `FL` pill next to the driver's name with
  time and lap in the tooltip. Podium position styling already existed
  (pos-podium-1/2/3).
- Verified live: Silverstone shows FL on Antonelli — "1:31.777 (lap 37)".

## 3. SignalR live streaming — foundation

Design: doc/2026-07-08-signalr-live-mode-design.md.
Plan (remaining work tracked as checkboxes): doc/2026-07-08-signalr-live-mode-plan.md.

Landed now: `livetiming_signalr.py` (negotiate/connect/subscribe primitives,
frame classifier, `record_from_update` converting hub deltas into the
`(elapsed, payload)` record shape the existing normalizers consume — proven
by an interop test through `normalize_livetiming_weather` — plus
`SignalRClient` with reconnect backoff and a fixture-recording CLI), and
`tests/test_livetiming_signalr.py`.

Deliberately deferred to the next race weekend: recording real hub traffic,
fixture-backed validation, and wiring the `LiveFeedStore` into the cache
layer behind `F1_LIVE_SIGNALR=1`. The integration can only be meaningfully
verified against a live session, and none exists until then; static-feed
polling remains the (working) fallback in all cases.

## 4. Sequencing notes (ES modules / test modernization)

The ES-modules refactor (Phase 3 item 4) is intentionally not started here:
the current test suite pins concatenated global-scope source and would give
weak coverage for an import-graph rewrite. Order of operations going
forward: land a jsdom/Vitest (or node:test) harness for behavior-level
frontend tests first (item 5), then convert files to ES modules under that
coverage, then build the SignalR frontend push (SSE/live track map) as the
first feature on the new architecture.
