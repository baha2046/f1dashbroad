# Design: Full Race Replay (driver-less mode)

Extension of the Session Replay tab
(`2026-07-05-session-replay-tab-design.md`): Race and Sprint sessions gain a
**Full race** view that replays the whole field from lap 1 without picking a
reference driver.

## 1. Rationale

The replay already animates every car — the selected driver only contributes
the timeline's lap windows and the highlight ring. For a race those windows
can be derived from the field itself, so the driver selection becomes
optional.

## 2. Race-lap windows

A race lap is defined by the race leader:

- **Race lap N opens** at the earliest `date_start` of lap N across all
  drivers — the moment the first car (the leader at the line) starts the lap.
- **It closes** at the earliest `date_start` of any later lap (normally lap
  N+1; a data gap skips to the next available race lap).
- **The final lap closes** at the latest `date_start + lap_duration` across
  the field. This fallback only applies once **someone has completed the
  lap** — a live in-progress lap has no usable window (mirroring the
  per-driver path's 404), which keeps a stale lap end from a many-laps-down
  car from fabricating one.
- **Known limitation**: OpenF1 records no `lap_duration` for the
  chequered-flag lap itself, so the race's literal last lap has no derivable
  window and is excluded — identical to the existing per-driver mode
  (`build_lap_telemetry_window` also returns none for it). Covering the run
  to the flag would need the chequered timestamp from race control on the
  backend; possible follow-up.

Consecutive windows tile the race continuously from lights-out to the last
finisher; lapped cars keep animating because each window fetches location
data for the whole field regardless of what lap a car is on.

This is only meaningful where lap numbers are field-wide, so the mode is
offered for Race/Sprint sessions only (the same gate as pit annotations).

## 3. Backend

`/api/track_replay` keeps its shape; `driver_number` becomes **optional**:

- Absent → `build_race_lap_window(laps, lap_number)` derives the window from
  the whole session's laps (`laps_{session_key}.json`); present → the
  existing `build_lap_telemetry_window` per-driver path, unchanged.
- Full-race payloads report `driver_number: null` and `lap_duration: null`
  (a race-lap window is leader pace, not any single driver's lap time) and
  cache as `track_replay_{session_key}_race_{lap_number}.json`.
- A present-but-invalid `driver_number` is still rejected with 400.

Per-lap windows remain the bounded, cacheable data unit — full-race mode is
the same chunked pipeline with different window boundaries.

## 4. Frontend

- The replay select (relabelled **View**) gains a first option
  `Full race — whole field` (sentinel value `REPLAY_FULL_RACE = 'race'`),
  shown and preselected for Race/Sprint sessions.
- `state.replay.driverNumber` holds either a driver number or the sentinel;
  `normalizeReplaySelection` / `isValidReplaySelection` replace the raw
  `Number()` / `Number.isFinite` checks on the load path, and full-race
  requests simply omit `driver_number` (cache keys use `race` in the driver
  slot).
- `buildFullRaceTimeline(allLaps)` mirrors `build_race_lap_window` and feeds
  the shared `finalizeReplayTimeline` tail (width caps, race-control range and
  circuit-state bands). Segments carry `hasTime: false`: no fastest-lap star,
  no lap-time tooltip, and the initial selection falls back to the first
  segment — so a full-race replay starts at lap 1.
- All-session laps come from `fetchAllSessionLaps`, memoized on
  `state.allSessionLaps` (already populated during session load for
  Race/Sprint).
- With `payload.driver_number` null no car matches the reference check, so
  no highlight ring is drawn — every car renders equally.

Playback, seeking, prefetching, speed control, and the race-control state
chip are unchanged.
