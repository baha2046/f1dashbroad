# Laps & Stints race-engineering redesign

Date: 2026-07-11

## Goal

Turn the Laps & Stints tab from a long information panel with a fixed driver bar into a focused race-engineering workspace that makes pace, strategy, lap detail, and telemetry easier to scan and explore.

## Interface

- Added a session-aware race-engineering hero with a compact live channel indicator.
- Moved the driver selector into the document flow as a horizontally scrollable driver-channel deck.
- Expanded driver controls with team identity, car number, selected state, keyboard focus, and accessible pressed state.
- Rebuilt the selected-driver header as a team-coloured cockpit with headshot, profile context, and four richer pace metrics.
- Added useful metric context: fastest-lap number, theoretical gain, representative sample size, and recorded run count.
- Reframed tyre data as a stint plan with run/compound/lap summary, a generated compound legend, lap ranges, and keyboard-readable stint tooltips.
- Paired the pace trace and lap breakdown at wide widths, with automatic stacking at narrower container sizes.
- Restyled the pace plot, timing table, telemetry controls, summary chips, and graph stages into one visual system.

## Interaction

- Every lap number is now an Analyze control that selects the same lap in the telemetry lab and scrolls the lab into view.
- The selected telemetry lap stays synchronized with the highlighted row and exposes `aria-pressed` state.
- Existing pace-chart hover synchronization, clean-lap filtering, telemetry lap selection, and two-lap comparison remain intact.
- Stint segments are focusable and expose complete run details through accessible labels.

## Responsive design

- The tab uses a named inline-size container for component-level breakpoints.
- Driver overview metrics collapse from four columns to two and then one.
- Pace and lap panels stack before the app reaches narrow mobile widths.
- Telemetry comparison controls and stat chips reflow without relying on viewport-only media queries.
- Motion transitions are removed when reduced motion is requested.

## Files

- `templates/index.html`
- `static/css/styles.css`
- `static/js/02-dom.js`
- `static/js/03-api-settings.js`
- `static/js/07-driver-grids.js`
- `static/js/09-laps-tab.js`
- `tests/test_laps_driver_bottom_bar.py`

## Verification

- Run: `.venv/bin/python3 -m unittest discover -s tests`
- Visual checks: empty state, driver switching, stint labels and tooltips, pace hover/table sync, direct lap analysis, telemetry comparison, and compact-width layouts.
