import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

from js_sources import read_dashboard_js

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"

# Driver 1 runs lap 5 over 90s; driver 44 runs lap 5 over 88s. Both have a
# usable telemetry window derived from date_start + lap_duration.
MAIN_LAP_FIXTURES = [
    {"lap_number": 5, "date_start": "2026-05-24T13:03:00+00:00", "lap_duration": 90.0},
]
REF_LAP_FIXTURES = [
    {"lap_number": 5, "date_start": "2026-05-24T13:03:00+00:00", "lap_duration": 88.0},
]


def car_sample(date, speed=280, throttle=100, brake=0, gear=8, drs=12, driver_number=1):
    return {
        "driver_number": driver_number,
        "date": date,
        "speed": speed,
        "throttle": throttle,
        "brake": brake,
        "n_gear": gear,
        "drs": drs,
    }


def constant_speed_lap(speed_kmh, seconds):
    """A synthetic telemetry list at a constant speed, one sample per second."""
    return [
        {"t": float(i), "speed": speed_kmh, "throttle": 100, "brake": 0, "gear": 8, "drs": 0}
        for i in range(seconds + 1)
    ]


class TelemetryCompareParamValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = dashboard_app.app.test_client()

    async def test_missing_params_are_rejected(self):
        for query in (
            "",
            "session_key=4242",
            "session_key=4242&driver_number=1&lap_number=5&ref_driver_number=44",
            "session_key=4242&driver_number=1&lap_number=5&ref_lap_number=5",
            "driver_number=1&lap_number=5&ref_driver_number=44&ref_lap_number=5",
        ):
            response = await self.client.get(f"/api/telemetry_compare?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")

    async def test_traversal_and_non_numeric_params_are_rejected(self):
        base = "session_key=4242&driver_number=1&lap_number=5&ref_driver_number=44&ref_lap_number=5"
        for query in (
            base.replace("session_key=4242", "session_key=../../etc/passwd"),
            base.replace("driver_number=1", "driver_number=../evil"),
            base.replace("lap_number=5", "lap_number=5;rm"),
            base.replace("ref_driver_number=44", "ref_driver_number=44|cat"),
            base.replace("ref_lap_number=5", "ref_lap_number=abc"),
        ):
            response = await self.client.get(f"/api/telemetry_compare?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")


class TelemetryCompareDeltaMathTests(unittest.TestCase):
    def test_gap_matches_analytic_value_for_constant_speed_laps(self):
        # Main at 180 km/h (50 m/s) for 20s -> 1000 m; ref at 200 km/h
        # (55.56 m/s) for 18s -> 1000 m. At the far end the main lap trails the
        # ref by 20 - 18 = 2.0 s.
        main = constant_speed_lap(180, 20)
        ref = constant_speed_lap(200, 18)
        delta = dashboard_app.compute_telemetry_delta(main, ref)

        self.assertTrue(delta)
        self.assertEqual(set(delta[0].keys()), {"d", "gap"})
        self.assertAlmostEqual(delta[0]["gap"], 0.0, delta=0.05)
        self.assertAlmostEqual(delta[-1]["gap"], 2.0, delta=0.1)
        # Positive gap throughout: the main lap is always the slower one here
        self.assertTrue(all(pt["gap"] >= -0.05 for pt in delta))

    def test_equal_laps_have_zero_gap(self):
        lap = constant_speed_lap(200, 18)
        delta = dashboard_app.compute_telemetry_delta(lap, list(lap))
        self.assertTrue(delta)
        self.assertTrue(all(abs(pt["gap"]) < 1e-6 for pt in delta))

    def test_degenerate_inputs_return_empty(self):
        self.assertEqual(dashboard_app.compute_telemetry_delta([], constant_speed_lap(200, 5)), [])
        self.assertEqual(dashboard_app.compute_telemetry_delta(constant_speed_lap(200, 5), []), [])
        one = [{"t": 0.0, "speed": 200}]
        self.assertEqual(dashboard_app.compute_telemetry_delta(one, constant_speed_lap(200, 5)), [])

    def test_distance_is_monotonic_and_trapezoidal(self):
        # 50 m/s for 4 s -> cumulative 0, 50, 100, 150, 200
        distances = dashboard_app.compute_telemetry_distance(constant_speed_lap(180, 4))
        self.assertEqual(distances, [0.0, 50.0, 100.0, 150.0, 200.0])
        # Missing speed carries the previous value forward
        carried = dashboard_app.compute_telemetry_distance([
            {"t": 0.0, "speed": 180},
            {"t": 1.0, "speed": None},
        ])
        self.assertEqual(carried, [0.0, 50.0])


class TelemetryCompareEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)
        (self.cache_dir / "laps_v2_4242_1.json").write_text(
            json.dumps(MAIN_LAP_FIXTURES), encoding="utf-8"
        )
        (self.cache_dir / "laps_v2_4242_44.json").write_text(
            json.dumps(REF_LAP_FIXTURES), encoding="utf-8"
        )

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def feed_mock(self):
        # One session feed serves both drivers; build filters by driver_number.
        return AsyncMock(return_value=[
            car_sample("2026-05-24T13:03:00+00:00", speed=100, driver_number=1),
            car_sample("2026-05-24T13:03:01+00:00", speed=180, driver_number=1),
            car_sample("2026-05-24T13:03:02+00:00", speed=240, driver_number=1),
            car_sample("2026-05-24T13:03:00+00:00", speed=110, driver_number=44),
            car_sample("2026-05-24T13:03:01+00:00", speed=190, driver_number=44),
            car_sample("2026-05-24T13:03:02+00:00", speed=250, driver_number=44),
        ])

    def patches(self, fetch_mock):
        return (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "resolve_livetiming_session_path", new=AsyncMock(return_value=("session/path/", 2026))),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_mock),
            patch.object(dashboard_app, "flatten_car_data_z", new=lambda records, session_key=None: records),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        )

    async def compare(self, client, driver=1, lap=5, ref_driver=44, ref_lap=5):
        return await client.get(
            f"/api/telemetry_compare?session_key=4242&driver_number={driver}"
            f"&lap_number={lap}&ref_driver_number={ref_driver}&ref_lap_number={ref_lap}"
        )

    async def test_happy_path_returns_main_ref_and_delta(self):
        fetch_mock = self.feed_mock()
        p1, p2, p3, p4, p5 = self.patches(fetch_mock)
        with p1, p2, p3, p4, p5:
            client = dashboard_app.app.test_client()
            response = await self.compare(client)

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertIn("main", data)
        self.assertIn("ref", data)
        self.assertIn("delta", data)

        self.assertEqual(data["main"]["driver_number"], 1)
        self.assertEqual(data["ref"]["driver_number"], 44)

        main_tel = data["main"]["telemetry"]
        self.assertGreaterEqual(len(main_tel), 2)
        self.assertTrue(all("d" in sample for sample in main_tel))
        distances = [sample["d"] for sample in main_tel]
        self.assertEqual(distances, sorted(distances))
        self.assertLess(distances[0], distances[-1])

        self.assertTrue(data["delta"])
        self.assertEqual(set(data["delta"][0].keys()), {"d", "gap"})

    async def test_unknown_ref_lap_returns_404(self):
        fetch_mock = self.feed_mock()
        p1, p2, p3, p4, p5 = self.patches(fetch_mock)
        with p1, p2, p3, p4, p5:
            client = dashboard_app.app.test_client()
            response = await self.compare(client, ref_lap=99)
        self.assertEqual(response.status_code, 404)

    async def test_caching_avoids_extra_fetches_and_single_endpoint_stays_d_free(self):
        fetch_mock = self.feed_mock()
        p1, p2, p3, p4, p5 = self.patches(fetch_mock)
        with p1, p2, p3, p4, p5:
            client = dashboard_app.app.test_client()

            first = await self.compare(client)
            self.assertEqual(first.status_code, 200)
            # One raw feed download serves both drivers' laps
            self.assertEqual(fetch_mock.await_count, 1)

            second = await self.compare(client)
            self.assertEqual(second.status_code, 200)
            # Both per-lap caches hit -> no further upstream car-data fetches
            self.assertEqual(fetch_mock.await_count, 1)
            self.assertEqual(await first.get_json(), await second.get_json())

            # The compare per-lap caches feed /api/car_telemetry too, and that
            # payload must carry no distance field (no-mutation guarantee).
            single = await client.get(
                "/api/car_telemetry?session_key=4242&driver_number=1&lap_number=5"
            )
            self.assertEqual(single.status_code, 200)
            self.assertEqual(fetch_mock.await_count, 1)
            single_data = await single.get_json()
            self.assertTrue(single_data["telemetry"])
            self.assertTrue(all("d" not in sample for sample in single_data["telemetry"]))


class TelemetryCompareStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_index_html_contains_compare_controls(self):
        self.assertIn('id="telemetryCompareDriverSelect"', self.index_html)
        self.assertIn('id="telemetryCompareLapSelect"', self.index_html)
        self.assertIn('id="telemetryDeltaChart"', self.index_html)

    def test_dashboard_js_wires_comparison(self):
        self.assertIn("function loadTelemetryComparison", self.dashboard_js)
        self.assertIn("function renderTelemetryComparison", self.dashboard_js)
        self.assertIn("/api/telemetry_compare", self.dashboard_js)

    def test_styles_contain_compare_classes(self):
        self.assertIn(".telemetry-ref-speed-line", self.styles_css)
        self.assertIn(".telemetry-delta-line", self.styles_css)


if __name__ == "__main__":
    unittest.main()
