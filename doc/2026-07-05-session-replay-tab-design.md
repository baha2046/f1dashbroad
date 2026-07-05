# Design: Session Replay Tab (session-wide timeline)

Expansion of the Track Position Replay feature
(`2026-07-04-track-replay-design.md`): the replay card moves out of the
Circuit Details tab into a new top-level **Session Replay** tab, and the
single-lap scrubbing model grows a **session timeline** — every lap of the
reference driver laid out proportionally, with click-to-seek and continuous
playback that auto-advances across laps.

## 1. Objectives

- New dashboard tab `Session Replay` (`data-tab="replay-view"`, button
  `id="tab-replay"`) between Race Control and Circuit Details; the replay card
  moves there. Circuit Details keeps the info + track layout cards only.
- A **timeline** replaces the lap `<select>`: one segment per usable lap of
  the reference driver, width proportional to the lap's replay window,
  fastest lap tinted, active lap highlighted, lap-number labels (thinned),
  and a playhead that tracks playback across the whole session.
- Clicking the timeline seeks to that lap + in-lap offset (loading the lap
  payload on demand; playback state survives the switch).
- **Continuous playback**: when `t` reaches the end of a lap window, the
  replay advances into the next timeline lap carrying the leftover time. The
  next lap's payload is prefetched near the end of the current lap so the
  handoff is seamless; if it is not ready yet, the replay shows the loading
  state and resumes when it arrives.
- The in-lap fine scrubber, play/pause, speed toggle, and time label remain;
  the time label gains lap context (`Lap 12 · 34.5s / 89.2s`).
- Backend unchanged: `/api/track_replay` per-lap windows stay the bounded
  data unit (a full-race location payload would be ~500k samples; per-lap
  chunks keep requests small and permanently cacheable).

## 2. Timeline model

Built from the reference driver's laps (already fetched via the
`fetchDriverLaps` memo). Each lap's window seconds mirror the backend's
`build_lap_telemetry_window`: `lap_duration` when > 0, otherwise the gap to
the next lap's later `date_start`; laps without a derivable window (or
without `date_start`) are excluded — the timeline only contains laps the
backend can serve.

```js
state.replay.timeline = {
  segments: [{ lapNumber, seconds, displayUnits, displayStart, isFastest }],
  displayTotal
}
```

`displayUnits` caps a segment's rendered width at 3× the median lap seconds
so out-laps / red-flag gaps (quali) do not dwarf flying laps; seeking maps
click position within a segment onto that segment's *real* seconds, so the
cap only affects rendering. The playhead position uses the same display
mapping: `displayStart + (t / seconds) × displayUnits`.

Selection state moves off the DOM: `state.replay.driverNumber` /
`state.replay.lapNumber` are the source of truth (the old code read the lap
`<select>`), and stale-response guards compare against them.

## 3. Playback flow

- `setupReplaySection()` (session load) populates the driver select; picking
  a driver rebuilds the timeline and preselects the fastest lap.
- Fetches stay deferred until the Session Replay tab is visible
  (`maybeAutoLoadReplay()` now keyed on `replay-view`).
- `loadTrackReplay(driver, lap, {startT, resume})` — `startT` places the
  first frame mid-lap (timeline seeks, lap handoffs), `resume` restarts the
  RAF loop after the scene rebuild (auto-advance, seek while playing).
- `replayLoop` boundary handling: `t >= windowSeconds` → next timeline lap?
  advance with `leftover = t - windowSeconds` : clamp + stop (end of
  session).
- Prefetch: while playing, once `windowSeconds - t < 15s` the next lap's
  payload is fetched into `state.replayCache`. In-flight requests are
  memoized by cache key so a prefetch and a lap-advance load for the same
  lap never hit the network twice; both memos are discarded on session
  change.

## 4. Markup / wiring changes

- `templates/index.html`: new tab button + `#replay-view` section holding
  the (moved) replay card; controls row keeps driver select / play /
  scrubber / time label / speed toggle; new
  `<div class="replay-timeline" id="replayTimeline">` sits between the
  controls and the map. The lap `<select>` is removed.
- `02-dom.js`: `replayLapSelect` → `replayTimeline`.
- `03-api-settings.js`: tab handler triggers `maybeAutoLoadReplay()` on
  `replay-view`; timeline click delegation replaces the lap-select listener.
- `10-track-replay.js`: timeline build/render/seek, auto-advance, prefetch,
  selection state; user-facing copy updated to "Session Replay tab".
- `styles.css`: `.replay-timeline`, `.replay-timeline-segment` (+ `.active`,
  `.fastest`), `.replay-timeline-label`, `.replay-timeline-playhead`.

## 5. Testing plan

String-level static wiring tests (repo convention — no JS runtime):

- Update `tests/test_track_replay.py` wiring: replay ids now include
  `replayTimeline`, drop `replayLapSelect`; JS assertions swap
  `populateReplayLapSelect` for the timeline builders.
- New `tests/test_session_replay_tab.py`:
  1. index.html has the `tab-replay` button (`data-tab="replay-view"`) and a
     `#replay-view` section that contains the replay card; the circuit view
     section no longer contains it.
  2. JS defines `buildReplayTimeline`, `seekReplayToTimelineFraction`,
     `advanceReplayToLap`, `prefetchNextReplayLap`; `maybeAutoLoadReplay`
     keys on `replay-view`; DOM map wires `replayTimeline`.
  3. CSS has the `.replay-timeline*` classes.
  4. Backend endpoint untouched — existing `/api/track_replay` tests keep
     passing as-is.
