# Track Position Replay Implementation Plan

**Goal:** Single-lap track position replay on the Circuit Details tab: the whole
field's OpenF1 `location` data for a reference driver's lap window, animated on
an SVG track map with play/pause, scrubber, and speed controls.

**Design:** see `2026-07-04-track-replay-design.md`.

**Tech Stack:** Python (Quart, httpx), JavaScript (vanilla, SVG,
requestAnimationFrame), CSS, Python unittest.

## Global Constraints

- Keep implementation documents under the `doc/` directory.
- Use Python in `.venv/bin/python3` for testing (run via
  `.venv/bin/python3 -m unittest discover tests`).
- Endpoint params are integers only; no client-supplied dates reach cache file
  names or upstream URLs.

---

### Task 1: TDD tests

**Files:** Create `tests/test_track_replay.py`

- [ ] Param-validation tests (400s), lap-window URL construction against a
  seeded laps cache, per-driver grouping with `[t, x, y]` samples,
  out-of-window filtering, unknown-lap 404, per-driver downsampling to
  `REPLAY_MAX_POINTS_PER_DRIVER`, cached second request.
- [ ] Static wiring tests: index.html ids + `10-track-replay.js` script tag,
  JS functions/DOM refs, `.replay-*` CSS classes.
- [ ] Run suite → new tests FAIL.
- [ ] Commit: `test: add TDD tests for track replay endpoint and circuit-tab wiring`

### Task 2: CSS styles

**Files:** Modify `static/css/styles.css`

- [ ] Replay card, controls row, selects, play button, scrubber, speed toggle,
  map shell, track path, car dots/labels/highlight.
- [ ] Commit: `style: add styles for track position replay card`

### Task 3: Backend endpoint

**Files:** Modify `app.py`

- [ ] `REPLAY_MAX_POINTS_PER_DRIVER = 400` constant.
- [ ] `/api/track_replay` route reusing `build_lap_telemetry_window`,
  `downsample_telemetry`, per-key lock, TTL rules, stale fallback; groups
  location samples per driver into compact `[t, x, y]` arrays.
- [ ] Backend tests PASS.

### Task 4: Frontend

**Files:** Create `static/js/10-track-replay.js`; modify
`templates/index.html`, `static/js/01-state-helpers.js`,
`static/js/02-dom.js`, `static/js/03-api-settings.js`,
`static/js/05-session-load.js`

- [ ] index.html: replay card markup in `#circuit-view` + script tag for
  `10-track-replay.js`.
- [ ] State: `replayCache` + `createReplayState()` (playing, t, speed, rafId);
  reset and RAF-cancel on session select; `setupReplaySection()` called after
  session load.
- [ ] DOM refs; event listeners (driver/lap selects, play button, scrubber,
  speed toggle, circuit-view tab switch → `maybeAutoLoadReplay()`).
- [ ] 10-track-replay.js: projection (circuit_info bounds, fallback to
  reference-trace bounds), base SVG build, RAF loop with binary-search +
  linear interpolation, gap hiding, scrubber/time-label sync.
- [ ] Full suite PASS; verify in browser preview with a real session.
- [ ] Commit: `feat: add single-lap track position replay to the circuit tab`
