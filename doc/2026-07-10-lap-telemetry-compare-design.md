# Design: Lap Telemetry Compare (Two-Lap Overlay on the Laps Tab)

Builds on the single-lap **Lap Telemetry** section
(`doc/2026-07-04-car-telemetry-design.md`). Users want the classic F1 overlay:
two laps — same driver / different lap, or two different drivers — aligned by
**distance** with speed and input traces plus a **time-delta** chart.

## 1. Objectives

- Compare telemetry between a "main" lap (the selected driver's lap already
  shown) and a "reference" lap chosen from any driver, including the same driver
  (lap-vs-lap).
- Align both laps by cumulative **distance** (not time) so corners line up.
- Show a time-delta trace (gap = main − ref) so the user sees where time is won
  or lost around the lap.
- Reuse the existing per-lap `car_data` fetch + cache; add no new server cache
  file and leave `/api/car_telemetry` byte-identical.

## 2. Backend

### 2.1 Refactor

The body of `api_car_telemetry` (cache check → laps fetch → window build →
car-data fetch → downsample → payload build → cache write) is extracted into:

```python
async def build_car_telemetry_payload(session_key, driver_number, lap_number, year)
    -> (payload, error_response)   # exactly one is non-None
```

`error_response` is a ready-to-return Flask response (the 404 tuple, or a
stale-cache body). `api_car_telemetry` now just parses params, calls the helper,
and wraps a successful payload in `session_response` — its responses, status
codes, and `car_telemetry_v2_*` cache files are unchanged.

### 2.2 Distance & delta math (pure functions)

`compute_telemetry_distance(telemetry)` → parallel list of cumulative distances
(metres). Speed (km/h) is converted to m/s and integrated **trapezoidally**:

```
d[0] = 0
d[i] = d[i-1] + (v[i-1] + v[i]) / 2 * (t[i] - t[i-1])
```

Rounded to 0.1 m. Missing speed carries the previous speed forward; a missing or
non-increasing `t` contributes 0.

`compute_telemetry_delta(main, ref, points=200)`:

- Integrate distances for both laps.
- Common range = `0 .. min(main_total, ref_total)`. If either lap has < 2
  samples or the common range ≤ 0 → `[]`.
- For `points` evenly spaced distances across the common range (both endpoints
  included), linearly interpolate each lap's `t` from its `(distance, t)` series
  and emit `{"d": round(d,1), "gap": round(t_main - t_ref, 3)}`.
- **Positive gap = the main lap is slower (behind) at that distance.**

**Assumption / accuracy:** OpenF1 `car_data` speed is sampled at roughly 4 Hz.
Trapezoidal integration of those samples yields *approximate* distances (a few
metres of drift is expected and does not accumulate into the delta meaningfully
because both laps use the same integration and are compared over their shared
range). This is a visual-alignment aid, not a survey-grade distance.

### 2.3 Endpoint

```
GET /api/telemetry_compare
    ?session_key=<int>&driver_number=<int>&lap_number=<int>
    &ref_driver_number=<int>&ref_lap_number=<int>[&year=<int>]
```

- All five params validated with `parse_int_param` → 400 on failure (same style
  as `api_car_telemetry`); `year` optional via `parse_optional_year_param`.
- Builds both lap payloads through `build_car_telemetry_payload`, reusing/writing
  the same per-lap caches. If either returns an error, that error is propagated
  verbatim (unknown ref lap ⇒ the same 404 shape the single endpoint gives).
- Each payload's samples are enriched with `"d"` (metres) on **copies**
  (`telemetry_payload_with_distance`) — the cached single-lap payloads stay
  `d`-free, so `/api/car_telemetry` output is unchanged.
- Comparing a lap to itself is allowed (delta ≈ 0); no special-casing.

Response:

```json
{
  "main":  { ...car_telemetry payload, telemetry[i].d added... },
  "ref":   { ...car_telemetry payload, telemetry[i].d added... },
  "delta": [ {"d": 0.0, "gap": 0.0}, {"d": 37.5, "gap": 0.12}, ... ]
}
```

## 3. Frontend flow (`static/js/09-laps-tab.js`)

- `setupTelemetrySection` populates the main lap select (unchanged) and the new
  `#telemetryCompareDriverSelect` (`No comparison` + all drivers sorted by team,
  labelled `ACR — Team`). An active comparison is restored across a
  main-driver/lap change so the selection survives section re-runs.
- Picking a compare driver ensures that driver's laps are loaded (reusing
  `fetchDriverLaps`), fills `#telemetryCompareLapSelect` (fastest preselected,
  same `Lap N — 1:31.234 ★` format), shows it, and loads the comparison.
- `maybeAutoLoadTelemetry` gates on `state.currentTab === 'laps-view'` and routes
  to `loadTelemetryComparison()` when a comparison is pending, otherwise the
  single-lap load — so switching to the Laps tab loads a pending comparison too.
- `loadTelemetryComparison` fetches `/api/telemetry_compare`, memoises in
  `state.telemetryCache` under `cmp_${sessionKey}_${dn}_${ln}_${rdn}_${rln}`, and
  uses a stale-response guard (main driver/lap **and** compare selects must still
  match). On error it messages the user and falls back to the single-lap render.
- Changing the main lap while a comparison is active re-fetches the comparison
  (the compare key includes the main lap). Session change resets
  `state.telemetryCompare` and everything repopulates.

### Rendering choices

- **Time → distance axis switch:** in compare mode the speed and inputs charts
  use each sample's `d` (metres) as the x value (`buildTelemetryChart` gained a
  `formatXLabel` hook; single-lap seconds axis is unchanged). x-max = max of the
  two laps' total distance.
- Main lap: existing solid lines (`--team-color` speed, green throttle, red
  brake). Ref lap: dashed lines (`.telemetry-ref-speed-line` with
  `--ref-team-color`, `.telemetry-ref-throttle-line`, `.telemetry-ref-brake-line`)
  drawn underneath. Dashing is the differentiator; colour may coincide for
  teammates / same-driver comparisons.
- **DRS shading:** only the **main** lap's DRS zones are shaded — two overlapping
  shade sets would be visual noise.
- **Delta chart** (`#telemetryDeltaChart`, shown via `#telemetryDeltaWrapper`):
  `gap` vs distance, y-axis symmetric around a dashed zero line
  (`.telemetry-delta-zero`), line `.telemetry-delta-line`. Heading states
  "above zero = <main> behind <ref>".
- Stat chips show both values per chip (`329 / 325 km/h`). Legend identifies both
  laps (solid main swatch, dashed ref swatch) plus throttle/brake.
- A shared distance crosshair across all three charts shows both laps'
  speed/throttle/brake/gear and the gap at the nearest distance.

## 4. Styles (`static/css/styles.css`)

New classes next to the existing telemetry block: `.telemetry-compare-select-wrapper`,
`.telemetry-ref-speed-line` / `.telemetry-ref-throttle-line` /
`.telemetry-ref-brake-line` (dashed, reduced opacity), `.telemetry-delta-heading`,
`#telemetryDeltaChart`, `.telemetry-delta-line`, `.telemetry-delta-zero`, and a
`.telemetry-legend-swatch.ref` dashed modifier.

## 5. Testing plan (`tests/test_telemetry_compare.py`)

Follows `tests/test_car_telemetry.py` patterns exactly.

1. **Param validation** — each of the five int params missing / non-numeric /
   traversal-ish → 400.
2. **Happy path** — seed `laps_v2_4242_1.json` and `laps_v2_4242_44.json`, stub
   the car-data feed per driver window; assert `main`/`ref`/`delta` present,
   `main.telemetry[i].d` present and increasing, delta non-empty with `d`/`gap`.
3. **Delta math** (pure functions, no Flask) — two constant-speed synthetic laps
   (180 vs 200 km/h over the same distance) match the analytic gap within
   tolerance; equal laps → gaps ≈ 0; empty / 1-sample input → `[]`.
4. **Error propagation** — unknown ref lap → 404.
5. **Caching / no-mutation** — a second compare call adds no upstream car-data
   fetches (both per-lap caches hit), and `/api/car_telemetry` for the same lap
   is served from the same cache with **no** `d` field.
6. **Static wiring** — index.html, the concatenated dashboard JS, and styles.css
   contain the new ids / functions / classes.
