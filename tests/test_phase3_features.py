import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app
from js_sources import read_dashboard_js

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class YearsEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_years_probes_livetiming_and_skips_missing_archives(self):
        # The archive is irregular: 2022 is missing (403) and next year 404s
        # until Livetiming publishes it
        async def fetch_year(year):
            if year in (2027, 2022):
                raise Exception("missing archive")
            return {"Year": year, "Meetings": [{"Sessions": []}]}

        fetch_mock = AsyncMock(side_effect=fetch_year)
        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "current_season_year", return_value=2026), \
                patch.object(dashboard_app, "fetch_livetiming_year_index", new=fetch_mock):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/years")
            years = await response.get_json()

            # Second request must come from cache, not a re-probe
            probe_count = fetch_mock.await_count
            second = await client.get("/api/years")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(years, [2026, 2025, 2024, 2023, 2021, 2020, 2019, 2018])
        self.assertEqual(await second.get_json(), years)
        self.assertEqual(fetch_mock.await_count, probe_count)
        self.assertTrue((self.cache_dir / "years_available.json").exists())

    async def test_years_falls_back_when_upstream_is_down(self):
        fetch_mock = AsyncMock(side_effect=Exception("offline"))
        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "current_season_year", return_value=2026), \
                patch.object(dashboard_app, "fetch_livetiming_year_index", new=fetch_mock):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/years")

        self.assertEqual(await response.get_json(), [2026, 2025, 2024, 2023])
        # The offline default must not be cached: the next request re-probes
        self.assertFalse((self.cache_dir / "years_available.json").exists())


class DynamicYearFrontendTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(root)
        self.styles_css = (root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_year_selector_is_populated_from_the_api(self):
        self.assertIn("async function initYearSelector()", self.dashboard_js)
        self.assertIn("customFetch('/api/years')", self.dashboard_js)
        self.assertIn("initYearSelector().finally(() => loadSessions(state.selectedYear, true));", self.dashboard_js)

    def test_year_selector_wraps_when_many_seasons_exist(self):
        self.assertIn("flex-wrap: wrap;", self.styles_css.split(".year-selector {")[1].split("}")[0])


class FastestLapTests(unittest.TestCase):
    def test_merge_carries_fastest_lap(self):
        rows = [{"driver_number": 4, "points": None, "dnf": False, "dns": False, "dsq": False}]
        official = {
            4: {
                "positionText": "1", "points": "26", "status": "Finished",
                "FastestLap": {"rank": "1", "lap": "44", "Time": {"time": "1:27.097"}},
            },
        }
        merged = dashboard_app.merge_jolpica_results(rows, official)
        self.assertTrue(merged[0]["fastest_lap"])
        self.assertEqual(merged[0]["fastest_lap_time"], "1:27.097")
        self.assertEqual(merged[0]["fastest_lap_number"], 44)

    def test_merge_ignores_non_rank_one_fastest_laps(self):
        rows = [{"driver_number": 4, "points": None, "dnf": False, "dns": False, "dsq": False}]
        official = {4: {"positionText": "5", "points": "10", "status": "Finished",
                        "FastestLap": {"rank": "3", "lap": "12", "Time": {"time": "1:29.001"}}}}
        merged = dashboard_app.merge_jolpica_results(rows, official)
        self.assertFalse(merged[0]["fastest_lap"])

    def test_results_tab_renders_fl_pill(self):
        root = Path(__file__).resolve().parents[1]
        dashboard_js = read_dashboard_js(root)
        styles_css = (root / "static" / "css" / "styles.css").read_text(encoding="utf-8")
        self.assertIn('class="fl-pill"', dashboard_js)
        self.assertIn(".fl-pill {", styles_css)


if __name__ == "__main__":
    unittest.main()
