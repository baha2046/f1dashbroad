# Design: Live Mode (Auto-Refresh for Active Sessions)

Phase 2 item 1 of `2026-07-04-project-review-and-enhancement-plan.md`: when the
selected session is currently live, auto-refresh its fast-moving data
(`position`, `intervals`, `race_control`) on a short interval, with a visible
pulsing **LIVE** indicator and a countdown to the next refresh. OpenF1's
`intervals` endpoint (gap to leader / interval to car ahead, races only) is not
consumed anywhere yet and becomes the data source for live gaps.

## 1. Objectives

- Detect that the selected session is live (started, not yet ended, small
  overrun buffer for races running long).
- Poll `/api/position` + `/api/intervals` + `/api/race_control` every 30 s
  while live; re-render the race-control feed and a new **Live Timing** table.
- Pulsing LIVE badge + "next update in Ns" countdown in the session header.
- Server-side: live sessions get a tighter cache TTL (30 s instead of 5 min)
  so polling clients actually see fresh data, while all clients still share
  one upstream fetch per TTL window (per-key lock already handles stampedes).
- Live mode stops automatically when the session ends or another session is
  selected; timers are always cleaned up.

## 2. Backend

### 2.1 `/api/intervals`

One-line addition to the `OPENF1_SESSION_ENDPOINTS` route-factory table:
`"intervals": "intervals"` → `GET /api/intervals?session_key=<int>` proxying
`https://api.openf1.org/v1/intervals?session_key=...` with the shared
validation / caching / stale-fallback behavior. Cache file
`intervals_{session_key}.json`. Intervals exist only for races; for other
session types OpenF1 returns `[]`, which the frontend treats as "no gap data".

### 2.2 Live TTL

```python
LIVE_CACHE_TTL_SECONDS = 30
LIVE_SESSION_OVERRUN_SECONDS = 1800  # sessions (esp. races) overrun date_end

def is_session_live(session, now=None): ...
```

`is_session_live` is true when `date_start <= now <= date_end + overrun` and
the session isn't cancelled. In `get_cached_api`, session-scoped data picks its
TTL as: live → 30 s; else non-historical → 300 s; else permanent. Session
lookup uses the already-cached `sessions_{year}.json` (existing
`get_session_info` path) — no extra upstream calls.

## 3. Frontend

New JS file `static/js/11-live-mode.js` (auto-included by numeric load order
and the tests' `read_dashboard_js` concat).

### 3.1 Detection & lifecycle

- `isLiveSessionNow(session, now)` — pure helper mirroring the backend rule
  (30 min overrun buffer), Node-testable.
- `state.live = createLiveState()` — `{ active, sessionKey, refreshTimerId,
  countdownTimerId, nextRefreshAt, refreshing, lastUpdated }`; `state.intervals = []`.
- `selectSession()` calls `stopLiveMode()` up front (clears timers, hides UI)
  and `setupLiveMode()` after render: if the session is live, show the
  indicator, run an immediate `refreshLiveData()` (fetches intervals for the
  first time), and start the 30 s refresh + 1 s countdown timers.

### 3.2 Refresh cycle

`refreshLiveData()`:

1. Capture `session_key`; fetch `/api/position`, `/api/intervals`,
   `/api/race_control` in parallel via `customFetch` (keeps the API-key header
   and the restriction-banner handling).
2. Discard results if the user switched sessions mid-flight.
3. Update `state.position`/`state.positionByLap`, `state.intervals`,
   `state.raceControl`; re-render the race-control feed and the live timing
   table; refresh the header status badge.
4. Failed fetches (`!ok`) leave the previous state in place — the poller keeps
   running and `customFetch` already surfaces restriction/upstream banners.
5. If the session is no longer live, apply the final data and stop live mode.

### 3.3 Live Timing table

New card at the top of the Drivers tab (default tab → immediately visible),
shown only while live. `buildLiveTimingRows(positions, intervals)` — pure,
Node-testable — reduces the position/interval event streams to the latest
record per driver and returns rows sorted by current position:
`{ position, driver_number, interval, gap_to_leader }`. Rendering joins
`state.drivers` for names/team colors; `formatLiveGap` renders numbers as
`+N.NNNs`, strings (`"+1 LAP"`) verbatim, and null/leader as `—`. With
positions but no intervals (practice/quali) the gap columns show `—`; with no
positions at all the card stays hidden.

### 3.4 Header indicator

`#liveIndicator` in the session header card: pulsing red dot + "LIVE" +
`#liveCountdown` ("next update in Ns", "updating…" while a refresh is in
flight). Hidden whenever live mode is off.

## 4. Styles

`.live-indicator`, `.live-dot` (CSS pulse animation), `.live-countdown`,
`.live-timing-card`, `.live-timing-header`, `.live-timing-updated`,
`.live-timing-table` (+ position cell, driver cell reusing the results-table
look), `.live-timing-leader`.

## 5. Testing Plan

`tests/test_live_mode.py`:

1. `/api/intervals` — 400 for missing/traversal/non-numeric `session_key`;
   cached file served; cache miss fetches the OpenF1 `intervals` URL.
2. Live TTL — with a live session seeded in `sessions_{year}.json`, a 60 s-old
   `position_{key}.json` is refetched; for a non-live (future) session the same
   60 s-old cache is served with no upstream fetch. `is_session_live` unit
   cases (before start / during / within overrun / after overrun / cancelled).
3. Node-subprocess tests — `isLiveSessionNow` (live vs ended vs upcoming) and
   `buildLiveTimingRows` (latest-per-driver, position sort, missing intervals).
4. Static wiring — index.html ids (`liveIndicator`, `liveCountdown`,
   `liveTimingCard`, `liveTimingTableBody`) + `11-live-mode.js` script tag; JS
   DOM refs and functions (`setupLiveMode`, `stopLiveMode`, `refreshLiveData`,
   `/api/intervals`); `.live-*` CSS classes.
