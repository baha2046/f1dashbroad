import json
import shutil
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

from js_sources import read_dashboard_js

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"

LAP_FIXTURES = [
    # Out lap: no lap_duration -> window must fall back to the next lap's start
    {"lap_number": 4, "date_start": "2026-05-24T13:01:30+00:00", "lap_duration": None},
    {"lap_number": 5, "date_start": "2026-05-24T13:03:00+00:00", "lap_duration": 90.0},
    # No date_start -> no usable telemetry window
    {"lap_number": 6, "date_start": None, "lap_duration": 88.0},
    # Last lap without duration and no successor -> no usable window
    {"lap_number": 8, "date_start": "2026-05-24T13:06:00+00:00", "lap_duration": None},
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


class CarTelemetryParamValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = dashboard_app.app.test_client()

    async def test_missing_params_are_rejected(self):
        for query in (
            "",
            "session_key=4242",
            "session_key=4242&driver_number=1",
            "driver_number=1&lap_number=5",
        ):
            response = await self.client.get(f"/api/car_telemetry?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")

    async def test_traversal_and_non_numeric_params_are_rejected(self):
        for query in (
            "session_key=../../etc/passwd&driver_number=1&lap_number=5",
            "session_key=4242&driver_number=../evil&lap_number=5",
            "session_key=4242&driver_number=1&lap_number=5;rm",
        ):
            response = await self.client.get(f"/api/car_telemetry?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")


class CarTelemetryEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)
        (self.cache_dir / "laps_v2_4242_1.json").write_text(
            json.dumps(LAP_FIXTURES), encoding="utf-8"
        )

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def request(self, fetch_mock, lap_number=5):
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "resolve_livetiming_session_path", new=AsyncMock(return_value=("session/path/", 2026))),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_mock),
            patch.object(dashboard_app, "flatten_car_data_z", new=lambda records, session_key=None: records),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            return await client.get(
                f"/api/car_telemetry?session_key=4242&driver_number=1&lap_number={lap_number}"
            )

    async def test_reads_livetiming_car_data_feed_and_filters_lap_window(self):
        fetch_mock = AsyncMock(return_value=[
            car_sample("2026-05-24T13:03:00+00:00", speed=120, throttle=80, brake=0, gear=3, drs=1),
            car_sample("2026-05-24T13:03:01.500000+00:00", speed=180, throttle=100, brake=0, gear=5, drs=12),
        ])
        response = await self.request(fetch_mock)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        fetch_mock.assert_awaited_once_with("session/path/", "CarData.z", stream=True, meta={})

        data = await response.get_json()
        self.assertEqual(data["session_key"], 4242)
        self.assertEqual(data["driver_number"], 1)
        self.assertEqual(data["lap_number"], 5)
        self.assertEqual(data["lap_duration"], 90.0)
        self.assertFalse(data["downsampled"])
        self.assertEqual(data["sample_count"], 2)
        first, second = data["telemetry"]
        self.assertEqual(first["t"], 0.0)
        self.assertEqual(second["t"], 1.5)
        self.assertEqual(second["speed"], 180)
        self.assertEqual(second["gear"], 5)
        self.assertEqual(second["drs"], 12)

    async def test_samples_outside_lap_window_are_dropped(self):
        fetch_mock = AsyncMock(return_value=[
            car_sample("2026-05-24T13:02:59+00:00"),          # before lap start
            car_sample("2026-05-24T13:03:10+00:00", speed=250),
            car_sample("2026-05-24T13:04:31+00:00"),          # after lap end
        ])
        response = await self.request(fetch_mock)

        data = await response.get_json()
        self.assertEqual(data["sample_count"], 1)
        self.assertEqual(data["telemetry"][0]["t"], 10.0)

    async def test_missing_duration_falls_back_to_next_lap_start(self):
        fetch_mock = AsyncMock(return_value=[])
        response = await self.request(fetch_mock, lap_number=4)

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data["lap_date_start"], "2026-05-24T13:01:30+00:00")
        self.assertIsNone(data["lap_duration"])
        self.assertEqual(data["sample_count"], 0)

    async def test_unknown_lap_returns_404(self):
        response = await self.request(AsyncMock(return_value=[]), lap_number=99)
        self.assertEqual(response.status_code, 404)

    async def test_lap_without_usable_window_returns_404(self):
        for lap_number in (6, 8):
            response = await self.request(AsyncMock(return_value=[]), lap_number=lap_number)
            self.assertEqual(response.status_code, 404, f"lap {lap_number} did not 404")

    async def test_oversized_payload_is_downsampled(self):
        lap_start = datetime(2026, 5, 24, 13, 3, 0, tzinfo=timezone.utc)
        samples = [
            car_sample((lap_start + timedelta(milliseconds=i * 40)).isoformat(), speed=100 + i % 50)
            for i in range(2000)
        ]
        fetch_mock = AsyncMock(return_value=samples)
        response = await self.request(fetch_mock)

        data = await response.get_json()
        self.assertTrue(data["downsampled"])
        self.assertEqual(data["sample_count"], dashboard_app.TELEMETRY_MAX_POINTS)
        self.assertEqual(len(data["telemetry"]), dashboard_app.TELEMETRY_MAX_POINTS)
        self.assertEqual(data["telemetry"][0]["t"], 0.0)
        # Final sample survives downsampling: 1999 * 0.04s = 79.96s
        self.assertEqual(data["telemetry"][-1]["t"], 79.96)

    async def test_second_request_is_served_from_cache(self):
        fetch_mock = AsyncMock(return_value=[car_sample("2026-05-24T13:03:10+00:00")])
        first = await self.request(fetch_mock)
        self.assertEqual(first.status_code, 200)
        cache_file = self.cache_dir / "car_telemetry_v2_4242_1_5.json"
        self.assertTrue(cache_file.exists())

        second = await self.request(fetch_mock)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        self.assertEqual(await first.get_json(), await second.get_json())


class CarTelemetryStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_laps_view_contains_telemetry_section(self):
        self.assertIn('id="telemetrySection"', self.index_html)
        self.assertIn('id="telemetryLapSelect"', self.index_html)
        self.assertIn('id="telemetryStats"', self.index_html)
        self.assertIn('id="telemetrySpeedChart"', self.index_html)
        self.assertIn('id="telemetryInputsChart"', self.index_html)

    def test_dashboard_js_wires_telemetry(self):
        self.assertIn("telemetryLapSelect: document.getElementById('telemetryLapSelect')", self.dashboard_js)
        self.assertIn("telemetrySpeedChart: document.getElementById('telemetrySpeedChart')", self.dashboard_js)
        self.assertIn("telemetryInputsChart: document.getElementById('telemetryInputsChart')", self.dashboard_js)
        self.assertIn("function loadLapTelemetry", self.dashboard_js)
        self.assertIn("function renderTelemetryCharts", self.dashboard_js)
        self.assertIn("function maybeAutoLoadTelemetry", self.dashboard_js)
        self.assertIn("/api/car_telemetry", self.dashboard_js)
        self.assertIn("telemetryCache", self.dashboard_js)

    def test_styles_contain_telemetry_classes(self):
        for css_class in (
            ".telemetry-section",
            ".telemetry-stat-chip",
            ".telemetry-speed-line",
            ".telemetry-throttle-line",
            ".telemetry-brake-line",
            ".telemetry-drs-shading",
            ".telemetry-crosshair",
        ):
            self.assertIn(css_class, self.styles_css)


if __name__ == "__main__":
    unittest.main()
