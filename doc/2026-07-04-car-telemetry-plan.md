# Car Telemetry Deep-Dive Implementation Plan

**Goal:** Add a per-lap car telemetry view (speed trace + throttle/brake inputs,
DRS zones, summary stats) to the Laps & Stints tab, backed by a new
`/api/car_telemetry` endpoint that date-range-queries OpenF1 `car_data`,
downsamples, and caches per lap.

**Design:** see `2026-07-04-car-telemetry-design.md`.

**Tech Stack:** Python (Quart, httpx), JavaScript (vanilla, SVG), CSS, Python unittest.

## Global Constraints

- Keep implementation documents under the `doc/` directory.
- Use Python in `.venv/bin/python3` for testing the web app.
- Endpoint params are integers only (Phase 0 hardening rules); no client-supplied
  dates reach cache file names or upstream URLs.

---

### Task 1: TDD tests

**Files:** Create `tests/test_car_telemetry.py`

- [ ] Param-validation tests: 400 for missing / traversal / non-numeric
  `session_key`, `driver_number`, `lap_number`.
- [ ] Endpoint tests against a temp cache dir seeded with
  `laps_{sk}_{dn}.json`: date-window URL construction, relative `t` output,
  out-of-window sample filtering, missing-duration fallback to next lap start,
  unknown lap → 404, downsampling to `TELEMETRY_MAX_POINTS`, second request
  served from cache (single upstream fetch).
- [ ] Static wiring tests for index.html ids, dashboard JS functions/DOM refs,
  and `.telemetry-*` CSS classes.
- [ ] Run: `.venv/bin/python3 -m unittest tests/test_car_telemetry.py` → expect FAIL.
- [ ] Commit: `test: add TDD tests for car telemetry endpoint and laps-tab wiring`

### Task 2: CSS styles

**Files:** Modify `static/css/styles.css`

- [ ] Append telemetry section styles: section/header/select, stat chips,
  chart shells, speed/throttle/brake line classes, DRS shading, crosshair,
  legend swatches.
- [ ] Commit: `style: add styles for lap telemetry charts and stat chips`

### Task 3: Backend endpoint

**Files:** Modify `app.py`

- [ ] Add `TELEMETRY_MAX_POINTS = 700`, ISO-parse/format helpers,
  `build_lap_telemetry_window(laps, lap_number)`, `downsample_telemetry(samples)`
  and `build_telemetry_payload(...)`.
- [ ] Add `/api/car_telemetry` route: int validation → session TTL rules →
  cached-laps lookup → `car_data` date-range fetch → process + downsample →
  atomic cache write under the per-key lock, stale fallback on upstream failure.
- [ ] Run: `.venv/bin/python3 -m unittest tests/test_car_telemetry.py` →
  backend tests PASS.

### Task 4: Frontend

**Files:** Modify `templates/index.html`, `static/js/01-state-helpers.js`,
`static/js/02-dom.js`, `static/js/03-api-settings.js`, `static/js/09-laps-tab.js`

- [ ] index.html: telemetry section markup in `#laps-view` (select, stats row,
  two chart containers).
- [ ] 01-state-helpers.js: `telemetryCache` in state (reset on session select in
  05-session-load.js).
- [ ] 02-dom.js: DOM refs for the new elements.
- [ ] 03-api-settings.js: change listener on `#telemetryLapSelect`; trigger
  `maybeAutoLoadTelemetry()` when switching to the Laps tab.
- [ ] 09-laps-tab.js: `setupTelemetrySection`, `maybeAutoLoadTelemetry`,
  `loadLapTelemetry`, `renderTelemetryStats`, `renderTelemetryCharts` with the
  synchronized crosshair.
- [ ] Run: `.venv/bin/python3 -m unittest discover tests` → full suite PASS.
- [ ] Commit: `feat: add per-lap car telemetry deep-dive to the laps tab`
