import shutil
import unittest
from pathlib import Path

from js_sources import read_dashboard_js
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


def _driver_standing(driver_id, code, given, family, team, points, position):
    return {
        "position": str(position),
        "points": str(points),
        "wins": "0",
        "Driver": {
            "driverId": driver_id,
            "code": code,
            "givenName": given,
            "familyName": family,
        },
        "Constructors": [{"name": team}],
    }


def _constructor_standing(constructor_id, name, points, position):
    return {
        "position": str(position),
        "points": str(points),
        "wins": "0",
        "Constructor": {"constructorId": constructor_id, "name": name},
    }


def _standings_payload(key, items):
    return {"MRData": {"StandingsTable": {"StandingsLists": [{key: items}]}}}


class SeasonProgressionApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)
        self.requested_urls = []

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def _fake_fetch_url(self, url, api_key=None):
        self.requested_urls.append(url)
        if url.endswith("/2026/races/?format=json"):
            return {
                "MRData": {
                    "RaceTable": {
                        "Races": [
                            {"round": "1", "raceName": "Australian GP", "date": "2026-03-08"},
                            {"round": "2", "raceName": "Chinese GP", "date": "2026-03-15"},
                            {"round": "3", "raceName": "Abu Dhabi GP", "date": "2026-12-06"},
                        ]
                    }
                }
            }
        if url.endswith("/2026/1/driverstandings/?format=json"):
            return _standings_payload("DriverStandings", [
                _driver_standing("russell", "RUS", "George", "Russell", "Mercedes", 25, 1),
            ])
        if url.endswith("/2026/1/constructorstandings/?format=json"):
            return _standings_payload("ConstructorStandings", [
                _constructor_standing("mercedes", "Mercedes", 43, 1),
            ])
        if url.endswith("/2026/2/driverstandings/?format=json"):
            return _standings_payload("DriverStandings", [
                _driver_standing("russell", "RUS", "George", "Russell", "Mercedes", 51, 1),
                _driver_standing("lindblad", "LIN", "Arvid", "Lindblad", "Racing Bulls", 10, 2),
            ])
        if url.endswith("/2026/2/constructorstandings/?format=json"):
            return _standings_payload("ConstructorStandings", [
                _constructor_standing("mercedes", "Mercedes", 98, 1),
            ])
        self.fail(f"Unexpected URL: {url}")

    async def _get_progression(self):
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", side_effect=self._fake_fetch_url),
        ):
            client = dashboard_app.app.test_client()
            return await client.get("/api/season_progression?year=2026")

    async def test_progression_builds_cumulative_series_for_completed_rounds(self):
        response = await self._get_progression()

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data["season"], "2026")
        self.assertEqual([r["round"] for r in data["rounds"]], ["1", "2"])

        russell = data["drivers"][0]
        self.assertEqual(russell["code"], "RUS")
        self.assertEqual(russell["name"], "George Russell")
        self.assertEqual(russell["team"], "Mercedes")
        self.assertEqual(russell["points"], [25.0, 51.0])
        self.assertEqual(russell["positions"], [1, 1])

        mercedes = data["constructors"][0]
        self.assertEqual(mercedes["team"], "Mercedes")
        self.assertEqual(mercedes["points"], [43.0, 98.0])

    async def test_future_rounds_are_never_requested(self):
        await self._get_progression()
        future_urls = [url for url in self.requested_urls if "/2026/3/" in url]
        self.assertEqual(future_urls, [])

    async def test_mid_season_entrant_is_padded_with_nulls(self):
        response = await self._get_progression()
        data = await response.get_json()

        lindblad = next(s for s in data["drivers"] if s["id"] == "lindblad")
        self.assertEqual(lindblad["points"], [None, 10.0])
        self.assertEqual(lindblad["positions"], [None, 2])

    async def test_series_sorted_by_latest_points_descending(self):
        response = await self._get_progression()
        data = await response.get_json()
        self.assertEqual([s["id"] for s in data["drivers"]], ["russell", "lindblad"])

    async def test_invalid_year_is_rejected(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/season_progression?year=../evil")
        self.assertEqual(response.status_code, 400)


class ProgressionStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_results_tab_contains_progression_section(self):
        self.assertIn('id="progressionWrapper"', self.index_html)
        self.assertIn('id="progressionChartContainer"', self.index_html)
        self.assertIn('id="progressionDriversBtn"', self.index_html)
        self.assertIn('id="progressionConstructorsBtn"', self.index_html)
        self.assertIn("Championship Progression", self.index_html)

    def test_dashboard_fetches_and_renders_progression(self):
        self.assertIn("seasonProgression: null", self.dashboard_js)
        self.assertIn("progressionView: 'drivers'", self.dashboard_js)
        self.assertIn("progressionWrapper: document.getElementById('progressionWrapper')", self.dashboard_js)
        self.assertIn("customFetch(`/api/season_progression?year=${", self.dashboard_js)
        self.assertIn("function renderChampionshipProgressionChart()", self.dashboard_js)
        self.assertIn("renderChampionshipProgressionChart();", self.dashboard_js)
        self.assertIn("state.progressionView = 'constructors'", self.dashboard_js)

    def test_progression_chart_has_dedicated_styles(self):
        self.assertIn(".progression-wrapper", self.styles_css)
        self.assertIn(".progression-toggle-btn", self.styles_css)
        self.assertIn(".progression-line", self.styles_css)
        self.assertIn(".progression-end-label", self.styles_css)


if __name__ == "__main__":
    unittest.main()
