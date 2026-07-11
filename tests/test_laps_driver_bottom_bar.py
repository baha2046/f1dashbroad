import re
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class LapsEngineeringWorkspaceTests(unittest.TestCase):
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

    def test_laps_selector_is_an_in_flow_driver_channel_deck(self):
        self.assertIn('class="laps-workspace"', self.index_html)
        self.assertIn('class="laps-hero"', self.index_html)
        self.assertIn('class="laps-sidebar laps-driver-bar"', self.index_html)
        self.assertIn('id="lapsDriverList"', self.index_html)

        layout_rule = self._css_rule("#laps-view .laps-layout")
        sidebar_rule = self._css_rule("#laps-view .laps-sidebar.laps-driver-bar")
        pills_rule = self._css_rule("#laps-view .driver-pills")
        pill_rule = self._css_rule("#laps-view .driver-pill")

        self.assertIn("grid-template-columns: minmax(0, 1fr);", layout_rule)
        self.assertIn("padding-bottom: 0;", layout_rule)

        self.assertIn("position: relative;", sidebar_rule)
        self.assertIn("bottom: auto;", sidebar_rule)
        self.assertNotIn("position: fixed;", sidebar_rule)

        self.assertIn("flex-direction: row;", pills_rule)
        self.assertIn("overflow-x: auto;", pills_rule)
        self.assertIn("scroll-snap-type: x proximity;", pills_rule)
        self.assertIn("flex: 0 0 154px;", pill_rule)

    def test_laps_driver_pill_markup_has_team_and_accessible_state(self):
        self.assertIn("function renderLapsDriverSidebar()", self.dashboard_js)
        self.assertIn("driver-pill-code", self.dashboard_js)
        self.assertIn("driver-pill-copy", self.dashboard_js)
        self.assertIn("driver-pill-meta", self.dashboard_js)
        self.assertIn("pill-team-dot", self.dashboard_js)
        self.assertIn("pill.setAttribute('aria-pressed', 'false')", self.dashboard_js)

    def test_lap_log_can_open_a_lap_in_telemetry(self):
        self.assertIn('class="laps-primary-grid"', self.index_html)
        self.assertIn('id="lapsTableCount"', self.index_html)
        self.assertIn('id="telemetryPanelTitle"', self.index_html)
        self.assertIn("class=\"lap-analyze-btn\"", self.dashboard_js)
        self.assertIn("function selectLapForTelemetry", self.dashboard_js)
        self.assertIn("updateActiveLapTableSelection", self.dashboard_js)

    def test_strategy_and_metric_context_are_wired(self):
        for element_id in (
            "statsFastestMeta",
            "statsTheoBestMeta",
            "statsAvgMeta",
            "statsTotalMeta",
            "stintsSummary",
            "stintsLegend",
        ):
            self.assertIn(f'id="{element_id}"', self.index_html)
            self.assertIn(f"{element_id}: document.getElementById('{element_id}')", self.dashboard_js)

        self.assertIn("container-name: laps-workspace;", self.styles_css)
        self.assertIn("@container laps-workspace (max-width: 690px)", self.styles_css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", self.styles_css)


if __name__ == "__main__":
    unittest.main()
