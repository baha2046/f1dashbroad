import json
import os
import subprocess
import textwrap
import shutil
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

from js_sources import read_dashboard_js

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


def session_fixture(session_key=4242, start_offset_hours=-1, end_offset_hours=1, **extra):
    now = datetime.now(timezone.utc)
    session = {
        "session_key": session_key,
        "meeting_key": 1234,
        "year": dashboard_app.current_season_year(),
        "session_name": "Race",
        "session_type": "Race",
        "date_start": (now + timedelta(hours=start_offset_hours)).isoformat(),
        "date_end": (now + timedelta(hours=end_offset_hours)).isoformat(),
        "is_cancelled": False,
    }
    session.update(extra)
    return session


class IntervalsEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def test_missing_or_invalid_session_key_is_rejected(self):
        client = dashboard_app.app.test_client()
        for query in ("", "session_key=", "session_key=../../etc/passwd", "session_key=4242;rm"):
            response = await client.get(f"/api/intervals?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")

    async def test_intervals_endpoint_returns_cached_data(self):
        sample_intervals = [
            {"session_key": 4242, "driver_number": 1, "gap_to_leader": None, "interval": None,
             "date": "2026-07-04T14:20:00+00:00"},
            {"session_key": 4242, "driver_number": 44, "gap_to_leader": 1.234, "interval": 1.234,
             "date": "2026-07-04T14:20:00+00:00"},
        ]
        (self.cache_dir / "intervals_4242.json").write_text(
            json.dumps(sample_intervals), encoding="utf-8"
        )

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/intervals?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(await response.get_json(), sample_intervals)

    async def test_cache_miss_fetches_openf1_intervals_endpoint(self):
        fetch_mock = AsyncMock(return_value=[])
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", new=fetch_mock),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/intervals?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        url = fetch_mock.await_args.args[0]
        self.assertIn("https://api.openf1.org/v1/intervals", url)
        self.assertIn("session_key=4242", url)


class IsSessionLiveTests(unittest.TestCase):
    def test_session_between_start_and_end_is_live(self):
        self.assertTrue(dashboard_app.is_session_live(session_fixture()))

    def test_upcoming_session_is_not_live(self):
        session = session_fixture(start_offset_hours=2, end_offset_hours=4)
        self.assertFalse(dashboard_app.is_session_live(session))

    def test_session_within_overrun_buffer_is_still_live(self):
        session = session_fixture(start_offset_hours=-3, end_offset_hours=0)
        now = datetime.now(timezone.utc) + timedelta(
            seconds=dashboard_app.LIVE_SESSION_OVERRUN_SECONDS - 60
        )
        self.assertTrue(dashboard_app.is_session_live(session, now=now))

    def test_session_past_overrun_buffer_is_not_live(self):
        session = session_fixture(start_offset_hours=-6, end_offset_hours=-4)
        self.assertFalse(dashboard_app.is_session_live(session))

    def test_cancelled_or_missing_session_is_not_live(self):
        self.assertFalse(dashboard_app.is_session_live(session_fixture(is_cancelled=True)))
        self.assertFalse(dashboard_app.is_session_live(None))

    def test_session_without_dates_is_not_live(self):
        session = session_fixture()
        session["date_start"] = None
        session["date_end"] = None
        self.assertFalse(dashboard_app.is_session_live(session))


class LiveTtlTests(unittest.IsolatedAsyncioTestCase):
    """Live sessions use a 30s cache TTL so polling clients see fresh data."""

    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def seed_session(self, session):
        year = dashboard_app.current_season_year()
        (self.cache_dir / f"sessions_{year}.json").write_text(
            json.dumps([session]), encoding="utf-8"
        )

    def seed_stale_position_cache(self, age_seconds=60):
        cache_path = self.cache_dir / "position_4242.json"
        cache_path.write_text(json.dumps([{"driver_number": 1, "position": 1}]), encoding="utf-8")
        stale_time = datetime.now().timestamp() - age_seconds
        os.utime(cache_path, (stale_time, stale_time))

    async def request_position(self, fetch_mock):
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_url", new=fetch_mock),
        ):
            client = dashboard_app.app.test_client()
            return await client.get("/api/position?session_key=4242")

    async def test_live_session_refetches_cache_older_than_live_ttl(self):
        self.assertLess(dashboard_app.LIVE_CACHE_TTL_SECONDS, 60)
        self.seed_session(session_fixture())
        self.seed_stale_position_cache(age_seconds=60)

        fresh = [{"driver_number": 1, "position": 2}]
        fetch_mock = AsyncMock(return_value=fresh)
        response = await self.request_position(fetch_mock)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        self.assertEqual(await response.get_json(), fresh)

    async def test_non_live_session_keeps_serving_cache_within_default_ttl(self):
        self.seed_session(session_fixture(start_offset_hours=24, end_offset_hours=26))
        self.seed_stale_position_cache(age_seconds=60)

        fetch_mock = AsyncMock(return_value=[])
        response = await self.request_position(fetch_mock)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 0)
        self.assertEqual(await response.get_json(), [{"driver_number": 1, "position": 1}])


class LiveModeJsHelperTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(self.root)

    def _extract_function(self, function_name):
        marker = f"function {function_name}"
        start = self.dashboard_js.find(marker)
        self.assertNotEqual(start, -1, f"{function_name} is missing from the dashboard JS")

        body_start = self.dashboard_js.find("{", start)
        self.assertNotEqual(body_start, -1, f"{function_name} has no function body")

        depth = 0
        for index in range(body_start, len(self.dashboard_js)):
            char = self.dashboard_js[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return self.dashboard_js[start:index + 1]

        self.fail(f"{function_name} body was not closed")

    def _run_node(self, script):
        completed = subprocess.run(
            ["node", "-e", script],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        return json.loads(completed.stdout)

    def test_is_live_session_now_detects_live_window(self):
        function_source = self._extract_function("isLiveSessionNow")
        cases = [
            # (start offset minutes, end offset minutes, cancelled, expected)
            (-60, 60, False, True),    # in progress
            (-180, -20, False, True),  # ended <30min ago: overrun buffer
            (-300, -120, False, False),  # long finished
            (120, 240, False, False),  # upcoming
            (-60, 60, True, False),    # cancelled
        ]
        script = textwrap.dedent(f"""
            {function_source}

            const now = new Date("2026-07-04T14:00:00+00:00");
            const cases = {json.dumps(cases)};
            const results = cases.map(([startMin, endMin, cancelled]) => isLiveSessionNow({{
                date_start: new Date(now.getTime() + startMin * 60000).toISOString(),
                date_end: new Date(now.getTime() + endMin * 60000).toISOString(),
                is_cancelled: cancelled
            }}, now));
            results.push(isLiveSessionNow(null, now));
            console.log(JSON.stringify(results));
        """)
        expected = [case[3] for case in cases] + [False]
        self.assertEqual(self._run_node(script), expected)

    def test_build_live_timing_rows_uses_latest_records_sorted_by_position(self):
        function_source = self._extract_function("buildLiveTimingRows")
        positions = [
            {"driver_number": 44, "position": 1, "date": "2026-07-04T14:00:00+00:00"},
            {"driver_number": 1, "position": 2, "date": "2026-07-04T14:00:00+00:00"},
            # later swap: 1 takes the lead
            {"driver_number": 1, "position": 1, "date": "2026-07-04T14:10:00+00:00"},
            {"driver_number": 44, "position": 2, "date": "2026-07-04T14:10:00+00:00"},
            {"driver_number": 16, "position": 3, "date": "2026-07-04T14:05:00+00:00"},
        ]
        intervals = [
            {"driver_number": 44, "gap_to_leader": 0.8, "interval": 0.8, "date": "2026-07-04T14:09:00+00:00"},
            {"driver_number": 44, "gap_to_leader": 1.5, "interval": 1.5, "date": "2026-07-04T14:10:00+00:00"},
            {"driver_number": 1, "gap_to_leader": None, "interval": None, "date": "2026-07-04T14:10:00+00:00"},
            {"driver_number": 16, "gap_to_leader": "+1 LAP", "interval": 12.0, "date": "2026-07-04T14:10:00+00:00"},
        ]
        script = textwrap.dedent(f"""
            {function_source}

            const rows = buildLiveTimingRows({json.dumps(positions)}, {json.dumps(intervals)});
            console.log(JSON.stringify(rows.map(row => [
                row.position, row.driver_number, row.gap_to_leader, row.interval
            ])));
        """)
        self.assertEqual(self._run_node(script), [
            [1, 1, None, None],
            [2, 44, 1.5, 1.5],
            [3, 16, "+1 LAP", 12.0],
        ])

    def test_build_live_timing_rows_without_intervals_still_orders_field(self):
        function_source = self._extract_function("buildLiveTimingRows")
        positions = [
            {"driver_number": 4, "position": 2, "date": "2026-07-04T14:00:00+00:00"},
            {"driver_number": 81, "position": 1, "date": "2026-07-04T14:00:00+00:00"},
        ]
        script = textwrap.dedent(f"""
            {function_source}

            const rows = buildLiveTimingRows({json.dumps(positions)}, []);
            console.log(JSON.stringify(rows.map(row => [row.position, row.driver_number, row.gap_to_leader])));
        """)
        self.assertEqual(self._run_node(script), [[1, 81, None], [2, 4, None]])

    def test_build_live_timing_rows_handles_empty_input(self):
        function_source = self._extract_function("buildLiveTimingRows")
        script = textwrap.dedent(f"""
            {function_source}

            console.log(JSON.stringify([buildLiveTimingRows([], []), buildLiveTimingRows(null, null)]));
        """)
        self.assertEqual(self._run_node(script), [[], []])


class LiveModeStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_index_contains_live_indicator_and_timing_card(self):
        self.assertIn('id="liveIndicator"', self.index_html)
        self.assertIn('id="liveCountdown"', self.index_html)
        self.assertIn('id="liveTimingCard"', self.index_html)
        self.assertIn('id="liveTimingTableBody"', self.index_html)
        self.assertIn('id="liveTimingUpdated"', self.index_html)
        self.assertIn("/static/js/11-live-mode.js", self.index_html)

    def test_dashboard_js_wires_live_mode(self):
        self.assertIn("liveIndicator: document.getElementById('liveIndicator')", self.dashboard_js)
        self.assertIn("liveCountdown: document.getElementById('liveCountdown')", self.dashboard_js)
        self.assertIn("liveTimingCard: document.getElementById('liveTimingCard')", self.dashboard_js)
        self.assertIn("liveTimingTableBody: document.getElementById('liveTimingTableBody')", self.dashboard_js)
        self.assertIn("function createLiveState", self.dashboard_js)
        self.assertIn("function setupLiveMode", self.dashboard_js)
        self.assertIn("function stopLiveMode", self.dashboard_js)
        self.assertIn("function refreshLiveData", self.dashboard_js)
        self.assertIn("function renderLiveTiming", self.dashboard_js)
        self.assertIn("/api/intervals", self.dashboard_js)
        self.assertIn("state.intervals", self.dashboard_js)
        # live mode lifecycle is tied to session selection
        self.assertIn("stopLiveMode();", self.dashboard_js)
        self.assertIn("setupLiveMode();", self.dashboard_js)

    def test_styles_contain_live_mode_classes(self):
        for css_class in (
            ".live-indicator",
            ".live-dot",
            ".live-countdown",
            ".live-timing-card",
            ".live-timing-table",
            ".live-timing-updated",
        ):
            self.assertIn(css_class, self.styles_css)


if __name__ == "__main__":
    unittest.main()
