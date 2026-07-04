# Design: Car Telemetry Deep-Dive (Speed Trace on Laps Tab)

Phase 2 item 3 of `2026-07-04-project-review-and-enhancement-plan.md`: consume the
OpenF1 `car_data` endpoint (speed, throttle, brake, gear, DRS) for a selected lap
and render a speed trace + driver inputs chart on the **Laps & Stints** tab.

## 1. Objectives

- Let the user pick any lap of the selected driver (defaulting to the fastest lap)
  and see per-sample telemetry for that lap.
- Render two synchronized SVG charts:
  1. **Speed trace** (km/h over seconds into the lap) with DRS-active zones shaded.
  2. **Driver inputs** (throttle % and brake % over the same time axis).
- Show summary stat chips: top speed, average speed, full-throttle share,
  braking share, and DRS activation count.
- Keep OpenF1 traffic bounded: date-range querying (one lap only), server-side
  downsampling, and permanent caching for historical sessions.

## 2. Backend: `/api/car_telemetry`

`car_data` has no `lap_number` column upstream — it must be queried by date range.
Rather than trusting client-supplied dates (which would reopen the Phase 0
path-traversal / cache-poisoning surface), the endpoint takes **integers only**
and derives the date window server-side from the already-cached laps data:

```
GET /api/car_telemetry?session_key=<int>&driver_number=<int>&lap_number=<int>
```

Handling:

1. Validate all three params with `parse_int_param` (400 otherwise).
2. Resolve the lap from `get_cached_api` on the existing
   `laps_{session_key}_{driver_number}.json` cache (fetches from OpenF1 on miss).
3. Compute the window: `date_start` → `date_start + lap_duration`. If
   `lap_duration` is missing (in/out laps), fall back to the next lap's
   `date_start`. If no usable window exists → 404 JSON error.
4. Fetch `https://api.openf1.org/v1/car_data?session_key=&driver_number=&date>=START&date<END`.
   Dates are formatted as naive UTC ISO strings (no `+00:00` suffix) so the query
   string stays clean.
5. Convert each sample's `date` to `t` = seconds since lap start (rounded to ms),
   drop samples outside the window, sort by `t`, and downsample by stride to at
   most `TELEMETRY_MAX_POINTS` (700), always keeping the final sample.
6. Cache the **processed** payload as
   `car_telemetry_{session_key}_{driver_number}_{lap_number}.json` — permanent for
   historical sessions, 5-minute TTL otherwise (same rules as `get_cached_api`),
   with the per-key fetch lock and stale-cache-on-failure fallback.

Response shape:

```json
{
  "session_key": 9999, "driver_number": 1, "lap_number": 23,
  "lap_date_start": "2026-05-24T13:03:00+00:00", "lap_duration": 90.123,
  "sample_count": 333, "downsampled": false,
  "telemetry": [
    {"t": 0.0, "speed": 280, "throttle": 100, "brake": 0, "gear": 8, "drs": 12},
    ...
  ]
}
```

`drs` is passed through raw; the frontend treats values 10/12/14 as DRS-active
(per OpenF1 community mapping).

## 3. Frontend: Laps tab telemetry section

New `Lap Telemetry` section in `#laps-view` below the Lap Time Progression chart:

- A `<select id="telemetryLapSelect">` listing the driver's laps that carry a
  `date_start` (label: `Lap N — 1:31.234`, fastest lap marked `★ fastest` and
  selected by default).
- `#telemetryStats` — stat chips row (top speed, avg speed, full throttle %,
  brake %, DRS zones).
- `#telemetrySpeedChart` and `#telemetryInputsChart` — SVG charts sharing the
  time axis, both with a hover crosshair. The crosshair is synchronized: moving
  over either chart shows a vertical guide in both plus a tooltip with t, speed,
  gear, throttle, brake and DRS state at the nearest sample.

Data flow (`09-laps-tab.js`):

- `selectDriverForStats` populates the lap selector and calls
  `maybeAutoLoadTelemetry()`, which only fetches when the Laps tab is actually
  visible (`state.currentTab === 'laps-view'`) — the session-load auto-select of
  a driver must not fire hidden `car_data` requests.
- Switching to the Laps tab triggers `maybeAutoLoadTelemetry()` for the pending
  selection; changing the select loads that lap.
- Responses are memoized in `state.telemetryCache` keyed
  `sessionKey_driverNumber_lapNumber` (cleared on session change); stale
  responses (user already moved to another driver/lap) are discarded.
- Loading / error / no-data states are rendered inside the chart containers,
  matching the existing chart empty-state pattern.

Chart specifics:

- Speed trace: y-axis 0 → max speed rounded up to the next 50 km/h; DRS-active
  sample runs shaded via `.telemetry-drs-shading` rects with a `DRS` label.
- Inputs chart: fixed 0–100 y-axis; throttle line (green) and brake line (red),
  with a small legend.
- Reuses the shared `.chart-tooltip` element and the existing
  `chart-grid-line` / `chart-axis-line` / `chart-axis-text` SVG classes.

## 4. Styles (`static/css/styles.css`)

New classes: `.telemetry-section`, `.telemetry-lap-select-wrapper` (mirrors
`.compare-ref-select`), `.telemetry-stats` + `.telemetry-stat-chip`,
`.telemetry-chart`, `.telemetry-speed-line`, `.telemetry-throttle-line`,
`.telemetry-brake-line`, `.telemetry-drs-shading` + `.telemetry-drs-text`,
`.telemetry-crosshair`, `.telemetry-legend` + swatches.

## 5. Testing Plan

`tests/test_car_telemetry.py`, following the existing suite patterns:

1. **Param validation** — missing/traversal/non-numeric `session_key`,
   `driver_number`, `lap_number` all return 400.
2. **Date-window fetch** — with a seeded laps cache, the endpoint queries
   `car_data` with `date>=<lap start>` / `date<<lap end>` and returns relative
   `t` values; samples outside the window are dropped.
3. **Fallback window** — a lap without `lap_duration` uses the next lap's
   `date_start`; a lap with no usable window returns 404; unknown lap 404.
4. **Downsampling** — an oversized sample set is reduced to
   `TELEMETRY_MAX_POINTS`, keeping first/last samples, `downsampled: true`.
5. **Caching** — a second request is served from
   `car_telemetry_*.json` without another upstream fetch.
6. **Static wiring** — index.html contains the new section/select/chart ids;
   the concatenated dashboard JS wires the DOM refs, `loadLapTelemetry`,
   `renderTelemetryCharts` and `/api/car_telemetry`; styles.css contains the
   new `.telemetry-*` classes.
