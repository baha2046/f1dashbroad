# Design: Session Replay — Race Control timeline & circuit states

Improvement of the Session Replay tab
(`2026-07-05-session-replay-tab-design.md`): the timeline gains a **Race
Control layer** so it renders even when no reference driver / lap data is
available, and the replay surfaces the **circuit state** (yellow flag,
safety car, VSC, red flag, chequered) both on the timeline and while
playing back.

## 1. Objectives

- The timeline no longer depends solely on the reference driver's laps:
  a session-time range derived from `state.raceControl` (already fetched
  on session load) and the session's `date_start`/`date_end` renders
  immediately, before lap data arrives — and stays useful when laps never
  arrive (no drivers, missing lap data).
- Circuit-state periods parsed from race control messages are drawn as
  colored bands on the timeline: yellow (sector/track yellows), safety
  car, virtual safety car, red flag, plus a chequered-flag marker.
- During playback a **state chip** next to the time label shows the
  circuit state at the playhead (Green / Yellow / Safety Car / VSC /
  Red / Chequered) and the SVG track outline tints to match.
- Live mode: each race-control poll refresh recomputes the bands.

## 2. Race control parsing (grounded in cached OpenF1 payloads)

`extractCircuitStatePeriods(records)` → `{ periods, chequeredMs }` with
`periods: [{ type: 'red'|'sc'|'vsc'|'yellow', startMs, endMs, label }]`,
chronological sweep over records sorted by `date`:

- **Red** opens on `flag === 'RED'` (quali/practice) or a message
  *starting with* `RED FLAG` (races: `RED FLAG - RACE SUSPENDED`,
  category `Other`, flag `None` — prefix matching keeps steward notes
  like `... - RED FLAG INFRINGEMENT` from raising one); closes on the
  next track-scope `GREEN` or `CLEAR` (`TRACK CLEAR`). Opening a red
  closes every open period.
- **Safety car** opens on `SAFETY CAR DEPLOYED` (category `SafetyCar`);
  closes on track-scope `CLEAR`/`GREEN` (real feeds emit `TRACK CLEAR`
  shortly after `SAFETY CAR IN THIS LAP`) or on red flag.
- **VSC** opens on `VSC DEPLOYED` / `VIRTUAL SAFETY CAR DEPLOYED`;
  closes like the safety car (a `TRACK CLEAR` follows `VSC ENDING`).
- **Yellow** opens on flag `YELLOW`/`DOUBLE YELLOW` keyed by
  scope+sector; closes on `CLEAR` for the same sector, any track-scope
  `CLEAR`/`GREEN`, or red flag. Overlapping yellow spans are merged into
  union bands to keep the DOM small.
- **Chequered**: first track-scope `CHEQUERED` timestamp is kept as a
  marker (`chequeredMs`).
- Periods still open at the end of the data close at the timeline range
  end (live sessions).

Precedence when the playhead is inside several periods:
red > sc > vsc > yellow; otherwise `chequered` after `chequeredMs`,
else `green` (`circuitStateAt(states, ms)`).

## 3. Timeline model changes

`buildReplayTimeline(laps)` segments gain absolute anchors:
`startMs` (lap `date_start`) and `endMs` (`startMs + seconds*1000`). The
timeline object gains `rangeStartMs` / `rangeEndMs` (segments extended
by race-control dates) and `states` (the parsed periods).

`buildRaceControlTimeline()` is the driver-less fallback: no segments,
range from race control dates falling back to the session's
`date_start`/`date_end`. `setupReplayTimeline()` renders it immediately
(and keeps it when the driver has no usable laps); the lap-segment
timeline replaces it when laps arrive.

Rendering: each lap segment gets absolutely-positioned
`.replay-timeline-state` strips for the parts of `states` overlapping
its `[startMs, endMs]` (fractions of the segment itself, so flex-gap
between segments cannot misalign bands). The fallback timeline renders
one full-width `.replay-timeline-base` bar carrying the same bands
mapped linearly over the range. `stateBandsForRange(states, startMs,
endMs)` produces the clipped bands for both paths. The chequered marker
is a thin `.replay-timeline-chequered` line. Bands are
`pointer-events: none`, so clicks still hit the lap segments.

## 4. Playback state chip & track tint

- `getReplayAbsoluteMs(t)` = active segment `startMs + t*1000` (the
  backend replay window starts at the same lap `date_start`).
- `updateReplayCircuitState()` (called from `renderReplayFrame`) sets
  the `#replayStateChip` label/class and
  `DOM.replayMapContent.dataset.circuitState`, which tints
  `.replay-track-path` via CSS. Hidden while no scene is loaded.
- `refreshReplayCircuitStates()` recomputes `timeline.states` from
  `state.raceControl` and re-renders the timeline without touching
  playback; the live-mode refresh calls it after updating
  `state.raceControl`.

## 5. Markup / wiring changes

- `templates/index.html`: `<span id="replayStateChip">` in the replay
  controls row, after the time label.
- `02-dom.js`: wire `replayStateChip`.
- `10-track-replay.js`: parsing, fallback timeline, band rendering,
  chip/tint updates.
- `11-live-mode.js`: `refreshReplayCircuitStates()` after the race
  control poll.
- `styles.css`: `.replay-timeline-state` (+ `state-yellow`, `state-sc`,
  `state-vsc`, `state-red`), `.replay-timeline-base`,
  `.replay-timeline-chequered`, `.replay-state-chip` variants, and
  `[data-circuit-state]` track tints.

## 6. Testing plan

String-level static wiring tests (repo convention — no JS runtime),
added to `tests/test_session_replay_tab.py`:

1. index.html has `id="replayStateChip"` inside the replay view.
2. DOM map wires `replayStateChip`.
3. JS defines `extractCircuitStatePeriods`, `buildRaceControlTimeline`,
   `stateBandsForRange`, `circuitStateAt`, `updateReplayCircuitState`,
   `refreshReplayCircuitStates`, and references the grounded signal
   strings (`SAFETY CAR DEPLOYED`, `VSC DEPLOYED`, `RED FLAG`).
4. Live refresh calls `refreshReplayCircuitStates()`.
5. CSS contains the new timeline/chip/tint classes.
