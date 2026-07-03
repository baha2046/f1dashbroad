import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class RaceControlApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_race_control_endpoint_returns_cached_session_messages(self):
        sample_messages = [
            {
                "session_key": 4242,
                "date": "2026-06-07T15:28:20+00:00",
                "driver_number": 27,
                "lap_number": 78,
                "category": "Other",
                "flag": None,
                "scope": None,
                "sector": None,
                "message": "FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 27 (HUL)",
            }
        ]

        cache_path = self.cache_dir / "race_control_4242.json"
        cache_path.write_text(json.dumps(sample_messages), encoding="utf-8")

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/race_control?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(await response.get_json(), sample_messages)


class RaceControlFeedStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = (self.root / "static" / "js" / "dashboard.js").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_dashboard_contains_race_control_tab_and_feed_container(self):
        self.assertIn('data-tab="race-control-view"', self.index_html)
        self.assertIn('id="raceControlFeed"', self.index_html)
        self.assertIn('id="raceControlEmptyState"', self.index_html)
        self.assertIn('id="showBlueFlags"', self.index_html)

    def test_dashboard_renders_loaded_race_control_messages(self):
        self.assertIn("raceControlFeed: document.getElementById('raceControlFeed')", self.dashboard_js)
        self.assertIn("raceControlEmptyState: document.getElementById('raceControlEmptyState')", self.dashboard_js)
        self.assertIn("showBlueFlags: document.getElementById('showBlueFlags')", self.dashboard_js)
        self.assertIn("function renderRaceControlFeed()", self.dashboard_js)
        self.assertIn("renderRaceControlFeed();", self.dashboard_js)
        self.assertIn("race-control-item", self.dashboard_js)

    def test_race_control_feed_has_dedicated_compact_styles(self):
        self.assertIn(".race-control-container", self.styles_css)
        self.assertIn(".race-control-feed", self.styles_css)
        self.assertIn(".race-control-item", self.styles_css)
        self.assertIn(".race-control-meta-pill", self.styles_css)
        self.assertIn(".race-control-toggle", self.styles_css)


if __name__ == "__main__":
    unittest.main()
