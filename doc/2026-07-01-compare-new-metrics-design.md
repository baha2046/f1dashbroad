# Compare Tab — New Metrics Design

**Date:** 2026-07-01
**Status:** Approved (pending implementation plan)

## Summary

Extend the Compare tab with three new synced charts — **Position-per-lap**, **Head-to-Head Delta**, and **Tyre Strategy** — built on the existing `ctx`-descriptor interaction layer introduced in `2026-07-01-compare-charts-ux-design.md`. A new chip toolbar lets the user show/hide each chart independently. One new cached backend endpoint (`/api/position`) is required; the other two charts reuse data already loaded into `state`.

This implements the "new comparison metrics" enhancement explicitly listed as out-of-scope in the prior UX design.

## Goals

- Add three driver-vs-driver comparison charts within a single session.
- Reuse the existing synced crosshair, interactive legend, and drag-zoom rather than rebuilding interaction logic (Approach A).
- Keep the current default behavior (Lap Times + Gap to Leader visible) unchanged.

## Non-Goals

- Cross-session or cross-season comparison.
- Team/aggregate comparison.
- Mobile/touch tooltips and scroll-wheel zoom (still out of scope).
- Refactoring the existing two charts into a generic registry (Approach C rejected — YAGNI).

## Approach

**Approach A — extend the existing `ctx`-descriptor pattern.** The compare tab already exposes a `ctx` descriptor (`svg`, `padding`, `chartWidth`, `minLap`, `maxLap`, `series`, `valueFor`, `formatValue`, `detailFor`, `title`, `container`) that powers the synced crosshair, legend, and zoom across the lap-time and gap charts (`dashboard.js:1813-2036`). Position and Head-to-Head Delta are XY line charts that slot directly into this pattern. Tyre Strategy is a Gantt-style strip that shares the lap-number X-axis and zoom/crosshair but uses a lighter, non-line tooltip — the single special-case the `ctx` layer must accommodate.

Rejected alternatives: Approach B (independent renderers — inconsistent UX, code duplication), Approach C (generic chart registry — large refactor of working code).

## Layout & UX

Add a **chip toolbar** in the compare header. Each chip is a toggle button (active = chart visible):

```
[ Lap Times ] [ Gap to Leader ] [ Position ] [ Head-to-Head ] [ Tyre Strategy ]
```

- Default visible: **Lap Times** and **Gap to Leader** (preserves current behavior). New charts default hidden.
- Each chart lives in its own section that shows/hides based on its chip's state.
- Race-only chips (Gap, Position, Head-to-Head) are disabled/hidden for non-Race/Sprint sessions, matching the existing `isPitAnnotationSession` gating (`dashboard.js:905`). Tyre Strategy is available whenever stint data exists.
- All visible charts stay synced: one crosshair `hoverLap`, one `lapWindow` zoom, shared `hiddenDrivers` and `highlightedDriver` state.

## Backend — `/api/position`

Add a cached Quart proxy mirroring the existing `/api/pit` and `/api/race_control` endpoints (`app.py`).

- **Route:** `/api/position?session_key=...` → `https://api.openf1.org/v1/position?session_key=...`
- **Cache file:** `position_<session_key>.json`, same TTL rules as other session data (historical permanent, active 5 min).
- **Response:** raw OpenF1 events `{ date, session_key, meeting_key, driver_number, position }`.
- Loaded once on session select for Race/Sprint sessions, added to the existing `Promise.all` batch (`dashboard.js:750-761`), stored in `state.position`.

### Lap mapping (frontend)

Position events are timestamped, not lap-indexed. For each driver and lap, the displayed position = the position from the latest event whose `date` is less than or equal to the lap's **end time** (`date_start + lap_duration`). Precompute, once per data load, a `state.positionByLap` map: `driverNumber -> { lapNumber -> position }`, by walking each driver's time-sorted event list against their laps' end times. Laps before the first event fall back to the first known position.

## Chart A — Position-per-lap

- XY line chart via the `ctx` pattern. X = lap number (shared axis). Y = position **inverted** (P1 at top), integer ticks `1…N`.
- One team-colored step line per selected driver.
- `valueFor(lap, driver)` = mapped position from `state.positionByLap`.
- `formatValue(v)` = `P{v}`.
- Tooltip rows sorted best-first (P1 first). `detailFor(lap, driver)` shows positions gained/lost vs the previous lap (e.g. `▲2`, `▼1`, `—`).
- Reuses crosshair, legend hide/highlight, and zoom with no additional interaction code.
- Race/Sprint only.

## Chart B — Head-to-Head Delta

- XY line chart via the `ctx` pattern.
- **Reference-driver picker:** a small dropdown in this chart's header, defaulting to the leader/fastest among currently selected drivers, stored in `state.compareView.headToHeadRef`.
- Reuses the gap chart's cumulative-elapsed-time computation (`renderCompareGapChart`, `dashboard.js:2369`). Delta for driver D at lap L = `cumulativeTime(D, L) - cumulativeTime(ref, L)`.
- Y = seconds, symmetric domain around 0. Zero line = reference driver, drawn as a flat baseline. Positive = behind reference (below axis), negative = ahead (above axis).
- `formatValue(v)` = signed `+/-s.sss`. The reference driver's row is labeled `REF`.
- If the reference driver is deselected, fall back to the new leader and re-render.
- Race/Sprint only.

## Chart C — Tyre Strategy (Gantt strip)

- Not a line chart — a horizontal strategy strip: one row per selected driver, X = lap number (shared axis & zoom).
- Colored segments per stint from `state.stints` (`{ stint_number, lap_start, lap_end, compound, tyre_age_at_start }`).
- Compound colors: `SOFT`=red, `MEDIUM`=yellow, `HARD`=white, `INTERMEDIATE`=green, `WET`=blue (with a fallback for unknown compounds).
- Each segment labeled with compound initial + lap span; hover shows compound, stint number, tyre age at start, and stint length.
- Participates in the shared crosshair (vertical lap line) and zoom, but uses a lighter tooltip without value-sorting — the one special-case the `ctx` layer accommodates for non-line charts.
- Available for any session type that has stint data (not race-gated).

## State, Lifecycle & Gating

- Extend `createCompareViewState()` (`dashboard.js:22-30`) with:
  - `visibleCharts` — a `Set` of chart ids (defaults `{ lapTimes, gap }`).
  - `headToHeadRef` — reference driver number (nullable).
- Add `state.position` (raw events) and derived `state.positionByLap`; reset both on session change alongside the existing compare resets (`dashboard.js:734-735`).
- Register every visible chart's interaction context in the existing `compareInteractionContexts` array (`dashboard.js:206`) so crosshair and zoom stay synced; skip hidden charts.
- Re-render only visible charts on chip toggle, driver selection change, or reference change.

## Testing

Follow the repo's static string-assertion test style (assert presence of DOM/JS/CSS hooks; backend route + cache behavior via the Quart test client).

- `tests/test_compare_position_chart.py` — `/api/position` route + cache file naming, frontend chip, container, render function, `state.position`/`state.positionByLap` wiring.
- `tests/test_compare_head_to_head.py` — reference-driver picker, delta render function, zero baseline, signed formatting.
- `tests/test_compare_tyre_strategy.py` — chip, strip render function, compound color classes.
- Extend `tests/test_compare_tab.py` — chip toolbar and `visibleCharts` show/hide wiring.

Run with `.venv/bin/python3 -m unittest`.

## Affected Files

- `app.py` — new `/api/position` cached route.
- `templates/index.html` — chip toolbar, three new chart sections, head-to-head reference picker.
- `static/js/dashboard.js` — position fetch + lap mapping, three render functions, chip toggle wiring, state extensions, context registration.
- `static/css/styles.css` — chip toolbar styles, position/delta/tyre-strip styles, compound color classes.
- `tests/` — new and extended test modules listed above.
