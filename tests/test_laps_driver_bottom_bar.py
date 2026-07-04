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
        mobile_rule = self._css_rule("@media (max-width: 600px)")

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
        self.assertIn(".stats-grid", mobile_rule)
        self.assertIn("grid-template-columns: 1fr;", mobile_rule)

    def test_laps_driver_pill_markup_is_compact(self):
        self.assertIn("function renderLapsDriverSidebar()", self.dashboard_js)
        self.assertIn("driver-pill-code", self.dashboard_js)
        self.assertIn("driver-pill-meta", self.dashboard_js)
        self.assertIn("pill-team-dot", self.dashboard_js)


if __name__ == "__main__":
    unittest.main()
