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
    {"lap_number": 5, "date_start": "2026-05-24T13:03:00+00:00", "lap_duration": 90.0},
    {"lap_number": 6, "date_start": "2026-05-24T13:04:30+00:00", "lap_duration": 89.5},
]

# Leader (driver 1) and a backmarker (driver 44): race-lap windows follow driver 1
RACE_LAP_FIXTURES = [
    {"driver_number": 1, "lap_number": 5, "date_start": "2026-05-24T13:03:00+00:00", "lap_duration": 90.0},
    {"driver_number": 1, "lap_number": 6, "date_start": "2026-05-24T13:04:30+00:00", "lap_duration": 89.5},
    {"driver_number": 44, "lap_number": 5, "date_start": "2026-05-24T13:03:20+00:00", "lap_duration": 95.0},
    {"driver_number": 44, "lap_number": 6, "date_start": "2026-05-24T13:04:55+00:00", "lap_duration": 96.0},
]


def location_sample(date, driver_number, x=100, y=200, z=5):
    return {"date": date, "driver_number": driver_number, "x": x, "y": y, "z": z}


class TrackReplayParamValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = dashboard_app.app.test_client()

    async def test_missing_params_are_rejected(self):
        for query in (
            "",
            "session_key=4242",
            "session_key=4242&driver_number=1",
            "driver_number=1&lap_number=5",
        ):
            response = await self.client.get(f"/api/track_replay?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")

    async def test_traversal_and_non_numeric_params_are_rejected(self):
        for query in (
            "session_key=../../etc/passwd&driver_number=1&lap_number=5",
            "session_key=4242&driver_number=../evil&lap_number=5",
            "session_key=4242&driver_number=1&lap_number=5;rm",
        ):
            response = await self.client.get(f"/api/track_replay?{query}")
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")


class TrackReplayEndpointTests(unittest.IsolatedAsyncioTestCase):
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
            patch.object(dashboard_app, "flatten_position_z", new=lambda records, session_key=None: records),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            return await client.get(
                f"/api/track_replay?session_key=4242&driver_number=1&lap_number={lap_number}"
            )

    async def test_reads_livetiming_position_feed_for_whole_field_in_lap_window(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-24T13:03:00+00:00", 1, x=-3650, y=1193),
            location_sample("2026-05-24T13:03:01.500000+00:00", 1, x=-3600, y=1210),
            location_sample("2026-05-24T13:03:00.500000+00:00", 44, x=500, y=-750),
        ])
        response = await self.request(fetch_mock)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        fetch_mock.assert_awaited_once_with("session/path/", "Position.z", stream=True, meta={})

        data = await response.get_json()
        self.assertEqual(data["session_key"], 4242)
        self.assertEqual(data["driver_number"], 1)
        self.assertEqual(data["lap_number"], 5)
        self.assertEqual(data["lap_duration"], 90.0)
        self.assertEqual(data["window_seconds"], 90.0)

        drivers = {d["driver_number"]: d["samples"] for d in data["drivers"]}
        self.assertEqual(set(drivers), {1, 44})
        self.assertEqual(drivers[1], [[0.0, -3650, 1193], [1.5, -3600, 1210]])
        self.assertEqual(drivers[44], [[0.5, 500, -750]])

    async def test_samples_outside_window_or_without_coords_are_dropped(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-24T13:02:59+00:00", 1),            # before start
            location_sample("2026-05-24T13:03:10+00:00", 1, x=7, y=8),
            location_sample("2026-05-24T13:04:31+00:00", 1),            # after end
            {"date": "2026-05-24T13:03:11+00:00", "driver_number": 1},  # no coords
        ])
        response = await self.request(fetch_mock)

        data = await response.get_json()
        self.assertEqual(len(data["drivers"]), 1)
        self.assertEqual(data["drivers"][0]["samples"], [[10.0, 7, 8]])

    async def test_unknown_lap_returns_404(self):
        response = await self.request(AsyncMock(return_value=[]), lap_number=99)
        self.assertEqual(response.status_code, 404)

    async def test_oversized_driver_series_is_downsampled(self):
        lap_start = datetime(2026, 5, 24, 13, 3, 0, tzinfo=timezone.utc)
        samples = [
            location_sample((lap_start + timedelta(milliseconds=i * 100)).isoformat(), 1, x=i, y=i)
            for i in range(880)  # 88s of 10Hz data
        ]
        fetch_mock = AsyncMock(return_value=samples)
        response = await self.request(fetch_mock)

        data = await response.get_json()
        self.assertTrue(data["downsampled"])
        series = data["drivers"][0]["samples"]
        self.assertEqual(len(series), dashboard_app.REPLAY_MAX_POINTS_PER_DRIVER)
        self.assertEqual(series[0], [0.0, 0, 0])
        self.assertEqual(series[-1], [87.9, 879, 879])

    async def test_second_request_is_served_from_cache(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-24T13:03:10+00:00", 1),
        ])
        first = await self.request(fetch_mock)
        self.assertEqual(first.status_code, 200)
        cache_file = self.cache_dir / "track_replay_v2_4242_1_5.json"
        self.assertTrue(cache_file.exists())

        second = await self.request(fetch_mock)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        self.assertEqual(await first.get_json(), await second.get_json())


class BuildRaceLapWindowTests(unittest.TestCase):
    """Full-race replay windows (doc/2026-07-05-full-race-replay-design.md)."""

    def parse(self, value):
        return dashboard_app.parse_iso_utc(value)

    def test_mid_race_lap_spans_leader_start_to_next_race_lap_start(self):
        window = dashboard_app.build_race_lap_window(RACE_LAP_FIXTURES, 5)
        self.assertEqual(
            window,
            (self.parse("2026-05-24T13:03:00+00:00"), self.parse("2026-05-24T13:04:30+00:00")),
        )

    def test_final_lap_closes_at_latest_lap_end_across_field(self):
        window = dashboard_app.build_race_lap_window(RACE_LAP_FIXTURES, 6)
        # driver 44 crosses the line last: 13:04:55 + 96s
        self.assertEqual(
            window,
            (self.parse("2026-05-24T13:04:30+00:00"), self.parse("2026-05-24T13:06:31+00:00")),
        )

    def test_unknown_lap_or_bad_input_returns_none(self):
        self.assertIsNone(dashboard_app.build_race_lap_window(RACE_LAP_FIXTURES, 99))
        self.assertIsNone(dashboard_app.build_race_lap_window(None, 5))
        self.assertIsNone(dashboard_app.build_race_lap_window([{"lap_number": 5}], 5))

    def test_final_lap_without_any_duration_returns_none(self):
        laps = [{"driver_number": 1, "lap_number": 5, "date_start": "2026-05-24T13:03:00+00:00"}]
        self.assertIsNone(dashboard_app.build_race_lap_window(laps, 5))

    def test_live_in_progress_lap_ignores_stale_earlier_lap_ends(self):
        # No one has completed lap 21 yet; a many-laps-down car's recorded lap
        # end falls after lap 21 starts and must not close the window
        laps = [
            {"driver_number": 1, "lap_number": 20, "date_start": "2026-05-24T14:00:00+00:00", "lap_duration": 90.0},
            {"driver_number": 1, "lap_number": 21, "date_start": "2026-05-24T14:01:30+00:00"},
            {"driver_number": 44, "lap_number": 5, "date_start": "2026-05-24T14:01:00+00:00", "lap_duration": 200.0},
        ]
        self.assertIsNone(dashboard_app.build_race_lap_window(laps, 21))


class TrackReplayFullRaceEndpointTests(unittest.IsolatedAsyncioTestCase):
    """/api/track_replay without driver_number serves leader-based race laps."""

    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)
        (self.cache_dir / "laps_v2_4242.json").write_text(
            json.dumps(RACE_LAP_FIXTURES), encoding="utf-8"
        )

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def request(self, fetch_mock, lap_number=5):
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "resolve_livetiming_session_path", new=AsyncMock(return_value=("session/path/", 2026))),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_mock),
            patch.object(dashboard_app, "flatten_position_z", new=lambda records, session_key=None: records),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            return await client.get(
                f"/api/track_replay?session_key=4242&lap_number={lap_number}"
            )

    async def test_reads_livetiming_position_feed_for_race_lap_window_without_driver(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-24T13:03:00+00:00", 1, x=-3650, y=1193),
            location_sample("2026-05-24T13:03:30+00:00", 44, x=500, y=-750),
        ])
        response = await self.request(fetch_mock)

        self.assertEqual(response.status_code, 200)
        fetch_mock.assert_awaited_once_with("session/path/", "Position.z", stream=True, meta={})

        data = await response.get_json()
        self.assertIsNone(data["driver_number"])
        self.assertIsNone(data["lap_duration"])
        self.assertEqual(data["lap_number"], 5)
        self.assertEqual(data["window_seconds"], 90.0)
        drivers = {d["driver_number"]: d["samples"] for d in data["drivers"]}
        self.assertEqual(set(drivers), {1, 44})

    async def test_final_race_lap_covers_the_whole_field_to_the_flag(self):
        fetch_mock = AsyncMock(return_value=[])
        response = await self.request(fetch_mock, lap_number=6)

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data["window_seconds"], 121.0)

    async def test_unknown_race_lap_returns_404(self):
        response = await self.request(AsyncMock(return_value=[]), lap_number=99)
        self.assertEqual(response.status_code, 404)

    async def test_full_race_payload_is_cached_under_race_scope(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-24T13:03:10+00:00", 1),
        ])
        first = await self.request(fetch_mock)
        self.assertEqual(first.status_code, 200)
        self.assertTrue((self.cache_dir / "track_replay_v2_4242_race_5.json").exists())

        second = await self.request(fetch_mock)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        self.assertEqual(await first.get_json(), await second.get_json())


class TrackReplayWindowEndpointTests(unittest.IsolatedAsyncioTestCase):
    """/api/track_replay with explicit start/end serves full-session windows
    (doc/2026-07-07-full-qualifying-replay-design.md)."""

    WINDOW_QUERY = "session_key=4242&start=2026-05-23T14:00:00Z&end=2026-05-23T14:02:00Z"

    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    async def request(self, fetch_mock, query=WINDOW_QUERY):
        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "resolve_livetiming_session_path", new=AsyncMock(return_value=("session/path/", 2026))),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_mock),
            patch.object(dashboard_app, "flatten_position_z", new=lambda records, session_key=None: records),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            return await client.get(f"/api/track_replay?{query}")

    async def test_explicit_window_serves_whole_field_without_laps(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-23T14:00:00+00:00", 1, x=-3650, y=1193),
            location_sample("2026-05-23T14:01:30+00:00", 44, x=500, y=-750),
            location_sample("2026-05-23T14:02:01+00:00", 1),  # after end
        ])
        response = await self.request(fetch_mock)

        self.assertEqual(response.status_code, 200)
        fetch_mock.assert_awaited_once_with("session/path/", "Position.z", stream=True, meta={})

        data = await response.get_json()
        self.assertIsNone(data["driver_number"])
        self.assertIsNone(data["lap_number"])
        self.assertIsNone(data["lap_duration"])
        self.assertEqual(data["window_seconds"], 120.0)
        drivers = {d["driver_number"]: d["samples"] for d in data["drivers"]}
        self.assertEqual(set(drivers), {1, 44})
        self.assertEqual(drivers[1], [[0.0, -3650, 1193]])
        self.assertEqual(drivers[44], [[90.0, 500, -750]])

    async def test_window_payload_is_cached_under_window_scope(self):
        fetch_mock = AsyncMock(return_value=[
            location_sample("2026-05-23T14:00:10+00:00", 1),
        ])
        first = await self.request(fetch_mock)
        self.assertEqual(first.status_code, 200)

        start_ms = int(datetime(2026, 5, 23, 14, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
        end_ms = int(datetime(2026, 5, 23, 14, 2, 0, tzinfo=timezone.utc).timestamp() * 1000)
        cache_file = self.cache_dir / f"track_replay_v2_4242_window_{start_ms}_{end_ms}.json"
        self.assertTrue(cache_file.exists())

        second = await self.request(fetch_mock)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(fetch_mock.await_count, 1)
        self.assertEqual(await first.get_json(), await second.get_json())

    async def test_invalid_windows_are_rejected(self):
        fetch_mock = AsyncMock(side_effect=AssertionError("upstream should not be called"))
        for query in (
            # missing end
            "session_key=4242&start=2026-05-23T14:00:00Z",
            # non-ISO start
            "session_key=4242&start=nonsense&end=2026-05-23T14:02:00Z",
            # end not after start
            "session_key=4242&start=2026-05-23T14:02:00Z&end=2026-05-23T14:02:00Z",
            # window longer than REPLAY_WINDOW_MAX_SECONDS
            "session_key=4242&start=2026-05-23T14:00:00Z&end=2026-05-23T15:00:00Z",
        ):
            response = await self.request(fetch_mock, query=query)
            self.assertEqual(response.status_code, 400, f"query {query!r} was accepted")

    async def test_window_with_driver_number_still_requires_lap_number(self):
        # start/end only replace the lap window in driver-less mode
        fetch_mock = AsyncMock(side_effect=AssertionError("upstream should not be called"))
        response = await self.request(
            fetch_mock,
            query=f"{self.WINDOW_QUERY}&driver_number=1",
        )
        self.assertEqual(response.status_code, 400)


class TrackReplayStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_index_contains_replay_card(self):
        self.assertIn('id="replayCard"', self.index_html)
        self.assertIn('id="replayDriverSelect"', self.index_html)
        self.assertIn('id="replayTimeline"', self.index_html)
        self.assertIn('id="replayPlayBtn"', self.index_html)
        self.assertIn('id="replayScrubber"', self.index_html)
        self.assertIn('id="replaySpeedToggle"', self.index_html)
        self.assertIn('id="replayMapContent"', self.index_html)
        self.assertIn("/static/js/10-track-replay.js", self.index_html)

    def test_dashboard_js_wires_replay(self):
        self.assertIn("replayDriverSelect: document.getElementById('replayDriverSelect')", self.dashboard_js)
        self.assertIn("replayTimeline: document.getElementById('replayTimeline')", self.dashboard_js)
        self.assertIn("replayMapContent: document.getElementById('replayMapContent')", self.dashboard_js)
        self.assertIn("function setupReplaySection", self.dashboard_js)
        self.assertIn("function maybeAutoLoadReplay", self.dashboard_js)
        self.assertIn("function loadTrackReplay", self.dashboard_js)
        self.assertIn("/api/track_replay", self.dashboard_js)
        self.assertIn("replayCache", self.dashboard_js)
        self.assertIn("requestAnimationFrame", self.dashboard_js)

    def test_styles_contain_replay_classes(self):
        for css_class in (
            ".replay-card",
            ".replay-controls",
            ".replay-play-btn",
            ".replay-scrubber",
            ".replay-speed-toggle",
            ".replay-track-path",
            ".replay-car-dot",
            ".replay-car-label",
        ):
            self.assertIn(css_class, self.styles_css)


if __name__ == "__main__":
    unittest.main()
