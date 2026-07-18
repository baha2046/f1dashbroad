# SignalR Core Live Integration — Implementation (2026-07-18)

Implements Task 3 of doc/2026-07-08-signalr-live-mode-plan.md (LiveFeedStore
+ cache integration behind `F1_LIVE_SIGNALR=1`), plus the protocol migration
that Task 2's validation surfaced, and a live-session path-resolution fix.
Written during the Belgian GP weekend: FP3 exposed that live mode had never
actually worked (see "Why live mode was broken" below).

## Why live mode was broken

During FP3 every session-scoped endpoint returned 502. Root causes, verified
against livetiming.formula1.com during the session:

1. **The static archive does not exist while a session runs.** The year
   `Index.json` lists the session with `Path: null`, and the per-session
   feed files 403 until `ArchiveStatus` flips from `Generating` to complete
   (~30 min after the chequered flag). Polling static feeds every 30 s — the
   pre-existing live mode — can never show in-session data.
2. **The legacy SignalR hub is gone.** `/signalr/negotiate` (protocol 1.5,
   as described in the 2026-07-08 design doc) now answers
   `401 WWW-Authenticate: Basic/Bearer`. Livetiming moved to ASP.NET Core
   SignalR at `/signalrcore` around the 2025 Dutch GP timeframe, when parts
   of live timing went behind F1 TV authentication.

## What changed

### livetiming_signalr.py — protocol migration to SignalR Core

- Negotiate: `POST /signalrcore/negotiate?negotiateVersion=1` (anonymous
  works; optional `Authorization: Bearer <F1 TV token>`), reply carries
  `connectionToken` + AWSALB affinity cookies that must be replayed on the
  websocket or the ALB routes the connection to a node that doesn't know it.
- Connect: `wss://livetiming.formula1.com/signalrcore?id=<token>`
  (+`access_token=` when a token is configured).
- Handshake `{"protocol":"json","version":1}\x1e`, then Subscribe as a hub
  invocation; the completion (`type:3`) carries the full per-feed snapshot.
  Feed deltas arrive as `type:1 target:"feed"` invocations with
  `[feed, payload, utc]` arguments. Frames are `\x1e`-separated records;
  `parse_core_frame` classifies them into the same snapshot/updates/keepalive
  events the legacy classifier produced, so `LiveFeedStore` and the recorder
  CLI are protocol-agnostic. The client sends `{"type":6}` pings every 15 s
  (the server drops silent clients) and reconnects on a 60 s receive gap.
- **Verified against the real hub** (2026-07-18, after FP3): anonymous
  subscribe returned a 13-feed snapshot — TimingData (22 driver lines),
  DriverList, WeatherData, TyreStintSeries, RaceControlMessages, TeamRadio,
  SessionInfo, SessionStatus, SessionData, TimingAppData, Heartbeat,
  TrackStatus, PitLaneTimeCollection. `CarData.z` / `Position.z` were
  withheld — they are the premium feeds that need `F1_LIVETIMING_TOKEN`
  (an F1 TV subscription bearer token). Live telemetry and the live track
  map therefore need a token; everything else works anonymously.

### LiveFeedStore (livetiming_signalr.py)

Per feed it keeps both consumer shapes:

- `get_records(feed)` — `(elapsed, payload)` records, identical to
  `parse_livetiming_stream` output, for the stream normalizers. Elapsed is
  anchored at the snapshot's Heartbeat Utc; `derive_stream_start_utc` over
  the stored Heartbeat records reproduces the anchor, so the whole
  timestamp pipeline works unchanged.
- `get_state(feed)` — keyframe-equivalent merged state for stream=False
  consumers (results, stints, drivers). `merge_live_state` patches
  index-keyed dicts *into lists in place* (unlike `merge_timing_delta`,
  which normalizes lists to dicts) because the keyframe normalizers branch
  on `isinstance(list)` — e.g. `BestLapTimes` in qualifying results.

A resubscribe snapshot replaces all records/state and re-anchors (missed
deltas are harmless, per the design). `.z` feeds are bounded at 7200
records. Freshness = last frame (keepalives count) < 60 s old.

### app.py — cache-layer wiring (behind `F1_LIVE_SIGNALR=1`)

- Supervisor task (started `before_serving`): every 60 s, find a live
  session (`is_session_live`) in the current year's session list; start the
  client/store for it, stop after the overrun window. Transient session
  list failures leave a running client untouched.
- `get_active_live_store(session_key)` gates every consult: same session,
  fresh, and — because around transitions the hub may still stream the
  previous session — the store's own `SessionInfo.Key` must not contradict
  the requested key.
- `fetch_livetiming_feed_cached` serves store records/state before touching
  disk or upstream, flagged `degraded` so live payloads are only ever
  cached under a TTL, never as the permanent archive copy. No raw disk
  copies are written from the store.
- `fetch_livetiming_stream_start` returns the store anchor while live and
  never memoizes it (the real archive's recording start differs).
- `/api/drivers` serves `normalize_livetiming_drivers(store DriverList)`.
- `F1_LIVETIMING_TOKEN` (optional) is passed through to the client.

### Live-session path resolution (unconditional fix)

`resolve_livetiming_session_path` now falls back to the root
`SessionInfo.json` (60 s in-process TTL): during a live session it carries
the session `Path` long before the year index lists it. Checked before the
year index when the session is live (saves a ~50 KB index refetch per live
poll), and after an index miss otherwise. This alone doesn't make live data
work (the feeds under that path still 403 until the archive generates), but
it removes the misleading "session not found" and lets data appear the
moment livetiming publishes anything.

## Tests

`tests/test_livetiming_signalr.py`: core protocol builders/parser,
merge_live_state, LiveFeedStore behavior (anchoring, merged state list
preservation, resubscribe reset, .z bounding, freshness, normalizer
interop). `tests/test_live_mode.py`: cache-layer wiring (store-first
serving, degraded flag, no disk writes, stale/mismatch/transition
fallbacks, anchor non-memoization, /api/drivers from store, path fallback
via root SessionInfo). Full suite: 421 tests green
(`.venv/bin/python3 -m unittest discover -s tests`).

## How to run

```
F1_LIVE_SIGNALR=1 .venv/bin/python3 app.py            # anonymous: core feeds
F1_LIVE_SIGNALR=1 F1_LIVETIMING_TOKEN=... app.py      # + CarData.z/Position.z
```

`.claude/launch.json` sets the flag for the dev preview.

## Live validation (2026-07-18 qualifying)

Validated end-to-end during Belgian GP qualifying with `F1_LIVE_SIGNALR=1`:

- Confirmed the static path is unusable while live (feed files 403 at
  16:03 local, mid-session) — SignalR is the only in-session source.
- The supervisor started the client at session start; the live timing
  table showed all 22 drivers in live order, weather updated in real time,
  and `/api/laps` grew between the frontend's 30 s polls. ~2,600 deltas
  received in the first 8 minutes (mostly TimingData). `/api/team_radio`
  502s until the session's first radio clip exists — self-heals once the
  feed appears in an update.
- A slice of the recorded traffic is committed as
  tests/fixtures/signalr/quali_2026_belgian_slice.json and replayed in
  RecordedTrafficReplayTests (real partial-state behavior: deltas for
  drivers outside a snapshot leave partial lines until the next snapshot).
- Observed once at session start: the event loop stalled ~54 s under
  first-load traffic (20 MB static-stream JSON parses hold the GIL in
  to_thread workers), which expired the negotiate token and 404'd the
  websocket connect; the 1 s-backoff reconnect recovered on its own.
  `import websockets` moved to module level to keep import-lock jitter out
  of that path. A real fix (process-pool parsing) is future work.

## Remaining (plan Task 4)

- SSE push to the browser instead of 30 s polling; live track map from
  Position.z (needs `F1_LIVETIMING_TOKEN`).
