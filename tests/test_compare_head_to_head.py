import unittest
from pathlib import Path


class CompareHeadToHeadStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = (self.root / "static" / "js" / "dashboard.js").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_dashboard_contains_head_to_head_chip_container_and_reference_picker(self):
        self.assertIn('data-chart-id="headToHead"', self.index_html)
        self.assertIn('id="compareHeadToHeadChartSection"', self.index_html)
        self.assertIn('id="compareHeadToHeadChartContainer"', self.index_html)
        self.assertIn('id="compareHeadToHeadRef"', self.index_html)

    def test_dashboard_js_wires_head_to_head_reference_state(self):
        self.assertIn("headToHeadRef: null", self.dashboard_js)
        self.assertIn("compareHeadToHeadRef: document.getElementById('compareHeadToHeadRef')", self.dashboard_js)
        self.assertIn("function chooseHeadToHeadReference(", self.dashboard_js)
        self.assertIn("function populateHeadToHeadReferencePicker(", self.dashboard_js)

    def test_dashboard_js_renders_head_to_head_delta_chart(self):
        self.assertIn("function renderCompareHeadToHeadChart(", self.dashboard_js)
        self.assertIn("function buildCompareCumulativeTimes(", self.dashboard_js)
        self.assertIn("function formatSignedDelta(", self.dashboard_js)
        self.assertIn("compare-zero-line", self.dashboard_js)
        self.assertIn("REF", self.dashboard_js)

    def test_head_to_head_chart_has_dedicated_styles(self):
        self.assertIn("#compareHeadToHeadChartContainer", self.styles_css)
        self.assertIn(".compare-ref-select", self.styles_css)
        self.assertIn(".compare-zero-line", self.styles_css)


if __name__ == "__main__":
    unittest.main()
