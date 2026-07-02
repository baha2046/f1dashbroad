import unittest
from pathlib import Path


class CompareTyreStrategyStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = (self.root / "static" / "js" / "dashboard.js").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_dashboard_contains_tyre_strategy_chip_and_container(self):
        self.assertIn('data-chart-id="tyreStrategy"', self.index_html)
        self.assertIn('id="compareTyreStrategyChartSection"', self.index_html)
        self.assertIn('id="compareTyreStrategyChartContainer"', self.index_html)
        self.assertIn(">Tyre Strategy<", self.index_html)

    def test_dashboard_js_renders_tyre_strategy_strip(self):
        self.assertIn("function renderCompareTyreStrategyChart(", self.dashboard_js)
        self.assertIn("function getTyreCompoundClass(", self.dashboard_js)
        self.assertIn("compare-tyre-segment", self.dashboard_js)
        self.assertIn("compare-strategy-tooltip", self.dashboard_js)

    def test_tyre_strategy_uses_compound_styles(self):
        self.assertIn(".compare-tyre-segment", self.styles_css)
        self.assertIn(".compare-tyre-row-label", self.styles_css)
        self.assertIn(".compare-strategy-tooltip", self.styles_css)
        self.assertIn(".stint-compound-SOFT", self.styles_css)
        self.assertIn(".stint-compound-MEDIUM", self.styles_css)
        self.assertIn(".stint-compound-HARD", self.styles_css)
        self.assertIn(".stint-compound-INTERMEDIATE", self.styles_css)
        self.assertIn(".stint-compound-WET", self.styles_css)


if __name__ == "__main__":
    unittest.main()
