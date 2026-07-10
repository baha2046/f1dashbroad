import json
import shutil
import subprocess
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

import app as dashboard_app
from js_sources import read_dashboard_js


PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class ConstructorRosterApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_constructor_roster_resolves_round_from_weekend_session_date(self):
        calls = []

        async def fake_fetch_url(url, api_key=None):
            calls.append(url)
            if url.endswith("/2026/races/?format=json"):
                return {
                    "MRData": {
                        "RaceTable": {
                            "Races": [{
                                "season": "2026",
                                "round": "9",
                                "raceName": "British Grand Prix",
                                "date": "2026-07-05",
                                "FirstPractice": {"date": "2026-07-03"},
                                "Qualifying": {"date": "2026-07-04"},
                            }]
                        }
                    }
                }
            if url.endswith("/2026/9/constructors/?format=json"):
                return {
                    "MRData": {
                        "ConstructorTable": {
                            "season": "2026",
                            "round": "9",
                            "Constructors": [{
                                "constructorId": "mercedes",
                                "url": "https://en.wikipedia.org/wiki/Mercedes-Benz_in_Formula_One",
                                "name": "Mercedes",
                                "nationality": "German",
                            }],
                        }
                    }
                }
            self.fail(f"Unexpected URL: {url}")

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", side_effect=fake_fetch_url),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/constructors?year=2026&date=2026-07-03")

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data["season"], "2026")
        self.assertEqual(data["round"], "9")
        self.assertEqual(data["race_name"], "British Grand Prix")
        self.assertEqual(data["constructors"][0]["constructorId"], "mercedes")
        self.assertIn("https://api.jolpi.ca/ergast/f1/2026/9/constructors/?format=json", calls)

    async def test_constructor_roster_validates_required_round_context(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/constructors?year=2026")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((await response.get_json())["error"], "date or round is required")


class ConstructorRosterUiTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)

    def _extract_function(self, function_name):
        marker = f"function {function_name}"
        start = self.dashboard_js.find(marker)
        self.assertNotEqual(start, -1, f"{function_name} is missing")
        body_start = self.dashboard_js.find("{", start)
        depth = 0
        for index in range(body_start, len(self.dashboard_js)):
            if self.dashboard_js[index] == "{":
                depth += 1
            elif self.dashboard_js[index] == "}":
                depth -= 1
                if depth == 0:
                    return self.dashboard_js[start:index + 1]
        self.fail(f"{function_name} body was not closed")

    def test_driver_tab_contains_constructor_dashboard_surfaces(self):
        for element_id in (
            "driversHeroTitle",
            "driversRosterRound",
            "driversConstructorCount",
            "driversNationalityCount",
            "driversModeTeamsBtn",
            "driversModeDriversBtn",
            "driversVisibleCount",
            "driversGrid",
        ):
            self.assertIn(f'id="{element_id}"', self.index_html)

    def test_constructor_roster_is_loaded_with_session_data(self):
        self.assertIn("constructorRoster: null", self.dashboard_js)
        self.assertIn("/api/constructors?year=${encodeURIComponent", self.dashboard_js)
        self.assertIn("state.constructorRoster = constructorRoster", self.dashboard_js)
        self.assertIn("function buildConstructorGroups", self.dashboard_js)
        self.assertIn("function createConstructorCard", self.dashboard_js)
        self.assertIn("function setDriversViewMode", self.dashboard_js)

    def test_constructor_aliases_match_live_timing_team_names(self):
        helper = self._extract_function("canonicalConstructorKey")
        script = textwrap.dedent(f"""
            {helper}
            console.log(JSON.stringify([
                canonicalConstructorKey('RB F1 Team') === canonicalConstructorKey('Racing Bulls'),
                canonicalConstructorKey('Red Bull') === canonicalConstructorKey('Red Bull Racing'),
                canonicalConstructorKey('Haas F1 Team') === canonicalConstructorKey('Haas'),
                canonicalConstructorKey('Alpine F1 Team') === canonicalConstructorKey('Alpine')
            ]));
        """)
        completed = subprocess.run(
            ["node", "-e", script],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        self.assertEqual(json.loads(completed.stdout), [True, True, True, True])

    def test_driver_dashboard_has_responsive_team_and_driver_cards(self):
        for selector in (
            ".drivers-hero",
            ".drivers-mode-toggle",
            ".constructor-card",
            ".constructor-driver-lineup",
            ".driver-grid .driver-card",
            "@container (max-width: 620px)",
        ):
            self.assertIn(selector, self.styles_css)


if __name__ == "__main__":
    unittest.main()
