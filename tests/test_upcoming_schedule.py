import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

from js_sources import read_dashboard_js


def jolpica_race(round_number="10", **overrides):
    race = {
        "round": round_number,
        "raceName": "Belgian Grand Prix",
        "Circuit": {
            "circuitName": "Circuit de Spa-Francorchamps",
            "Location": {"locality": "Spa", "country": "Belgium"},
        },
        "date": "2026-07-19",
        "time": "13:00:00Z",
        "FirstPractice": {"date": "2026-07-17", "time": "10:30:00Z"},
        "Qualifying": {"date": "2026-07-18", "time": "14:00:00Z"},
    }
    race.update(overrides)
    return race


class NormalizeJolpicaScheduleTests(unittest.TestCase):
    def test_flattens_race_into_schedule_entry(self):
        schedule = dashboard_app.normalize_jolpica_schedule([jolpica_race()])

        self.assertEqual(len(schedule), 1)
        entry = schedule[0]
        self.assertEqual(entry["round"], 10)
        self.assertEqual(entry["race_name"], "Belgian Grand Prix")
        self.assertEqual(entry["circuit_name"], "Circuit de Spa-Francorchamps")
        self.assertEqual(entry["locality"], "Spa")
        self.assertEqual(entry["country"], "Belgium")
        self.assertEqual(entry["date"], "2026-07-19")

    def test_sessions_include_race_and_sort_chronologically(self):
        entry = dashboard_app.normalize_jolpica_schedule([jolpica_race()])[0]

        self.assertEqual(
            [s["name"] for s in entry["sessions"]],
            ["Practice 1", "Qualifying", "Race"],
        )
        self.assertEqual(entry["sessions"][-1]["time"], "13:00:00Z")

    def test_skips_malformed_entries(self):
        schedule = dashboard_app.normalize_jolpica_schedule(
            ["not-a-dict", jolpica_race()]
        )
        self.assertEqual(len(schedule), 1)
        self.assertEqual(dashboard_app.normalize_jolpica_schedule(None), [])


class ApiScheduleRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_schedule_route_returns_normalized_calendar(self):
        payload = {"MRData": {"RaceTable": {"Races": [jolpica_race()]}}}
        with patch.object(
            dashboard_app, "get_cached_jolpica_api", new=AsyncMock(return_value=payload)
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/schedule?year=2026")

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data[0]["race_name"], "Belgian Grand Prix")
        self.assertEqual(len(data[0]["sessions"]), 3)

    async def test_schedule_route_rejects_bad_year(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/schedule?year=bogus")
        self.assertEqual(response.status_code, 400)


class SidebarUpcomingWiringTests(unittest.TestCase):
    """The sidebar merges the Jolpica calendar below the livetiming sessions."""

    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(root)

    def test_load_sessions_fetches_schedule_alongside_sessions(self):
        self.assertIn("customFetch(`/api/schedule?year=${year}`)", self.dashboard_js)
        self.assertIn("state.upcomingRaces = computeUpcomingRaces(", self.dashboard_js)

    def test_render_appends_upcoming_section(self):
        self.assertIn("function renderUpcomingSchedule(", self.dashboard_js)
        self.assertIn("renderUpcomingSchedule(DOM.sessionsList);", self.dashboard_js)

    def test_upcoming_weekends_already_seen_or_finished_are_excluded(self):
        self.assertIn("function computeUpcomingRaces(", self.dashboard_js)
        self.assertIn("seenDates.has(day)", self.dashboard_js)
        self.assertIn("weekendEnd >= nowTime", self.dashboard_js)


if __name__ == "__main__":
    unittest.main()
