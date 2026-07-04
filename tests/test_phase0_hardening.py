import asyncio
import json
import os
import shutil
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class ParamValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = dashboard_app.app.test_client()

    async def test_session_key_path_traversal_is_rejected(self):
        for endpoint in ("laps", "weather", "stints", "pit", "position", "results", "race_control", "drivers"):
            response = await self.client.get(f"/api/{endpoint}?session_key=../../etc/passwd")
            self.assertEqual(response.status_code, 400, f"/api/{endpoint} accepted traversal input")

    async def test_missing_session_key_is_rejected(self):
        response = await self.client.get("/api/laps")
        self.assertEqual(response.status_code, 400)

    async def test_non_numeric_driver_number_is_rejected(self):
        response = await self.client.get("/api/laps?session_key=4242&driver_number=../../evil")
        self.assertEqual(response.status_code, 400)

    async def test_non_numeric_meeting_key_is_rejected(self):
        response = await self.client.get("/api/meetings?meeting_key=abc")
        self.assertEqual(response.status_code, 400)

    async def test_non_numeric_year_is_rejected(self):
        response = await self.client.get("/api/sessions?year=20x6")
        self.assertEqual(response.status_code, 400)

    async def test_malformed_standings_date_is_rejected(self):
        response = await self.client.get("/api/race_standings?year=2026&date=../evil")
        self.assertEqual(response.status_code, 400)

    async def test_non_numeric_standings_round_is_rejected(self):
        response = await self.client.get("/api/race_standings?year=2026&round=x")
        self.assertEqual(response.status_code, 400)


class CacheBehaviorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_upstream_failure_without_cache_returns_502(self):
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=Exception("boom"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/weather?session_key=4242")

        self.assertEqual(response.status_code, 502)
        data = await response.get_json()
        self.assertEqual(data["error"], "upstream_error")

    async def test_upstream_failure_serves_stale_cache(self):
        stale_payload = [{"air_temperature": 21.5}]
        cache_file = self.cache_dir / "weather_4242.json"
        cache_file.write_text(json.dumps(stale_payload), encoding="utf-8")
        expired = time.time() - 3600  # past the 5-minute active-session TTL
        os.utime(cache_file, (expired, expired))

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=Exception("boom"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/weather?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(await response.get_json(), stale_payload)

    async def test_successful_fetch_writes_cache_atomically(self):
        payload = [{"lap_number": 1}]

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(return_value=payload)),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/laps?session_key=4242")

        self.assertEqual(response.status_code, 200)
        cache_file = self.cache_dir / "laps_4242.json"
        self.assertTrue(cache_file.exists())
        self.assertEqual(json.loads(cache_file.read_text(encoding="utf-8")), payload)
        leftovers = [p for p in self.cache_dir.iterdir() if p.suffix == ".tmp"]
        self.assertEqual(leftovers, [])

    async def test_concurrent_requests_share_a_single_upstream_fetch(self):
        payload = [{"driver_number": 1}]
        fetch_calls = 0

        async def slow_fetch(url, api_key=None):
            nonlocal fetch_calls
            fetch_calls += 1
            await asyncio.sleep(0.05)
            return payload

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", side_effect=slow_fetch),
        ):
            client = dashboard_app.app.test_client()
            responses = await asyncio.gather(
                client.get("/api/position?session_key=4242"),
                client.get("/api/position?session_key=4242"),
                client.get("/api/position?session_key=4242"),
            )

        for response in responses:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(await response.get_json(), payload)
        self.assertEqual(fetch_calls, 1)


class CurrentSeasonTests(unittest.TestCase):
    def test_is_historical_uses_current_clock_year(self):
        this_year = datetime.now(timezone.utc).year
        self.assertTrue(dashboard_app.is_historical({"year": this_year - 1}))
        self.assertFalse(dashboard_app.is_historical({"year": this_year}))

    def test_current_season_year_matches_clock(self):
        self.assertEqual(dashboard_app.current_season_year(), datetime.now(timezone.utc).year)


class UpstreamErrorBannerWiringTests(unittest.TestCase):
    def test_custom_fetch_surfaces_upstream_errors(self):
        from js_sources import read_dashboard_js

        dashboard_js = read_dashboard_js(Path(__file__).resolve().parents[1])
        self.assertIn("response.status === 502 || response.status === 503", dashboard_js)
        self.assertIn("errData.error === 'upstream_error'", dashboard_js)


if __name__ == "__main__":
    unittest.main()
