import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class PositionApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_position_endpoint_returns_cached_session_positions(self):
        sample_positions = [
            {
                "date": "2026-06-07T15:08:17+00:00",
                "session_key": 4242,
                "meeting_key": 2026,
                "driver_number": 16,
                "position": 1,
            }
        ]

        cache_path = self.cache_dir / "position_4242.json"
        cache_path.write_text(json.dumps(sample_positions), encoding="utf-8")

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/position?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(await response.get_json(), sample_positions)

    async def test_position_endpoint_requires_session_key(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/position")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(await response.get_json(), {"error": "session_key is required"})


class ComparePositionChartStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.app_py = (self.root / "app.py").read_text(encoding="utf-8")
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = (self.root / "static" / "js" / "dashboard.js").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_backend_has_cached_position_proxy(self):
        self.assertIn('@app.route("/api/position")', self.app_py)
        self.assertIn("https://api.openf1.org/v1/position?session_key=", self.app_py)
        self.assertIn('cache_name = f"position_{session_key}.json"', self.app_py)

    def test_dashboard_contains_position_chip_and_chart_container(self):
        self.assertIn('data-chart-id="position"', self.index_html)
        self.assertIn('id="comparePositionChartSection"', self.index_html)
        self.assertIn('id="comparePositionChartContainer"', self.index_html)
        self.assertIn(">Position<", self.index_html)

    def test_dashboard_js_loads_and_maps_position_data(self):
        self.assertIn("position: []", self.dashboard_js)
        self.assertIn("positionByLap: {}", self.dashboard_js)
        self.assertIn("state.position = []", self.dashboard_js)
        self.assertIn("state.positionByLap = {}", self.dashboard_js)
        self.assertIn("customFetch(`/api/position?session_key=${session.session_key}`)", self.dashboard_js)
        self.assertIn("function buildPositionByLapMap()", self.dashboard_js)

    def test_dashboard_js_renders_position_chart(self):
        self.assertIn("function renderComparePositionChart(", self.dashboard_js)
        self.assertIn("formatComparePositionDelta", self.dashboard_js)
        self.assertIn("P${value}", self.dashboard_js)

    def test_position_chart_has_dedicated_styles(self):
        self.assertIn("#comparePositionChartContainer", self.styles_css)
        self.assertIn(".compare-position-delta-gain", self.styles_css)
        self.assertIn(".compare-position-delta-loss", self.styles_css)


if __name__ == "__main__":
    unittest.main()
