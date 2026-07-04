import unittest
from pathlib import Path

from js_sources import read_dashboard_js

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class QualifyingResultsTabWiringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = read_dashboard_js(PROJECT_ROOT)
        cls.html = (PROJECT_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        cls.css = (PROJECT_ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_results_table_head_row_has_id_and_dom_binding(self):
        self.assertIn('id="resultsTableHeadRow"', self.html)
        self.assertIn("resultsTableHeadRow: document.getElementById('resultsTableHeadRow')", self.js)

    def test_render_results_tab_detects_qualifying_segment_arrays(self):
        self.assertIn("isQualifyingSession(state.selectedSession)", self.js)
        self.assertIn("Array.isArray(item.duration)", self.js)

    def test_qualifying_header_lists_q1_q2_q3_columns(self):
        self.assertIn("['Q1', 'Q2', 'Q3']", self.js)
        self.assertIn("['SQ1', 'SQ2', 'SQ3']", self.js)
        self.assertIn("${segmentLabels[0]}", self.js)
        self.assertIn("${segmentLabels[2]}", self.js)

    def test_qualifying_rows_render_per_segment_times_and_gaps(self):
        self.assertIn("quali-seg-cell", self.js)
        self.assertIn("quali-seg-out", self.js)
        self.assertIn("quali-seg-gap", self.js)
        self.assertIn("formatLapTime(time)", self.js)

    def test_qualifying_status_reports_elimination_segment(self):
        self.assertIn("Eliminated in ${segmentLabels[segmentsRun - 1]}", self.js)
        self.assertIn("Reached ${segmentLabels[2]}", self.js)

    def test_segment_best_time_gets_fastest_lap_highlight(self):
        self.assertIn("segmentBest", self.js)
        self.assertIn("fastest-lap-highlight", self.js)

    def test_non_qualifying_table_keeps_time_gap_and_points_columns(self):
        self.assertIn("Time / Gap", self.js)
        self.assertIn("<th>Points</th>", self.js)

    def test_styles_define_quali_segment_cells(self):
        self.assertIn(".quali-seg-cell", self.css)
        self.assertIn(".quali-seg-gap", self.css)


if __name__ == "__main__":
    unittest.main()
