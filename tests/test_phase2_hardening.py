import unittest
from pathlib import Path

import app as dashboard_app


class LoggingAdoptionTests(unittest.TestCase):
    def test_backend_modules_use_logging_not_print(self):
        root = Path(__file__).resolve().parents[1]
        for module in ("app.py", "livetiming_client.py", "livetiming_compat.py"):
            source = (root / module).read_text(encoding="utf-8")
            self.assertNotIn("print(", source, f"{module} still uses print()")
        self.assertTrue(hasattr(dashboard_app, "logger"))


class CspHeaderTests(unittest.IsolatedAsyncioTestCase):
    async def test_index_carries_csp_and_nosniff(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/")
        csp = response.headers.get("Content-Security-Policy", "")
        self.assertIn("default-src 'self'", csp)
        self.assertIn("script-src 'self'", csp)
        self.assertNotIn("script-src 'self' 'unsafe-inline'", csp)
        self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")

    async def test_api_responses_do_not_carry_csp(self):
        client = dashboard_app.app.test_client()
        response = await client.get("/api/weather")  # 400: missing session_key
        self.assertIsNone(response.headers.get("Content-Security-Policy"))


class PeriodicEvictionTests(unittest.IsolatedAsyncioTestCase):
    async def test_serving_lifecycle_starts_and_stops_maintenance_task(self):
        await dashboard_app._startup_cache_maintenance()
        task = dashboard_app._cache_maintenance_task
        self.assertIsNotNone(task)
        self.assertFalse(task.done())

        await dashboard_app._stop_cache_maintenance()
        self.assertIsNone(dashboard_app._cache_maintenance_task)
        self.assertTrue(task.cancelled() or task.cancelling())


class InlineHandlerBanTests(unittest.TestCase):
    def test_no_inline_event_handlers_remain(self):
        # The CSP forbids inline handlers; the delegated image-fallback and
        # retry-button listeners replace them
        root = Path(__file__).resolve().parents[1]
        sources = [(root / "templates" / "index.html").read_text(encoding="utf-8")]
        sources += [p.read_text(encoding="utf-8") for p in (root / "static" / "js").glob("*.js")]
        for source in sources:
            self.assertNotIn("onerror=", source)
            self.assertNotIn("onclick=", source)


if __name__ == "__main__":
    unittest.main()
