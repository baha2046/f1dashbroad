import unittest
import shutil
from pathlib import Path

from js_sources import read_dashboard_js
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class RaceStandingsApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_race_standings_endpoint_matches_round_by_selected_race_date(self):
        async def fake_fetch_url(url, api_key=None):
            if url.endswith("/2026/races/?format=json"):
                return {
                    "MRData": {
                        "RaceTable": {
                            "Races": [
                                {
                                    "season": "2026",
                                    "round": "2",
                                    "raceName": "Chinese Grand Prix",
                                    "date": "2026-03-15",
                                    "time": "07:00:00Z",
                                }
                            ]
                        }
                    }
                }
            if url.endswith("/2026/2/driverstandings/?format=json"):
                return {
                    "MRData": {
                        "StandingsTable": {
                            "StandingsLists": [
                                {
                                    "season": "2026",
                                    "round": "2",
                                    "DriverStandings": [
                                        {
                                            "position": "1",
                                            "points": "51",
                                            "wins": "1",
                                            "Driver": {
                                                "code": "RUS",
                                                "givenName": "George",
                                                "familyName": "Russell",
                                            },
                                            "Constructors": [{"name": "Mercedes"}],
                                        }
                                    ],
                                }
                            ]
                        }
                    }
                }
            if url.endswith("/2026/2/constructorstandings/?format=json"):
                return {
                    "MRData": {
                        "StandingsTable": {
                            "StandingsLists": [
                                {
                                    "season": "2026",
                                    "round": "2",
                                    "ConstructorStandings": [
                                        {
                                            "position": "1",
                                            "points": "98",
                                            "wins": "2",
                                            "Constructor": {"name": "Mercedes"},
                                        }
                                    ],
                                }
                            ]
                        }
                    }
                }
            self.fail(f"Unexpected URL: {url}")

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", side_effect=fake_fetch_url),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/race_standings?year=2026&date=2026-03-15")

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data["season"], "2026")
        self.assertEqual(data["round"], "2")
        self.assertEqual(data["race_name"], "Chinese Grand Prix")
        self.assertEqual(data["driver_standings"][0]["Driver"]["code"], "RUS")
        self.assertEqual(data["constructor_standings"][0]["Constructor"]["name"], "Mercedes")


class RaceStandingsStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_results_tab_contains_driver_and_constructor_standings_tables(self):
        self.assertIn('id="driverStandingsTableBody"', self.index_html)
        self.assertIn('id="constructorStandingsTableBody"', self.index_html)
        self.assertIn("Driver Standing", self.index_html)
        self.assertIn("Constructor Standing", self.index_html)
        self.assertIn("<th>Driver</th>\n                                                    <th>Wins</th>", self.index_html)

    def test_dashboard_fetches_and_renders_race_standings(self):
        self.assertIn("raceStandings: null", self.dashboard_js)
        self.assertIn("driverStandingsTableBody: document.getElementById('driverStandingsTableBody')", self.dashboard_js)
        self.assertIn("constructorStandingsTableBody: document.getElementById('constructorStandingsTableBody')", self.dashboard_js)
        self.assertIn("customFetch(`/api/race_standings?year=${", self.dashboard_js)
        self.assertIn("function renderRaceStandingsTables()", self.dashboard_js)
        self.assertIn("renderRaceStandingsTables();", self.dashboard_js)
        self.assertIn('<div class="results-driver-team">${escapeHtml(constructorName)}</div>', self.dashboard_js)

    def test_race_standings_have_dedicated_compact_styles(self):
        self.assertIn(".standings-grid", self.styles_css)
        self.assertIn(".standings-table", self.styles_css)
        self.assertIn(".standings-section-header", self.styles_css)


if __name__ == "__main__":
    unittest.main()
