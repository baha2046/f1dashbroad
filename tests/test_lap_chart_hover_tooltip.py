import unittest
from pathlib import Path


class LapChartHoverTooltipTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.laps_js = (self.root / "static" / "js" / "09-laps-tab.js").read_text(encoding="utf-8")

    def test_lap_chart_uses_a_plot_area_hover_layer(self):
        """Hovering anywhere in the plot should reveal the closest lap's timing."""
        self.assertIn('"lap-chart-interaction-overlay"', self.laps_js)
        self.assertIn('overlay.addEventListener("mousemove", event => {', self.laps_js)
        self.assertIn("renderLapChartTooltip(tooltip, nearestLap", self.laps_js)
        self.assertIn('overlay.addEventListener("mouseleave", hideTooltip);', self.laps_js)


if __name__ == "__main__":
    unittest.main()
