# Compare Lap Progression Design

## Goal

Add a Compare tab that lets users freely select drivers and compare their Lap Time Progression curves for the selected session.

## Approved Approach

Use an uncapped multi-select driver list. Each selected driver loads lap data on demand through the existing `/api/laps?session_key=...&driver_number=...` endpoint and reuses the frontend `state.laps` cache. The chart uses team colors, a visible legend, and the same pit/slow-lap filtering model as the existing single-driver Lap Time Progression chart.

## UI

- Add a `Compare` tab beside the current dashboard tabs.
- The Compare view contains a left driver selector and a main chart panel.
- Driver choices are toggle buttons using driver acronyms, numbers, and team color dots.
- The chart area shows an empty state until at least one driver is selected.
- A filter checkbox controls whether slow pit/outlier laps are hidden from trendlines.
- A legend shows selected drivers and their line colors.

## Data Flow

- `state.selectedCompareDrivers` stores selected driver numbers.
- `fetchDriverLaps()` remains the single source for per-driver lap data and cache reuse.
- Selecting or deselecting a driver rerenders the comparison chart.
- The chart computes one shared lap axis and one shared time axis across selected drivers so curves are directly comparable.

## Error Handling

- Drivers with no lap data appear in the legend only if selected, but do not produce a line.
- If no selected driver has valid lap durations, the chart shows a no-data empty state.
- Failed lap fetches are logged and skipped without breaking the whole comparison view.

## Testing

- Add static wiring tests that fail until the tab, DOM IDs, JS state/selectors/functions, and CSS classes exist.
- Run the existing unittest suite with `.venv/bin/python3`.
