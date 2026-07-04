import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class CompareGapChartStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_dashboard_contains_compare_gap_chart_containers(self):
        self.assertIn('id="compareGapChartSection"', self.index_html)
        self.assertIn('id="compareGapChartContainer"', self.index_html)

    def test_dashboard_js_wires_compare_gap_state_and_rendering(self):
        self.assertIn("allSessionLaps: null", self.dashboard_js)
        self.assertIn("compareGapChartSection: document.getElementById('compareGapChartSection')", self.dashboard_js)
        self.assertIn("compareGapChartContainer: document.getElementById('compareGapChartContainer')", self.dashboard_js)
        self.assertIn("function renderCompareGapChart(", self.dashboard_js)

    def test_compare_gap_chart_has_dedicated_styles(self):
        self.assertIn("#compareGapChartContainer", self.styles_css)


if __name__ == "__main__":
    unittest.main()
