import json
import shutil
import unittest
from pathlib import Path

from js_sources import read_dashboard_js
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class PitApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_pit_endpoint_returns_cached_session_pit_stops(self):
        sample_pit_stops = [
            {
                "session_key": 4242,
                "driver_number": 16,
                "lap_number": 21,
                "pit_duration": 23.612,
            }
        ]

        cache_path = self.cache_dir / "pit_4242.json"
        cache_path.write_text(json.dumps(sample_pit_stops), encoding="utf-8")

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/pit?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(await response.get_json(), sample_pit_stops)

    async def test_pit_endpoint_requires_session_key(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/pit")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(await response.get_json(), {"error": "session_key is required and must be an integer"})


class PitAnnotationStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.app_py = (self.root / "app.py").read_text(encoding="utf-8")
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_backend_has_cached_pit_proxy(self):
        rules = {rule.rule for rule in dashboard_app.app.url_map.iter_rules()}
        self.assertIn("/api/pit", rules)
        self.assertEqual(dashboard_app.OPENF1_SESSION_ENDPOINTS["pit"], "pit")

    def test_frontend_loads_pits_only_for_race_or_sprint(self):
        self.assertIn("pitStops: []", self.dashboard_js)
        self.assertIn("function isPitAnnotationSession(session)", self.dashboard_js)
        self.assertIn("state.pitStops = []", self.dashboard_js)
        self.assertIn("customFetch(`/api/pit?session_key=${session.session_key}`)", self.dashboard_js)
        self.assertIn("isPitAnnotationSession(session)", self.dashboard_js)

    def test_dashboard_displays_pit_annotations_in_table_and_charts(self):
        self.assertIn("<th>Pit</th>", self.index_html)
        self.assertIn("function getLapPitAnnotation(driverNumber, lapNumber)", self.dashboard_js)
        self.assertIn("function renderPitLapMarkers", self.dashboard_js)
        self.assertIn("pit-lap-badge", self.dashboard_js)
        self.assertIn("chart-pit-in-dot", self.dashboard_js)
        self.assertIn("chart-pit-out-dot", self.dashboard_js)

    def test_driver_stats_render_ignores_stale_async_lap_loads(self):
        self.assertIn("Number(state.selectedDriverStats) !== Number(driverNumber)", self.dashboard_js)

    def test_pit_annotations_have_dedicated_styles(self):
        self.assertIn(".pit-lap-badge", self.styles_css)
        self.assertIn(".pit-lap-badge.pit-in", self.styles_css)
        self.assertIn(".pit-lap-badge.pit-out", self.styles_css)
        self.assertIn(".chart-pit-in-guide", self.styles_css)
        self.assertIn(".chart-pit-out-guide", self.styles_css)
        self.assertIn(".chart-pit-in-dot", self.styles_css)
        self.assertIn(".chart-pit-out-dot", self.styles_css)


if __name__ == "__main__":
    unittest.main()
