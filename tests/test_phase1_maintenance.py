import gzip
import json
import os
import shutil
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class SessionEndpointFactoryTests(unittest.TestCase):
    def test_all_session_scoped_routes_are_registered(self):
        rules = {rule.rule for rule in dashboard_app.app.url_map.iter_rules()}
        for route_name in ("weather", "stints", "pit", "position", "results", "race_control"):
            self.assertIn(f"/api/{route_name}", rules)

    def test_results_route_maps_to_livetiming_timing_feed(self):
        # /api/results left the factory dict for a bespoke handler (Jolpica
        # enrichment) but must keep the same feed/cache contract
        self.assertEqual(dashboard_app.RESULTS_ENDPOINT_CONFIG["feed"], "TimingData")
        self.assertFalse(dashboard_app.RESULTS_ENDPOINT_CONFIG["stream"])
        self.assertEqual(dashboard_app.RESULTS_ENDPOINT_CONFIG["cache_prefix"], "results_v2")

    def test_stints_route_reads_livetiming_keyframe(self):
        self.assertEqual(
            dashboard_app.LIVETIMING_SESSION_ENDPOINTS["stints"]["feed"],
            "TyreStintSeries",
        )
        self.assertFalse(dashboard_app.LIVETIMING_SESSION_ENDPOINTS["stints"]["stream"])
        self.assertEqual(
            dashboard_app.LIVETIMING_SESSION_ENDPOINTS["stints"]["cache_prefix"],
            "stints_v2",
        )


class ApiResponseHeaderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_large_api_response_is_gzipped_with_cache_control(self):
        payload = [{"lap_number": i, "lap_duration": 90.0 + i} for i in range(200)]
        (self.cache_dir / "laps_4242.json").write_text(json.dumps(payload), encoding="utf-8")

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get(
                "/api/laps?session_key=4242", headers={"Accept-Encoding": "gzip"}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Content-Encoding"), "gzip")
        self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=60")
        self.assertEqual(response.headers.get("Vary"), "Accept-Encoding")
        body = gzip.decompress(await response.get_data(as_text=False))
        self.assertEqual(json.loads(body), payload)

    async def test_small_or_non_gzip_requests_are_not_compressed(self):
        payload = [{"lap_number": 1}]
        (self.cache_dir / "laps_4242.json").write_text(json.dumps(payload), encoding="utf-8")

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get(
                "/api/laps?session_key=4242", headers={"Accept-Encoding": "identity"}
            )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("Content-Encoding"))


class CacheEvictionTests(unittest.TestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def test_oldest_files_are_evicted_until_under_limit(self):
        now = time.time()
        for index in range(5):
            path = self.cache_dir / f"laps_{index}.json"
            path.write_bytes(b"x" * 1000)
            os.utime(path, (now - (5 - index) * 3600, now - (5 - index) * 3600))

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "CACHE_MAX_BYTES", 2500),
        ):
            dashboard_app._evict_cache_if_over_limit()

        remaining = sorted(p.name for p in self.cache_dir.iterdir())
        # The three oldest files (laps_0..2) are gone; the two newest stay
        self.assertEqual(remaining, ["laps_3.json", "laps_4.json"])

    def test_no_eviction_when_under_limit(self):
        (self.cache_dir / "laps_1.json").write_bytes(b"x" * 100)

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "CACHE_MAX_BYTES", 10_000),
        ):
            dashboard_app._evict_cache_if_over_limit()

        self.assertTrue((self.cache_dir / "laps_1.json").exists())


if __name__ == "__main__":
    unittest.main()
