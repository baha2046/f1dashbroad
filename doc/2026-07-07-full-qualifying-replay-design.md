# Design: Full Qualifying Replay + Q1/Q2/Q3 region labels

Extension of the Session Replay tab
(`2026-07-05-session-replay-tab-design.md`): Qualifying sessions gain a
**Full qualifying** whole-field view — the counterpart of Full race
(`2026-07-05-full-race-replay-design.md`) — and the replay timeline labels
the Q1/Q2/Q3 regions in both full-session and driver modes.

## 1. Why quali cannot reuse race-lap windows

Full-race mode derives its windows from field-wide lap numbers (race lap N
opens when the leader starts lap N). Qualifying lap numbers are **per
driver** — every driver has their own lap 1 whenever they first leave the
garage — so leader-based windows are meaningless there. The natural
segmentation of a qualifying session is its session phases instead.

## 2. Qualifying phases from the status series

`state.sessionStatusSeries` (Livetiming SessionData StatusSeries, already
fetched on session load) carries the session-state transitions:

- A phase **opens** at `Started` and **closes** at `Finished` (or a stray
  `Finalised`/`Ends` while open).
- `Aborted` (red flag) pauses the clock **without ending the phase**; the
  next `Started` resumes the *same* phase. A phase therefore spans first
  green to its chequered flag, red-flag gaps included.
- A phase still open at feed end (live session) is clamped to the latest
  known session time (`getRaceControlRangeMs`).

Phases are labelled `Q1`/`Q2`/`Q3` in order (`SQ1`..`SQ3` when the session
name mentions sprint/shootout). With no usable status series the mode shows
the race-control fallback timeline, exactly like a driver with no laps.

## 3. Full-session timeline and backend windows

`buildFullSessionTimeline()` slices each phase into near-equal windows of
about `REPLAY_SESSION_SLICE_SECONDS` (120 s — close to the Position.z sample
budget of `REPLAY_MAX_POINTS_PER_DRIVER` per window). Slice indices act as
the timeline's `lapNumber`s; the segments carry absolute `startMs`/`endMs`,
and breaks between phases are simply not part of the timeline (playback
jumps from the end of Q1 to the start of Q2).

`/api/track_replay` gains an **explicit-window mode**: with `driver_number`
absent and `start`/`end` (ISO UTC) present, the window is `[start, end]`
directly — no laps fetch. Guards: both must parse, `end > start`, length ≤
`REPLAY_WINDOW_MAX_SECONDS` (1800 s). Payloads report `driver_number`,
`lap_number` and `lap_duration` as `null` and cache as
`track_replay_{session_key}_window_{start_ms}_{end_ms}.json`. When
`driver_number` is present, `start`/`end` are ignored and the per-driver
lap path (with its `lap_number` requirement) applies unchanged. The
frontend keys these requests by slice index in `state.replayCache`, same as
lap-based modes.

## 4. Frontend

- Sentinel `REPLAY_FULL_SESSION = 'session'`; the select offers
  `Full qualifying — whole field` (preselected) for Qualifying sessions via
  `replaySupportsFullSession()` = `isQualifyingSession() && !replaySupportsFullRace()`.
- `isReplayWholeFieldSelection()` covers both sentinels: no reference
  driver, no telemetry strip, no pit markers; the team-radio ticker shows
  any driver's clips (as in full-race mode).
- `finalizeReplayTimeline` calls `annotateQualifyingPhases(segments)`: in
  qualifying sessions every segment (driver laps *and* full-session slices)
  gets `phase` — the latest phase started at-or-before the segment, so
  in-laps run after a phase's flag still count to it — and `phaseStart`
  marks each region's first segment.
- `renderReplayTimeline` draws a `Q1`/`Q2`/`Q3` label plus a boundary rule
  (`.phase-start`, `.replay-timeline-label.phase`) on each region's first
  segment. Driver mode keeps its lap-number labels elsewhere; full-session
  tooltips show `Q2 · 14:25:00–14:27:00` clock ranges instead of lap text.
- The lap chip shows `Q2 · 14:26:12` (phase + playhead clock) in
  full-session mode and prefixes the phase (`Q2 · Lap 8 / 15 - VER`) in
  driver mode.

Playback, seeking, prefetching, speed control, circuit-state bands and the
state chip are unchanged — full-session mode is the same chunked pipeline
with status-series window boundaries.
