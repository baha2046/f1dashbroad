# Compare Lap Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Compare tab where users can freely select drivers and compare their Lap Time Progression curves.

**Architecture:** This is a frontend-only feature. It reuses the existing per-driver lap API, `state.laps` cache, team-color helpers, lap formatting, outlier handling, and safety-car shading logic.

**Tech Stack:** Quart template HTML, vanilla JavaScript, vanilla CSS, Python unittest static wiring tests.

---

## File Structure

- Modify `templates/index.html` to add the Compare tab button and Compare view markup.
- Modify `static/js/dashboard.js` to add compare state, DOM selectors, selection handlers, on-demand lap loading, and SVG multi-line chart rendering.
- Modify `static/css/styles.css` to add Compare layout, selector, legend, chart, and responsive styles.
- Create `tests/test_compare_tab.py` for failing-first static wiring coverage.
- Keep this implementation plan and the design note in `doc/`.

## Tasks

### Task 1: Static Wiring Test

**Files:**
- Create: `tests/test_compare_tab.py`

- [ ] **Step 1: Write the failing test**

```python
import unittest
from pathlib import Path


class CompareTabStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = (self.root / "static" / "js" / "dashboard.js").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_dashboard_contains_compare_tab_and_chart_containers(self):
        self.assertIn('data-tab="compare-view"', self.index_html)
        self.assertIn('id="compareDriverList"', self.index_html)
        self.assertIn('id="compareChartContainer"', self.index_html)
        self.assertIn('id="compareLegend"', self.index_html)
        self.assertIn('id="compareHideOutliers"', self.index_html)

    def test_dashboard_js_wires_compare_state_and_rendering(self):
        self.assertIn("selectedCompareDrivers: []", self.dashboard_js)
        self.assertIn("compareDriverList: document.getElementById('compareDriverList')", self.dashboard_js)
        self.assertIn("compareChartContainer: document.getElementById('compareChartContainer')", self.dashboard_js)
        self.assertIn("function renderCompareDriverSelector()", self.dashboard_js)
        self.assertIn("async function toggleCompareDriver(driverNumber)", self.dashboard_js)
        self.assertIn("function renderCompareLapChart()", self.dashboard_js)

    def test_compare_tab_has_dedicated_styles(self):
        self.assertIn(".compare-layout", self.styles_css)
        self.assertIn(".compare-driver-pill", self.styles_css)
        self.assertIn(".compare-legend", self.styles_css)
        self.assertIn("#compareChartContainer", self.styles_css)
        self.assertIn(".compare-chart-line", self.styles_css)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python3 -m unittest tests.test_compare_tab`

Expected: `FAIL` because Compare tab markup, JS wiring, and CSS classes do not exist yet.

### Task 2: Compare Markup

**Files:**
- Modify: `templates/index.html`

- [ ] **Step 1: Add the tab button**

Add a tab button with `id="tab-compare"` and `data-tab="compare-view"`.

- [ ] **Step 2: Add the view**

Add a Compare view containing `compareDriverList`, `compareHideOutliers`, `compareSelectedCount`, `compareLegend`, and `compareChartContainer`.

### Task 3: Compare JavaScript

**Files:**
- Modify: `static/js/dashboard.js`

- [ ] **Step 1: Add state and DOM selectors**

Add `selectedCompareDrivers: []` to state and DOM references for the Compare view.

- [ ] **Step 2: Add selector rendering**

Implement `renderCompareDriverSelector()` to create toggle pills for all drivers.

- [ ] **Step 3: Add selection behavior**

Implement `toggleCompareDriver(driverNumber)` to update selection, load missing laps via `fetchDriverLaps()`, and rerender the Compare chart.

- [ ] **Step 4: Add multi-driver SVG chart**

Implement `renderCompareLapChart()` with shared axes, one line per selected driver, selected-driver legend, safety-car shading, and hover tooltips.

### Task 4: Compare CSS

**Files:**
- Modify: `static/css/styles.css`

- [ ] **Step 1: Add Compare layout styles**

Add styles for `.compare-layout`, `.compare-sidebar`, `.compare-content`, selector pills, controls, legend, and chart container.

- [ ] **Step 2: Add responsive behavior**

At tablet width, stack sidebar above chart and wrap selector pills.

### Task 5: Verification

**Files:**
- Test: `tests/test_compare_tab.py`
- Test: `tests/test_race_control_feed.py`

- [ ] **Step 1: Run focused Compare tests**

Run: `.venv/bin/python3 -m unittest tests.test_compare_tab`

Expected: `OK`.

- [ ] **Step 2: Run full suite**

Run: `.venv/bin/python3 -m unittest discover tests`

Expected: all tests pass.
