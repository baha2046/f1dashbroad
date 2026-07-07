import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"

SESSION_PATH = "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/"

WEATHER_RECORDS = [("00:01:00.000", {"AirTemp": "25.0", "Humidity": "40.0"})]
HEARTBEAT_RECORDS = [("00:00:00.000", {"Utc": "2026-07-05T14:00:00Z"})]


class Phase1DataLayerTests(unittest.IsolatedAsyncioTestCase):
    """Phase 1 data-layer changes: raw feed cache, degraded payloads, cache
    headers (doc/2026-07-07-project-review-and-enhancement-plan.md)."""

    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)
        dashboard_app._stream_start_cache.clear()

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def seed_session(self, date_start="2026-07-05T15:00:00Z", date_end="2026-07-05T17:00:00Z"):
        sessions = [{
            "session_key": 11326,
            "meeting_key": 1289,
            "year": 2026,
            "path": SESSION_PATH,
            "date_start": date_start,
            "date_end": date_end,
            "session_name": "Race",
            "session_type": "Race",
            "is_cancelled": False,
        }]
        (self.cache_dir / "sessions_2026.json").write_text(json.dumps(sessions), encoding="utf-8")

    async def test_raw_feed_cache_serves_second_call_without_upstream(self):
        self.seed_session()
        fetch_mock = AsyncMock(return_value=WEATHER_RECORDS)

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_mock):
            first = await dashboard_app.fetch_livetiming_feed_cached(
                11326, SESSION_PATH, "WeatherData", stream=True, year=2026
            )
            second = await dashboard_app.fetch_livetiming_feed_cached(
                11326, SESSION_PATH, "WeatherData", stream=True, year=2026
            )

        self.assertEqual(fetch_mock.await_count, 1)
        # JSON round-trip turns record tuples into lists; both calls agree
        self.assertEqual(json.dumps(second), json.dumps([list(r) for r in first]))
        raw_files = list(self.cache_dir.glob("raw_11326_WeatherData_stream.json.gz"))
        self.assertEqual(len(raw_files), 1)

    async def test_degraded_raw_feed_is_not_cached_for_historical_sessions(self):
        # Historical session (ended long before "now")
        self.seed_session(date_start="2026-06-01T15:00:00Z", date_end="2026-06-01T17:00:00Z")

        async def keyframe_fallback(session_path, feed_name, stream=True, meta=None):
            if meta is not None:
                meta["degraded"] = True
            return {"AirTemp": "25.0"}

        meta = {}
        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "fetch_livetiming_feed", new=AsyncMock(side_effect=keyframe_fallback)):
            data = await dashboard_app.fetch_livetiming_feed_cached(
                11326, SESSION_PATH, "WeatherData", stream=True, year=2026, meta=meta
            )

        self.assertEqual(data, {"AirTemp": "25.0"})
        self.assertTrue(meta.get("degraded"))
        # No permanent copy of the snapshot: the next request retries upstream
        self.assertEqual(list(self.cache_dir.glob("raw_*.json.gz")), [])

    async def test_get_cached_livetiming_skips_permanent_write_for_degraded_payloads(self):
        self.seed_session(date_start="2026-06-01T15:00:00Z", date_end="2026-06-01T17:00:00Z")

        async def degraded_fetcher():
            return dashboard_app.DegradedPayload([{"driver_number": 44}])

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            data = await dashboard_app.get_cached_livetiming(
                "weather_11326.json", degraded_fetcher, session_key=11326, year=2026
            )

        self.assertEqual(data, [{"driver_number": 44}])
        self.assertFalse((self.cache_dir / "weather_11326.json").exists())

    async def test_historical_sessions_get_long_lived_cache_control(self):
        self.seed_session(date_start="2026-06-01T15:00:00Z", date_end="2026-06-01T17:00:00Z")
        feeds = {"WeatherData": WEATHER_RECORDS, "Heartbeat": HEARTBEAT_RECORDS}

        async def dispatch(session_path, feed_name, stream=True, meta=None):
            return feeds[feed_name]

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "current_season_year", return_value=2026), \
                patch.object(dashboard_app, "fetch_livetiming_feed", new=AsyncMock(side_effect=dispatch)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/weather?session_key=11326&year=2026")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=3600")

    async def test_live_sessions_get_no_store_cache_control(self):
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        self.seed_session(
            date_start=(now - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            date_end=(now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
        feeds = {"WeatherData": WEATHER_RECORDS, "Heartbeat": HEARTBEAT_RECORDS}

        async def dispatch(session_path, feed_name, stream=True, meta=None):
            return feeds[feed_name]

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "current_season_year", return_value=2026), \
                patch.object(dashboard_app, "fetch_livetiming_feed", new=AsyncMock(side_effect=dispatch)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/weather?session_key=11326&year=2026")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    async def test_explicit_year_param_skips_session_year_scan(self):
        self.seed_session()
        feeds = {"WeatherData": WEATHER_RECORDS, "Heartbeat": HEARTBEAT_RECORDS}

        async def dispatch(session_path, feed_name, stream=True, meta=None):
            return feeds[feed_name]

        scan_mock = AsyncMock(side_effect=AssertionError("find_session_year must not be called"))
        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)), \
                patch.object(dashboard_app, "current_season_year", return_value=2026), \
                patch.object(dashboard_app, "find_session_year", new=scan_mock), \
                patch.object(dashboard_app, "fetch_livetiming_feed", new=AsyncMock(side_effect=dispatch)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/weather?session_key=11326&year=2026")

        self.assertEqual(response.status_code, 200)

    async def test_invalid_year_param_is_rejected(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/weather?session_key=11326&year=abc")
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
