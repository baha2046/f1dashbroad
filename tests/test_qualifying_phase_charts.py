import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class QualifyingPhaseChartStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_dashboard_extracts_q1_q2_q3_from_session_status(self):
        self.assertIn("function isQualifyingSession(session)", self.dashboard_js)
        self.assertIn("function extractQualifyingPhasePeriods(records)", self.dashboard_js)
        self.assertIn("qualifying_phase", self.dashboard_js)
        self.assertIn("`Q${phase}`", self.dashboard_js)

    def test_lap_and_compare_charts_use_qualifying_phase_axis(self):
        self.assertIn("function buildQualifyingPhaseAxis(laps, records, session)", self.dashboard_js)
        self.assertIn("function renderQualifyingPhaseRegions(", self.dashboard_js)
        self.assertIn("const qualifyingAxis = buildQualifyingPhaseAxis(validLaps, state.raceControl, state.selectedSession);", self.dashboard_js)
        self.assertIn("buildQualifyingPhaseAxis(activeSeries.flatMap(item => item.validLaps), state.raceControl, state.selectedSession)", self.dashboard_js)
        self.assertIn("getCompareHoverValueFromX", self.dashboard_js)

    def test_qualifying_phase_regions_have_dedicated_styles(self):
        self.assertIn(".chart-qualifying-phase-shading", self.styles_css)
        self.assertIn(".chart-qualifying-phase-boundary", self.styles_css)
        self.assertIn(".chart-qualifying-phase-text", self.styles_css)


if __name__ == "__main__":
    unittest.main()
