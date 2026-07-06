import unittest
import re
from pathlib import Path

from js_sources import read_dashboard_js


class CompareTabStaticWiringTests(unittest.TestCase):
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

    def test_dashboard_contains_compare_tab_and_chart_containers(self):
        self.assertIn('data-tab="compare-view"', self.index_html)
        self.assertIn('id="compareDriverList"', self.index_html)
        self.assertIn('id="compareChartContainer"', self.index_html)
        self.assertIn('id="compareLegend"', self.index_html)
        self.assertIn('id="compareHideOutliers"', self.index_html)
        self.assertIn('id="compareResetZoom"', self.index_html)
        self.assertIn('id="compareChartToggles"', self.index_html)
        self.assertIn('data-chart-id="lapTimes"', self.index_html)
        self.assertIn('data-chart-id="gap"', self.index_html)

    def test_dashboard_js_wires_compare_state_and_rendering(self):
        self.assertIn("selectedCompareDrivers: []", self.dashboard_js)
        self.assertIn("compareDriverList: document.getElementById('compareDriverList')", self.dashboard_js)
        self.assertIn("compareChartContainer: document.getElementById('compareChartContainer')", self.dashboard_js)
        self.assertIn("compareChartToggles: document.getElementById('compareChartToggles')", self.dashboard_js)
        self.assertIn("function renderCompareDriverSelector()", self.dashboard_js)
        self.assertIn("async function toggleCompareDriver(driverNumber)", self.dashboard_js)
        self.assertIn("function renderCompareLapChart()", self.dashboard_js)
        self.assertIn("compareView: createCompareViewState()", self.dashboard_js)
        self.assertIn("visibleCharts: new Set(['lapTimes', 'gap'])", self.dashboard_js)
        self.assertIn("function isCompareChartVisible(chartId)", self.dashboard_js)
        self.assertIn("function setupCompareChartToggles()", self.dashboard_js)
        self.assertIn("function setCompareChartSectionVisibility(", self.dashboard_js)
        self.assertIn("compareResetZoom: document.getElementById('compareResetZoom')", self.dashboard_js)
        self.assertIn("function attachCompareCrosshair(svg, ctx)", self.dashboard_js)
        self.assertIn("function renderCompareLegendInteractive(selectedDrivers)", self.dashboard_js)
        self.assertIn("function attachCompareZoom(svg, ctx)", self.dashboard_js)
        self.assertIn("mutedDrivers", self.dashboard_js)
        self.assertIn("lapWindow", self.dashboard_js)
        self.assertIn("compareResetZoom", self.dashboard_js)

    def test_compare_tab_has_dedicated_styles(self):
        self.assertIn(".compare-layout", self.styles_css)
        self.assertIn(".compare-driver-pill", self.styles_css)
        self.assertIn(".compare-legend", self.styles_css)
        self.assertIn("#compareChartContainer", self.styles_css)
        self.assertIn(".compare-chart-line", self.styles_css)
        self.assertIn(".compare-crosshair-line", self.styles_css)
        self.assertIn(".compare-unified-tooltip", self.styles_css)
        self.assertIn(".compare-legend-item.dimmed", self.styles_css)
        self.assertIn(".compare-zoom-selection", self.styles_css)
        self.assertIn(".compare-reset-zoom", self.styles_css)
        self.assertIn(".compare-chart-toggles", self.styles_css)
        self.assertIn(".compare-chart-chip", self.styles_css)
        self.assertIn(".compare-chart-chip.active", self.styles_css)

    def test_compare_legend_click_dims_driver_without_filtering_series(self):
        self.assertIn("mutedDrivers: new Set()", self.dashboard_js)
        self.assertIn("function isCompareDriverMuted(driverNumber)", self.dashboard_js)
        self.assertIn("state.compareView.mutedDrivers.add(driverNumber)", self.dashboard_js)
        self.assertIn("state.compareView.mutedDrivers.delete(driverNumber)", self.dashboard_js)
        self.assertIn("muted ? 'dimmed' : ''", self.dashboard_js)
        self.assertNotIn("series.filter(item => !isCompareDriverHidden(item.driverNumber))", self.dashboard_js)
        self.assertNotIn(".compare-chart-line.hidden", self.styles_css)

    def test_compare_driver_selector_is_fixed_bottom_bar(self):
        layout_rule = self._css_rule(".compare-layout")
        sidebar_rule = self._css_rule(".compare-sidebar")
        pills_rule = self._css_rule(".compare-driver-pills")
        pill_rule = self._css_rule(".compare-driver-pill")

        self.assertIn("grid-template-columns: minmax(0, 1fr);", layout_rule)
        self.assertIn("padding-bottom: 156px;", layout_rule)
        self.assertNotIn("260px 1fr", layout_rule)

        self.assertIn("position: fixed;", sidebar_rule)
        self.assertIn("left: calc(var(--sidebar-width) + 32px);", sidebar_rule)
        self.assertIn("right: 32px;", sidebar_rule)
        self.assertIn("bottom: 16px;", sidebar_rule)
        self.assertIn("z-index: 30;", sidebar_rule)

        self.assertIn("flex-direction: row;", pills_rule)
        self.assertIn("overflow-x: auto;", pills_rule)
        self.assertIn("flex: 0 0 auto;", pill_rule)


if __name__ == "__main__":
    unittest.main()
