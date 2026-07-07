import unittest
from unittest.mock import AsyncMock, patch

import app as dashboard_app


def jolpica_results_payload(results, key="Results"):
    return {
        "MRData": {
            "RaceTable": {
                "Races": [{"round": "12", key: results}],
            }
        }
    }


def jolpica_races_payload():
    return {
        "MRData": {
            "RaceTable": {
                "Races": [
                    {"round": "12", "raceName": "British Grand Prix", "date": "2026-07-05"},
                ]
            }
        }
    }


class MergeJolpicaResultsTests(unittest.TestCase):
    def test_merge_fills_points_and_classification_flags(self):
        rows = [
            {"driver_number": 1, "position": 1, "points": None, "dnf": False, "dns": False, "dsq": False},
            {"driver_number": 44, "position": None, "points": None, "dnf": True, "dns": False, "dsq": False},
            {"driver_number": 99, "position": 20, "points": None, "dnf": False, "dns": False, "dsq": False},
        ]
        official = {
            1: {"number": "1", "positionText": "1", "points": "25", "status": "Finished"},
            44: {"number": "44", "positionText": "R", "points": "0", "status": "Collision"},
        }

        merged = dashboard_app.merge_jolpica_results(rows, official)

        self.assertEqual(merged[0]["points"], 25.0)
        self.assertFalse(merged[0]["dnf"])
        self.assertEqual(merged[0]["status"], "Finished")
        self.assertEqual(merged[1]["points"], 0.0)
        self.assertTrue(merged[1]["dnf"])
        self.assertEqual(merged[1]["status"], "Collision")
        # Drivers Jolpica doesn't know keep their Livetiming row untouched
        self.assertIsNone(merged[2]["points"])

    def test_merge_maps_dsq_and_dns(self):
        rows = [
            {"driver_number": 5, "dnf": False, "dns": False, "dsq": False},
            {"driver_number": 6, "dnf": False, "dns": False, "dsq": False},
        ]
        official = {
            5: {"positionText": "D", "points": "0", "status": "Disqualified"},
            6: {"positionText": "W", "points": "0", "status": "Withdrew"},
        }

        merged = dashboard_app.merge_jolpica_results(rows, official)

        self.assertTrue(merged[0]["dsq"])
        self.assertFalse(merged[0]["dns"])
        self.assertTrue(merged[1]["dns"])
        self.assertFalse(merged[1]["dsq"])


class EnrichResultsWithJolpicaTests(unittest.IsolatedAsyncioTestCase):
    def race_session(self, name="Grand Prix"):
        return {
            "session_key": 11321,
            "session_type": "Race",
            "session_name": name,
            "date_start": "2026-07-05T14:00:00Z",
            "year": 2026,
        }

    async def enrich(self, rows, session, jolpica_payloads):
        async def fake_jolpica(url, cache_name, year=None):
            for token, payload in jolpica_payloads.items():
                if token in url:
                    return payload
            raise AssertionError(f"unexpected Jolpica url {url}")

        with (
            patch.object(dashboard_app, "find_session_year", new=AsyncMock(return_value=2026)),
            patch.object(dashboard_app, "get_session_info", return_value=session),
            patch.object(dashboard_app, "get_cached_jolpica_api", new=fake_jolpica),
        ):
            return await dashboard_app.enrich_results_with_jolpica(rows, 11321)

    async def test_race_results_gain_points_from_jolpica(self):
        rows = [{"driver_number": 1, "points": None, "dnf": False, "dns": False, "dsq": False}]
        merged = await self.enrich(rows, self.race_session(), {
            "/races/": jolpica_races_payload(),
            "/12/results/": jolpica_results_payload([
                {"number": "1", "positionText": "1", "points": "25", "status": "Finished"},
            ]),
        })
        self.assertEqual(merged[0]["points"], 25.0)

    async def test_sprint_sessions_use_the_sprint_endpoint(self):
        rows = [{"driver_number": 1, "points": None, "dnf": False, "dns": False, "dsq": False}]
        merged = await self.enrich(rows, self.race_session(name="Sprint"), {
            "/races/": jolpica_races_payload(),
            "/12/sprint/": jolpica_results_payload([
                {"number": "1", "positionText": "1", "points": "8", "status": "Finished"},
            ], key="SprintResults"),
        })
        self.assertEqual(merged[0]["points"], 8.0)

    async def test_non_race_sessions_are_untouched(self):
        session = dict(self.race_session(), session_type="Qualifying")
        rows = [{"driver_number": 1, "points": None}]
        merged = await self.enrich(rows, session, {})
        self.assertEqual(merged, rows)

    async def test_rows_survive_when_jolpica_has_no_results_yet(self):
        rows = [{"driver_number": 1, "points": None, "dnf": False, "dns": False, "dsq": False}]
        merged = await self.enrich(rows, self.race_session(), {
            "/races/": jolpica_races_payload(),
            "/12/results/": jolpica_results_payload([]),
        })
        self.assertEqual(merged, rows)

    async def test_rows_survive_upstream_errors(self):
        rows = [{"driver_number": 1, "points": None}]

        async def failing_jolpica(url, cache_name, year=None):
            raise dashboard_app.UpstreamAPIError("down")

        with (
            patch.object(dashboard_app, "find_session_year", new=AsyncMock(return_value=2026)),
            patch.object(dashboard_app, "get_session_info", return_value=self.race_session()),
            patch.object(dashboard_app, "get_cached_jolpica_api", new=failing_jolpica),
        ):
            merged = await dashboard_app.enrich_results_with_jolpica(rows, 11321)
        self.assertEqual(merged, rows)


if __name__ == "__main__":
    unittest.main()
