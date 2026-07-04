# Design: Track Position Replay (Single-Lap)

Phase 2 item 4 of `2026-07-04-project-review-and-enhancement-plan.md`: animate
OpenF1 `location` data (per-driver x/y at ~3.7 Hz) on the circuit track map —
a lap replay with play/pause, scrubber, and playback speed. Scoped to
**single-lap replay** (the heaviest-volume OpenF1 endpoint; a full race would
be ~500k samples, one lap for the whole field is ~7k).

## 1. Objectives

- Pick a **reference driver + lap**; replay the whole field's positions during
  that lap's time window on an SVG track map on the Circuit Details tab.
- Playback controls: play/pause, scrubber, elapsed/total time, 1x/2x/4x speed.
- Team-colored dots with acronym labels; the reference driver highlighted.
- Bounded data: one `location` query per lap window (all drivers at once),
  per-driver downsampling, permanent caching for historical sessions.

## 2. Coordinate space

The existing circuit map (`renderCircuitTab`) draws MultiViewer `circuit_info`
`x`/`y` arrays into a 1000×1000 viewBox via a fit-to-bounds projection with
inverted Y. OpenF1 `location` uses the same F1 live-timing coordinate space
(verified: circuit_info ranges ±~10k match location magnitudes), so replay dots
are projected with the same math. The projection is computed from the **track
outline bounds** when `circuit_info` is available, keeping the drawn track
identical to the Circuit tab map; when it is missing, the track base layer is
drawn from the reference driver's own location trace (the racing line), which
is self-consistent by construction.

## 3. Backend: `/api/track_replay`

```
GET /api/track_replay?session_key=<int>&driver_number=<int>&lap_number=<int>
```

Same hardening posture as `/api/car_telemetry`: integers only, no
client-supplied dates. Handling:

1. Validate params (400 otherwise).
2. Reuse `build_lap_telemetry_window` on the cached
   `laps_{session_key}_{driver_number}.json` to derive the window; 404 when no
   usable window.
3. Fetch `location?session_key=&date>=START&date<END` — **no driver filter**,
   one upstream query returns the whole field for the window.
4. Group samples by `driver_number`; keep `[t, x, y]` compact arrays
   (t = seconds since window start rounded to ms, x/y rounded to ints); drop
   samples without finite x/y; sort by t; downsample per driver by stride to
   `REPLAY_MAX_POINTS_PER_DRIVER` (400).
5. Cache the processed payload as
   `track_replay_{session_key}_{driver_number}_{lap_number}.json` — permanent
   for historical sessions, 5-min TTL otherwise, per-key lock, stale fallback.

Response shape:

```json
{
  "session_key": 11234, "driver_number": 10, "lap_number": 55,
  "lap_duration": 84.486, "window_seconds": 84.486,
  "downsampled": false,
  "drivers": [
    {"driver_number": 1, "samples": [[0.0, -3650, 1193], [0.28, -3541, 1201], ...]},
    ...
  ]
}
```

## 4. Frontend: Circuit Details tab replay card

New full-width card below the circuit info/map cards (its own SVG rather than
injecting into `#circuitMapContent`, which `renderCircuitTab` rewrites on every
session select). New JS file `static/js/10-track-replay.js` (auto-included by
the numeric script-load order and the tests' `read_dashboard_js` concat).

Controls: reference-driver select, lap select, play/pause button, scrubber
(`input[type=range]`), time label, 1x/2x/4x speed toggle.

Data flow:

- After session load, `setupReplaySection()` populates the driver select
  (default: current Laps-tab driver or first driver); picking a driver fetches
  that driver's laps via the existing `fetchDriverLaps` memo to fill the lap
  select (fastest lap preselected).
- Fetches are deferred until the Circuit tab is visible
  (`maybeAutoLoadReplay()` on tab switch — the telemetry-tab pattern).
- Payloads memoized in `state.replayCache` (`sessionKey_driver_lap`), cleared
  on session change; stale async responses discarded.

Rendering / animation:

- Base SVG built once per load: track path + per-driver `<g>` (team-colored
  circle + acronym label), reference driver drawn last with a highlight ring.
- `requestAnimationFrame` loop advances `t` by `dt × speed`; each frame every
  driver's `[t,x,y]` samples are binary-searched for the bracketing pair and
  linearly interpolated; the `<g>` moves via `transform="translate(...)"`.
- Dots hide when `t` falls outside a driver's sampled range or inside a gap
  larger than 4 s (garage / retirement).
- Scrubbing pauses nothing: it sets `t` directly and re-renders the frame;
  playback stops (button resets) when `t` reaches the window end.
- Session/driver/lap switches cancel the RAF loop before rebuilding.

## 5. Styles

`.replay-card`, `.replay-controls`, `.replay-select-wrapper` (mirrors the
telemetry select), `.replay-play-btn`, `.replay-scrubber`, `.replay-time-label`,
`.replay-speed-toggle` (+ `.active` button), `.replay-map-content`,
`.replay-track-path`, `.replay-car-dot`, `.replay-car-label`,
`.replay-car-highlight`.

## 6. Testing Plan

`tests/test_track_replay.py`:

1. Param validation — 400 for missing / traversal / non-numeric params.
2. Date-window fetch — URL targets `location` with the lap window and **no**
   `driver_number` filter; response groups per driver with relative-`t`
   compact samples, sorted, out-of-window samples dropped.
3. 404s — unknown lap / lap without a usable window.
4. Downsampling — oversized per-driver series reduced to
   `REPLAY_MAX_POINTS_PER_DRIVER`, first/last kept, `downsampled: true`.
5. Caching — second request served without another upstream fetch.
6. Static wiring — index.html ids (`replayCard`, `replayDriverSelect`,
   `replayLapSelect`, `replayPlayBtn`, `replayScrubber`, `replayMapContent`)
   and the `10-track-replay.js` script tag; JS wires DOM refs,
   `loadTrackReplay`, `maybeAutoLoadReplay`, `/api/track_replay`; CSS has the
   `.replay-*` classes.
