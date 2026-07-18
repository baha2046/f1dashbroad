# SignalR Live Mode — Implementation Plan (2026-07-08)

Design: doc/2026-07-08-signalr-live-mode-design.md. Steps use checkbox
syntax for tracking; the remaining tasks require a live session to verify
against, so they are scheduled for the next race weekend.

> **2026-07-18 update:** the legacy 1.5 hub described here now answers 401;
> livetiming moved to SignalR Core at /signalrcore. Task 2's validation and
> Task 3's integration (adapted to the new protocol) are implemented — see
> doc/2026-07-18-signalrcore-live-integration-implementation.md.

## Task 1: Protocol primitives + client (done 2026-07-08)

- [x] `livetiming_signalr.py`: negotiate/connect URL builders, subscribe
      frame, `classify_signalr_frame`, `record_from_update` (converts hub
      deltas into `(elapsed, payload)` records the existing normalizers
      consume), `SignalRClient` with reconnect backoff + keepalive timeout.
- [x] `tests/test_livetiming_signalr.py`: URL/frame/record unit tests,
      including normalizer interop.
- [x] Recorder CLI: `python livetiming_signalr.py record out.jsonl`.
- [x] `websockets>=12.0` added to requirements.

## Task 2: Validate against a real live session (next race weekend)

- [ ] Run the recorder for ~10 minutes during a live session.
- [x] Confirm negotiate/connect succeed with the current headers — they do
      not: /signalr answers 401 since livetiming moved to SignalR Core.
      Client migrated to /signalrcore and validated against the real hub
      (2026-07-18, 13-feed anonymous snapshot).
- [ ] Turn a slice of the recording into committed fixtures
      (tests/fixtures/signalr/) and extend the parser tests with them.

## Task 3: LiveFeedStore + cache integration (behind F1_LIVE_SIGNALR=1)

Done 2026-07-18 — see
doc/2026-07-18-signalrcore-live-integration-implementation.md.

- [x] `LiveFeedStore`: per-session dict feed → list of records; snapshot
      replaces, updates append; bounded (drop oldest beyond N records for
      .z feeds); anchor from the Heartbeat snapshot. Also keeps merged
      keyframe-shaped state for the stream=False consumers.
- [x] Background task lifecycle in app.py mirroring the eviction task:
      a supervisor starts the client when `is_session_live()` flips true
      for any current-year session, stops after the overrun window.
- [x] `fetch_livetiming_feed_cached`: consult the store before disk/upstream
      while the session is live and the store is fresh (socket connected,
      last frame < 60 s old); otherwise fall through to the existing path —
      polling remains the automatic fallback.
- [ ] Drop `LIVE_CACHE_TTL_SECONDS` polling pressure once store-backed
      responses are verified (frontend keeps its 30 s cadence initially).

## Task 4: Frontend push (optional, after Task 3 settles)

- [ ] SSE endpoint (`/api/live_events`) streaming store updates; live mode
      switches from polling to EventSource with polling fallback.
- [ ] Live track map: feed Position.z updates into the replay map renderer.
