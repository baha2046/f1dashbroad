# Session Replay: Review & Enhancement Plan

Review of the shipped Session Replay feature (`10-track-replay.js`,
`/api/track_replay`; designs in `2026-07-04-track-replay-design.md`,
`2026-07-05-session-replay-tab-design.md`,
`2026-07-05-full-race-replay-design.md`) and a phased enhancement plan.
Plan cross-reviewed by gpt-5.5; its corrections are folded in below.

## 1. Review of the current implementation

### Strengths (keep as-is)

- Per-lap replay payloads as the bounded, permanently-cacheable data unit;
  prefetch 15s before the lap boundary with in-flight request memoization.
- Stale-selection guards on every async path; selection state lives in
  `state.replay`, not the DOM.
- Frontend timeline mirrors the backend window math
  (`build_lap_telemetry_window` / `build_race_lap_window`), so the timeline
  only offers laps the backend can serve.
- Circuit-state parsing grounded in real OpenF1 payload shapes; capped
  display widths keep quali out-laps from dwarfing flying laps.
- `getReplayAbsoluteMs(t)` already provides a single normalized absolute
  session timestamp for the playhead — every playhead-synced feature below
  must key off it (and only it) so the map and side panels can never
  disagree about "now".

### Defects / gaps found

1. **Bug — speed toggle desync.** `resetReplay()` recreates
   `state.replay` with `speed: 1`, but the `#replaySpeedToggle` buttons keep
   their old `.active` class. After a session switch the UI can show "4x"
   while playback runs at 1x. Fix: reset the active button in
   `resetReplay()`.
2. **No race context.** The map shows *where* cars are but not *who is
   ahead*: no running order, no gaps, no lap-of-total counter. Yet
   `state.position`, `state.pitStops`, `state.stints`, and the full
   `state.raceControl` list are already loaded per session, and
   `/api/intervals` is already proxied (only live mode fetches it).
3. **Cars vanish silently.** The >4s-gap rule hides garaged/retired cars
   with no affordance saying who is missing or why.
4. **No keyboard control**; seeking is click-only.
5. `renderReplayFrame` writes chip/tint DOM every frame even when the
   circuit state hasn't changed — harmless today, but the frame loop must
   not accrete more unconditional DOM writes as features land.

## 2. Enhancement plan

Ordering principle (per cross-review): field-wide race context (order,
gaps, pits, tyres) materially changes what a replay tells the user;
interaction polish does not. Data depth first, polish after.

### Phase 1 — Race context at the playhead

**1.0 Fix the speed-toggle desync bug** (one-liner in `resetReplay()`).

**1.1 Position tower with gaps.** A side panel next to the map showing the
running order at the playhead's absolute time. Race/Sprint sessions only.

- *Order*: reduce `state.position` to a per-driver sorted index once per
  session load; at the playhead, binary-search latest record ≤ absolute ms.
  **Seed the order from each driver's first position record** (grid order)
  so the tower is complete from lights-out — `position` is a sparse
  change stream, not a snapshot, and drivers without a change yet must not
  drop out.
- *Gaps*: fetch `/api/intervals` once when the Replay tab opens for a
  historical Race/Sprint (live mode already keeps `state.intervals`
  fresh); per-driver sorted index, binary search at the playhead.
  **Max-age guard**: if the nearest record is older than ~20s of session
  time (SC trains, retirement, data gap), show "—" instead of a stale gap.
- *Rendering*: build the 20 row nodes once; update text/classes in place at
  a throttled ~4Hz tick driven from the rAF loop. Never rebuild rows per
  tick, no row-flash animation (cut as churn per cross-review).
- Retired/garaged drivers (hidden car dots) stay in the tower, grayed with
  an "OUT"/"—" marker — this also fixes gap 3 above.

**1.2 Lap counter chip.** "Lap 12 / 57" next to the time label. Semantics
must be explicit per mode: full-race mode counts **leader race laps**
(timeline segments are exactly that); driver mode counts the **reference
driver's own laps** ("Lap 12 / 57 · VER"). Total = last timeline segment.

**1.3 Pit status.**

- Tower badge "PIT" while the playhead is inside a driver's pit window.
  `pit_duration` is pit-lane time, not the full loss window — pad it
  (~± a few s) and fall back to "this driver's pit lap" when duration is
  missing.
- Timeline pit markers for the reference driver's in-laps (driver mode),
  reusing the existing `buildPitStopsByLap` data — cheap, and gives
  at-a-glance strategy context without watching the tower.

### Phase 2 — Context depth

**2.1 Tyre compound chips** in the tower rows from `state.stints`.
Needs per-driver *current lap* at the playhead: derive from the
all-session laps memo (`fetchAllSessionLaps`) — latest lap whose
`date_start` ≤ playhead per driver. Handle drivers with no lap record at
that time (show no chip) and out-laps (stint boundaries are lap-ranged, so
the pit out-lap picks the new stint — acceptable).

**2.2 Race control ticker** under the map: most recent message ≤ playhead,
**filtered** to high-signal categories (flags, SC/VSC, penalties,
investigations involving a shown driver) — the raw feed is too noisy
(deleted lap times, admin notes). Reuse the category logic from the Race
Control tab where possible.

**2.3 Car-dot / tower-row click → highlight** (ring + label emphasis, tower
row bold). Explicitly *not* "switch reference driver": rebuilding the
timeline mid-playback changes the playback basis and jumps the moment.
(A reference-switch that preserves absolute playhead time is a possible
follow-up, out of scope here.)

### Phase 3 — Interaction polish

**3.1 Keyboard shortcuts** (only when the Replay tab is active and no
input/select is focused): Space = play/pause, ←/→ = seek ±5s crossing lap
boundaries via the existing `advanceReplayToNextLap`/seek machinery,
↑/↓ = previous/next timeline lap.

### Explicitly deferred (cross-review: low value or duplicative)

- 8x speed — state sync legibility suffers before it adds value.
- Reference-driver telemetry strip (speed/gear/DRS) — duplicates the
  Telemetry tab for one driver; whole-field context wins.
- Row-flash position-change animation.

## 3. Implementation notes

- **Single time source**: every new panel reads
  `getReplayAbsoluteMs(state.replay.t)`; nothing else derives its own
  timestamp. Position/interval/pit/stint records are all absolute-dated,
  so lap-window seams stay consistent for free.
- **Perf budget**: all per-frame work stays in the rAF loop as now; the
  tower/ticker tick at ~4Hz behind a `lastTickMs` guard. Indexes
  (per-driver sorted arrays) are built once per session load or per tab
  open, never per frame.
- File touch points: `10-track-replay.js` (most logic; consider a new
  `12-replay-tower.js` if it grows past ~300 lines), `templates/index.html`
  (tower/ticker markup), `02-dom.js`, `03-api-settings.js` (keyboard +
  click wiring), `static/css/styles.css`, `05-session-load.js` (intervals
  fetch hook). **No backend changes** — `/api/intervals` is already
  proxied and cached.

## 4. Testing plan

Repo convention is string-level static wiring tests (unittest, no JS
runtime). The cross-review flagged that as weak for this change set — the
risky logic is timestamp reduction and stale-data handling. Mitigation:

- Write the lookup logic as **pure functions** (`buildDriverDateIndex`,
  `valueAtMs(index, ms, maxAgeMs)`, `deriveDriverLapAt`) with no DOM
  access, so they are individually greppable and a JS-runtime harness can
  adopt them later without refactoring.
- Extend `tests/test_session_replay_tab.py`: markup has tower/ticker ids;
  DOM map wires them; JS defines the pure helpers and the 4Hz tick guard;
  CSS has the new classes; keyboard handler keys on `replay-view`.
- Backend untouched → existing `/api/track_replay` and endpoint-proxy
  tests keep passing as-is. Run via `python -m unittest discover`.
