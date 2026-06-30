# Gap to Leader Comparison Chart Implementation Plan

## Goal
To implement a "Gap to Leader Compare" line chart in the Compare view of the F1 Dashboard for Race and Sprint sessions.

## Design Decisions
1. **Scope of Chart**: The gap chart displays the gap (in seconds) between each selected driver and the race leader at each lap.
2. **Leader Definition**: At each lap, the race leader is the driver who has the minimum cumulative elapsed time.
3. **Data Acquisition**: Group and cache all laps fetched via `/api/laps?session_key=<session_key>` on session load for Race and Sprint sessions.
4. **Visual Style**: Align the styling exactly with the existing Compare tab. Position the "Leader" (0s gap) at the top of the Y-axis, so that trailing drivers are plotted below, indicating they are falling behind.

## Changes Made
- **index.html**: Added container `#compareGapChartSection` and `#compareGapChartContainer`.
- **styles.css**: Mapped `#compareGapChartContainer` height and size styles.
- **dashboard.js**:
  - Bound the DOM targets.
  - Added `allSessionLaps` state.
  - Set up concurrent fetch of all laps on Race/Sprint session load.
  - Implemented `renderCompareGapChart(selectedDrivers)` calculating cumulative lap times, identifying the leader per lap, and drawing SVG lines/tooltip nodes.
- **test_compare_gap_chart.py**: Created unit tests verifying markup, CSS, state, and function presence.
