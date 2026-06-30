# Compare Charts UX Enhancement — Design

Date: 2026-07-01
Status: Approved (design)
Topic: Improve interactivity of the Compare tab charts

## Goal

Improve the user experience of the two existing Compare-tab charts —
**Lap Time Progression** (`renderCompareLapChart`) and **Gap to Leader**
(`renderCompareGapChart`) — by adding three interactions, applied consistently
to **both** charts:

1. **Unified hover crosshair + tooltip** — a vertical guide line tracks the
   cursor and one tooltip shows every visible driver's value at that lap
   (replacing the current per-dot hover tooltips).
2. **Interactive legend** — click a legend item to temporarily hide/show a
   driver's line (without unloading data or deselecting its pill); hover to
   highlight one line and dim the others.
3. **Zoom / pan** — drag horizontally to select a lap range; both charts zoom
   into it (synced), with a **Reset Zoom** button to restore the full range.

## Chosen Approach: Shared Interaction Layer (Approach A)

The two chart renderers currently duplicate most of their rendering logic. We
extract the new interaction behavior into reusable helpers that both renderers
call through a small descriptor object, so the behavior stays consistent and
does not drift between charts.

Rejected alternatives:
- **Inline per-chart** — duplicates ~150 lines of interaction code across both
  charts; they would drift over time.
- **Charting library (uPlot/Chart.js)** — large rewrite, adds a dependency to a
  no-build vanilla-JS app, and would require re-implementing the custom
  pit/safety-car/VSC annotations and team-color styling.

## Environment Notes

- Front end is vanilla JS with no build step: `static/js/dashboard.js`,
  `static/css/styles.css`, `templates/index.html`.
- Tests are Python `unittest` cases that assert specific strings/DOM hooks exist
  in the JS/HTML/CSS files (see `tests/test_compare_tab.py`,
  `tests/test_compare_gap_chart.py`). New behavior is tested by asserting its
  DOM hooks/classes exist, matching the repo's current style.
- Run tests with `.venv/bin/python3`.

## Architecture & Shared State

Add a Compare-view interaction state object on the existing `state`:

```js
state.compareView = {
  lapWindow: { min: null, max: null },   // null = full range; zoom domain (synced across both charts)
  hiddenDrivers: new Set(),              // driver numbers hidden via legend (data stays loaded)
  highlightedDriver: null,               // driver number highlighted on legend hover, else null
  hoverLap: null                         // current crosshair lap (synced across both charts)
};
```

Three reusable helpers in `dashboard.js`, called by **both**
`renderCompareLapChart` and `renderCompareGapChart`:

- `attachCompareCrosshair(svg, ctx)` — transparent overlay rect + vertical guide
  line group + unified multi-driver tooltip.
- `renderCompareLegendInteractive(selectedDrivers)` — replaces the current
  static legend with clickable/hoverable items.
- `attachCompareZoom(svg, ctx)` — drag-to-select band that sets `lapWindow`.

### Interface boundary: the `ctx` descriptor

Each chart passes a descriptor; the helpers read only `ctx`, never chart
internals:

```js
ctx = {
  kind: 'lap' | 'gap',
  svgNamespace,
  getX, getY,                // scale functions (already honor lapWindow)
  series,                    // [{ driver, driverNumber, teamHex, points/laps... }]
  minLap, maxLap,            // current visible domain (after lapWindow clamp)
  padding, chartWidth, chartHeight,
  valueFor(lapNumber, driverNumber),  // returns numeric value or null at a lap
  formatValue(value)                  // 'lap' -> formatLapTime; 'gap' -> +Xs
}
```

This lets one crosshair/zoom implementation serve both charts, with chart-
specific value lookup and formatting injected.

## Unified Crosshair + Tooltip

- Each chart appends a single transparent `<rect>` covering the plot area,
  listening for `mousemove` / `mouseleave`. The existing per-dot
  `mouseenter`/`mouseleave` tooltip listeners are removed in favor of this one
  overlay.
- On `mousemove`: map cursor X to the nearest lap number within the current
  `lapWindow`, set `state.compareView.hoverLap`, draw the vertical guide line,
  and render **one** tooltip listing every visible (non-hidden) driver's value
  at that lap. Rows are sorted best-first, each colored by team. A driver with
  no lap at that number shows `--`.
- Because both charts read `state.compareView.hoverLap`, moving the cursor over
  one chart also draws the guide line on the other (synced). Only the crosshair
  group is redrawn on move — not the full chart.
- For the lap-time chart, the tooltip retains sector breakdown (S1/S2/S3) and
  pit annotations for the hovered driver row where available; the gap chart
  shows the gap value per driver.

## Interactive Legend

- Legend items become `<button>` elements.
- **Click** toggles the driver's number in `state.compareView.hiddenDrivers`.
  Hidden drivers' line + dots get a `hidden` class (not rendered / fully
  transparent); the driver stays loaded and its pill stays active.
- **Hover** sets `state.compareView.highlightedDriver` → that line renders at
  full opacity while others get a `dimmed` class; `mouseleave` clears it.
- Hidden drivers are excluded from axis min/max recomputation so the remaining
  lines use the full vertical space.
- The driver pills are unchanged (they still load/unload data). A driver hidden
  via the legend keeps its pill active.

## Zoom / Pan (synced, drag-to-select)

- The overlay rect also handles drag: `mousedown` starts a selection;
  `mousemove` draws a translucent selection band; `mouseup` sets
  `state.compareView.lapWindow` to the selected lap range and re-renders both
  charts. A drag shorter than ~5px is treated as a click (crosshair), not a
  zoom.
- All X-scaling respects `lapWindow`: `getX`, X grid lines, axis ticks, and
  safety-car/VSC shading. Points and path segments outside the window are
  clipped.
- A **Reset Zoom** button (`id="compareResetZoom"`) lives in the Compare
  controls row and is shown only when `lapWindow` is set; clicking clears
  `lapWindow` and re-renders. Both charts always share one `lapWindow`.

## Data Flow

1. User interacts (hover / legend click / drag) → mutate `state.compareView`.
2. Crosshair/highlight changes redraw only the lightweight crosshair/legend
   layers.
3. Zoom changes (`lapWindow`) trigger a full re-render of both charts via the
   existing `renderCompareLapChart()` (which already calls
   `renderCompareGapChart`).
4. Selecting/deselecting drivers via pills behaves as today; on deselect, the
   driver number is also removed from `hiddenDrivers`.

## Edge Cases

- **0–1 visible drivers:** crosshair/tooltip still works for 1; with 0 visible
  (none selected or all hidden) show the existing empty-state prompt.
- **All drivers hidden via legend:** show an empty-state message indicating all
  lines are hidden; legend remains interactive to unhide.
- **Zoom to a single lap:** guard scale math when `maxLap === minLap`
  (reuse existing center-fallback behavior).
- **Non-race sessions:** Gap to Leader chart remains hidden as today; crosshair
  sync simply has no second chart to update.
- **Outlier toggle:** crosshair tooltip reflects the current outlier setting;
  outlier dots/laps follow existing rules.
- **Reset on session change:** clear `state.compareView` (lapWindow,
  hiddenDrivers, highlightedDriver, hoverLap) when the selected session changes.

## Testing

Extend the existing Python string-assertion tests (and/or add a focused new
test module) to assert the new DOM hooks/classes exist:

- `templates/index.html`: `id="compareResetZoom"` control.
- `static/js/dashboard.js`: helper names and wiring —
  `attachCompareCrosshair`, `renderCompareLegendInteractive`,
  `attachCompareZoom`, `state.compareView`, `hiddenDrivers`, `lapWindow`,
  `compareResetZoom` listener.
- `static/css/styles.css`: new classes — crosshair guide line, unified tooltip,
  legend button states (`dimmed`, `hidden`), zoom selection band, reset button.

This matches the repo's current test approach (asserting presence of DOM/JS/CSS
hooks rather than executing the front end).

## Out of Scope (YAGNI)

- Synced crosshair was already covered above; mobile/touch tooltip support and
  scroll-wheel zoom are intentionally excluded for this iteration.
- No new comparison metrics (sectors-as-charts, tyre/stint overlays, etc.).
