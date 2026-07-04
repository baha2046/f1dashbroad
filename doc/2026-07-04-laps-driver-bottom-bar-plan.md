# Laps Driver Bottom Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Laps & Stints driver selector into a fixed bottom horizontal bar so lap graphs get the full content width.

**Architecture:** This is a frontend-only layout change. Existing IDs and driver selection behavior remain intact; only the selector wrapper classes, compact pill markup, CSS layout rules, and static regression tests change.

**Tech Stack:** Flask-rendered HTML, vanilla JavaScript, CSS, Python unittest static checks.

---

### Task 1: Static Layout Contract Test

**Files:**
- Create: `tests/test_laps_driver_bottom_bar.py`

- [ ] **Step 1: Write the failing test**

```python
import re
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class LapsDriverBottomBarTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def _css_rule(self, selector):
        pattern = re.compile(rf"{re.escape(selector)}\s*\{{(?P<body>.*?)\n\}}", re.DOTALL)
        match = pattern.search(self.styles_css)
        self.assertIsNotNone(match, f"{selector} rule is missing")
        return match.group("body")

    def test_laps_selector_uses_fixed_bottom_bar(self):
        self.assertIn('class="laps-sidebar laps-driver-bar"', self.index_html)
        self.assertIn('id="lapsDriverList"', self.index_html)

        layout_rule = self._css_rule(".laps-layout")
        sidebar_rule = self._css_rule(".laps-driver-bar")
        pills_rule = self._css_rule(".driver-pills")
        pill_rule = self._css_rule(".driver-pill")

        self.assertIn("grid-template-columns: 1fr;", layout_rule)
        self.assertIn("padding-bottom: 156px;", layout_rule)
        self.assertNotIn("240px 1fr", layout_rule)

        self.assertIn("position: fixed;", sidebar_rule)
        self.assertIn("left: calc(var(--sidebar-width) + 32px);", sidebar_rule)
        self.assertIn("right: 32px;", sidebar_rule)
        self.assertIn("bottom: 16px;", sidebar_rule)
        self.assertIn("z-index: 30;", sidebar_rule)

        self.assertIn("flex-direction: row;", pills_rule)
        self.assertIn("overflow-x: auto;", pills_rule)
        self.assertIn("flex: 0 0 auto;", pill_rule)

    def test_laps_driver_pill_markup_is_compact(self):
        self.assertIn("function renderLapsDriverSidebar()", self.dashboard_js)
        self.assertIn("driver-pill-code", self.dashboard_js)
        self.assertIn("driver-pill-meta", self.dashboard_js)
        self.assertIn("pill-team-dot", self.dashboard_js)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python3 -m pytest tests/test_laps_driver_bottom_bar.py -q`

Expected: FAIL because `.laps-driver-bar`, compact pill classes, and single-column Laps layout are not implemented yet.

### Task 2: Implement Bottom Bar

**Files:**
- Modify: `templates/index.html`
- Modify: `static/js/07-driver-grids.js`
- Modify: `static/css/styles.css`

- [ ] **Step 1: Update markup**

Change the Laps selector nav to:

```html
<nav class="laps-sidebar laps-driver-bar" aria-label="Select driver for stats">
```

- [ ] **Step 2: Update Laps pill markup**

In `renderLapsDriverSidebar()`, change `pill.innerHTML` to:

```javascript
pill.innerHTML = `
    <span class="driver-pill-code">${escapeHtml(d.name_acronym || d.last_name || d.driver_number)}</span>
    <span class="driver-pill-meta">
        <span class="pill-team-dot"></span>
        <span>${escapeHtml(String(d.driver_number))}</span>
    </span>
`;
```

- [ ] **Step 3: Update CSS**

Set `.laps-layout` to one column with bottom padding, add `.laps-driver-bar` fixed positioning matching `.compare-sidebar`, make `.driver-pills` horizontal with overflow, and make `.driver-pill` fixed-width compact pills.

- [ ] **Step 4: Run focused tests**

Run: `.venv/bin/python3 -m pytest tests/test_laps_driver_bottom_bar.py tests/test_compare_tab.py tests/test_session_autofocus.py -q`

Expected: PASS.

### Task 3: Browser Smoke Check

**Files:**
- No code files.

- [ ] **Step 1: Start or reuse the local app**

Run: `.venv/bin/python3 app.py`

- [ ] **Step 2: Check layout in browser**

Open the app, select a session, switch to Laps & Stints, and verify the driver selector is fixed at the bottom, scrolls horizontally, and the lap progression chart spans the reclaimed width.
