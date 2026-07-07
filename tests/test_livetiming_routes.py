import base64
import json
import shutil
import unittest
import zlib
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


def year_index_fixture():
    return {
        "Meetings": [{
            "Key": 1289,
            "Name": "British Grand Prix",
            "OfficialName": "FORMULA 1 QATAR AIRWAYS BRITISH GRAND PRIX 2026",
            "Location": "Silverstone",
            "Country": {"Key": 2, "Code": "GBR", "Name": "Great Britain"},
            "Circuit": {"Key": 2, "ShortName": "Silverstone"},
            "Sessions": [{
                "Key": 11326,
                "Type": "Race",
                "Name": "Race",
                "StartDate": "2026-07-05T15:00:00",
                "EndDate": "2026-07-05T17:00:00",
                "GmtOffset": "01:00:00",
                "Path": "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/",
            }],
        }],
    }


def compressed_z_payload(payload):
    raw = json.dumps(payload).encode("utf-8")
    compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    compressed = compressor.compress(raw) + compressor.flush()
    return base64.b64encode(compressed).decode("ascii")


def make_feed_mock(feeds):
    """AsyncMock for fetch_livetiming_feed that dispatches by feed name.

    Routes also fetch auxiliary feeds (Heartbeat for the UTC stream anchor,
    SessionStatus for race start); feeds not provided raise like a missing
    upstream file so the route falls back gracefully.
    """
    async def dispatch(session_path, feed_name, stream=True, meta=None):
        if feed_name in feeds:
            return feeds[feed_name]
        raise dashboard_app.UpstreamAPIError(f"{feed_name} unavailable in test")

    return AsyncMock(side_effect=dispatch)


class LivetimingCoreRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)
        dashboard_app._stream_start_cache.clear()

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def seed_session_cache(self):
        sessions = [{
            "session_key": 11326,
            "meeting_key": 1289,
            "year": 2026,
            "path": "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/",
            "date_start": "2026-07-05T15:00:00Z",
            "date_end": "2026-07-05T17:00:00Z",
            "session_name": "Race",
            "session_type": "Race",
            "is_cancelled": False,
        }]
        (self.cache_dir / "sessions_2026.json").write_text(json.dumps(sessions), encoding="utf-8")

    def seed_driver_lap_cache(self):
        laps = [{
            "session_key": 11326,
            "driver_number": 44,
            "lap_number": 1,
            "date_start": "2026-07-05T15:00:00Z",
            "lap_duration": 2.0,
        }]
        (self.cache_dir / "laps_11326_44.json").write_text(json.dumps(laps), encoding="utf-8")
        (self.cache_dir / "laps_11326.json").write_text(json.dumps(laps), encoding="utf-8")

    async def test_sessions_endpoint_uses_livetiming_year_index_without_key(self):
        fetch_year = AsyncMock(return_value=year_index_fixture())

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_year_index", new=fetch_year, create=True),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/sessions?year=2026")

        self.assertEqual(response.status_code, 200)
        sessions = await response.get_json()
        self.assertEqual(sessions[0]["session_key"], 11326)
        self.assertEqual(sessions[0]["meeting_key"], 1289)
        self.assertEqual(sessions[0]["path"], "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/")
        fetch_year.assert_awaited_once_with(2026)
        cache_file = self.cache_dir / "sessions_2026.json"
        self.assertEqual(json.loads(cache_file.read_text(encoding="utf-8")), sessions)

    async def test_meetings_endpoint_returns_livetiming_meeting_shape(self):
        fetch_year = AsyncMock(return_value=year_index_fixture())
        circuit_info = {"x": [0, 1], "y": [0, 1], "corners": [], "rotation": 0}
        fetch_circuit = AsyncMock(return_value=circuit_info)

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "current_season_year", return_value=2026),
            patch.object(dashboard_app, "fetch_livetiming_year_index", new=fetch_year, create=True),
            patch.object(dashboard_app, "get_cached_circuit_info", new=fetch_circuit),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/meetings?meeting_key=1289&year=2026")

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        meeting = data["meeting"]
        self.assertEqual(meeting["meeting_key"], 1289)
        self.assertEqual(meeting["meeting_name"], "British Grand Prix")
        self.assertEqual(meeting["meeting_official_name"], "FORMULA 1 QATAR AIRWAYS BRITISH GRAND PRIX 2026")
        self.assertEqual(meeting["circuit_short_name"], "Silverstone")
        # Session dates are converted from local wall-clock to UTC
        self.assertEqual(meeting["date_start"], "2026-07-05T14:00:00Z")
        # Track layout comes from the MultiViewer circuit API keyed by the F1 circuit key
        self.assertEqual(data["circuit_info"], circuit_info)
        fetch_circuit.assert_awaited_once_with(
            "https://api.multiviewer.app/api/v1/circuits/2/2026",
            "circuit_info_2_2026.json",
        )

    async def test_drivers_endpoint_uses_livetiming_driver_list_feed(self):
        self.seed_session_cache()
        fetch_feed = AsyncMock(return_value={
            "44": {
                "RacingNumber": "44",
                "BroadcastName": "L HAMILTON",
                "FullName": "Lewis HAMILTON",
                "Tla": "HAM",
                "TeamName": "Ferrari",
                "TeamColour": "E80020",
            },
        })

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed, create=True),
            patch.object(dashboard_app, "get_f1api_drivers", new=AsyncMock(return_value=[])),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/drivers?session_key=11326&year=2026")

        self.assertEqual(response.status_code, 200)
        drivers = await response.get_json()
        self.assertEqual(drivers[0]["driver_number"], 44)
        self.assertEqual(drivers[0]["name_acronym"], "HAM")
        fetch_feed.assert_awaited_once_with("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "DriverList", stream=False)

    async def test_weather_endpoint_normalizes_livetiming_weather_feed(self):
        self.seed_session_cache()
        # No Heartbeat feed provided: the anchor falls back to the session start
        fetch_feed = make_feed_mock({"WeatherData": [
            ("00:00:14.052", {
                "AirTemp": "21.0",
                "Humidity": "52.0",
                "Rainfall": "0",
                "TrackTemp": "42.1",
                "WindDirection": "217",
                "WindSpeed": "0.5",
            })
        ]})

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/weather?session_key=11326")

        self.assertEqual(response.status_code, 200)
        weather = await response.get_json()
        self.assertEqual(weather[0]["date"], "2026-07-05T15:00:14.052000Z")
        self.assertEqual(weather[0]["air_temperature"], 21.0)
        fetch_feed.assert_any_await("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "WeatherData", stream=True, meta={})

    async def test_intervals_endpoint_normalizes_livetiming_timing_feed(self):
        self.seed_session_cache()
        fetch_feed = make_feed_mock({"TimingData": [
            ("00:01:10.591", {
                "Lines": {
                    "44": {"Position": "1", "GapToLeader": "", "IntervalToPositionAhead": {"Value": ""}},
                    "16": {"Position": "2", "GapToLeader": "+1.234", "IntervalToPositionAhead": {"Value": "+1.234"}},
                }
            })
        ]})

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/intervals?session_key=11326")

        self.assertEqual(response.status_code, 200)
        intervals = await response.get_json()
        self.assertEqual(intervals[0]["driver_number"], 44)
        self.assertEqual(intervals[0]["gap_to_leader"], None)
        self.assertEqual(intervals[1]["interval"], 1.234)
        fetch_feed.assert_any_await("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "TimingData", stream=True, meta={})

    async def test_team_radio_endpoint_normalizes_livetiming_team_radio_feed(self):
        self.seed_session_cache()
        fetch_feed = make_feed_mock({"TeamRadio": [
            ("00:00:29.542", {
                "Captures": [{
                    "Utc": "2026-07-05T15:09:11.2Z",
                    "RacingNumber": "55",
                    "Path": "TeamRadio/CARSAI01.mp3",
                }]
            })
        ]})

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/team_radio?session_key=11326")

        self.assertEqual(response.status_code, 200)
        clips = await response.get_json()
        self.assertEqual(clips[0]["driver_number"], 55)
        self.assertEqual(
            clips[0]["recording_url"],
            "https://livetiming.formula1.com/static/2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/TeamRadio/CARSAI01.mp3",
        )
        fetch_feed.assert_any_await("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "TeamRadio", stream=True, meta={})

    async def test_session_status_endpoint_normalizes_status_series(self):
        self.seed_session_cache()
        fetch_feed = make_feed_mock({"SessionData": [
            ("00:00:00.000", {"Series": [], "StatusSeries": [
                {"Utc": "2026-07-05T13:04:43.267Z", "TrackStatus": "Yellow"},
            ]}),
            ("00:14:06.000", {"StatusSeries": {"1": {"Utc": "2026-07-05T15:18:49.826Z", "TrackStatus": "SCDeployed"}}}),
            ("00:26:22.000", {"StatusSeries": {"2": {"Utc": "2026-07-05T15:31:05.617Z", "SessionStatus": "Finished"}}}),
        ]})

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/session_status?session_key=11326")

        self.assertEqual(response.status_code, 200)
        rows = await response.get_json()
        self.assertEqual([row["track_status"] for row in rows], ["Yellow", "SCDeployed", None])
        self.assertEqual(rows[1]["date"], "2026-07-05T15:18:49.826000Z")
        self.assertEqual(rows[2]["session_status"], "Finished")
        fetch_feed.assert_any_await("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "SessionData", stream=True, meta={})

    async def test_laps_endpoint_reconstructs_livetiming_laps_and_filters_driver(self):
        self.seed_session_cache()
        fetch_feed = make_feed_mock({
            # Heartbeat pins stream elapsed 00:00:00 to 14:00:00 UTC
            "Heartbeat": [("00:00:10.000", {"Utc": "2026-07-05T14:00:10Z"})],
            "SessionStatus": [("00:01:00.000", {"Status": "Started"})],
            "TimingData": [
                ("00:02:30.000", {
                    "Lines": {
                        "44": {"NumberOfLaps": 1, "Sectors": {"2": {"Value": "26.468"}}},
                    }
                }),
                ("00:04:20.240", {
                    "Lines": {
                        "44": {
                            "Position": "1",
                            "NumberOfLaps": 2,
                            "LastLapTime": {"Value": "1:50.240"},
                            "Sectors": {
                                "0": {"Value": "31.831"},
                                "1": {"Value": "48.675"},
                                "2": {"Value": "29.734"},
                            },
                        },
                        "16": {
                            "Position": "2",
                            "NumberOfLaps": 2,
                            "LastLapTime": {"Value": "1:51.000"},
                        },
                    }
                }),
            ],
        })

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/laps?session_key=11326&driver_number=44")

        self.assertEqual(response.status_code, 200)
        laps = await response.get_json()
        self.assertEqual([lap["lap_number"] for lap in laps], [1, 2])
        self.assertTrue(all(lap["driver_number"] == 44 for lap in laps))
        # Lap 1 starts at the SessionStatus green light anchored via Heartbeat
        self.assertEqual(laps[0]["date_start"], "2026-07-05T14:01:00Z")
        self.assertEqual(laps[0]["lap_duration"], 90.0)
        # Lap 2 starts at the lap 1 line crossing
        self.assertEqual(laps[1]["date_start"], "2026-07-05T14:02:30Z")
        self.assertEqual(laps[1]["lap_duration"], 110.24)
        self.assertEqual(laps[1]["duration_sector_1"], 31.831)
        fetch_feed.assert_any_await("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "TimingData", stream=True, meta={})
        fetch_feed.assert_any_await("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "Heartbeat", stream=True, meta={})

    async def test_car_telemetry_endpoint_decodes_livetiming_car_data(self):
        self.seed_session_cache()
        self.seed_driver_lap_cache()
        payload = compressed_z_payload({
            "Entries": [{
                "Utc": "2026-07-05T15:00:01Z",
                "Cars": {
                    "44": {"Channels": {"0": 12000, "2": 250, "3": 5, "4": 80, "5": 0, "45": 8}},
                    "16": {"Channels": {"0": 11000, "2": 240, "3": 4, "4": 70, "5": 0, "45": 0}},
                },
            }]
        })
        fetch_feed = AsyncMock(return_value=[("00:00:01.000", payload)])

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/car_telemetry?session_key=11326&driver_number=44&lap_number=1")

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        self.assertEqual(data["sample_count"], 1)
        self.assertEqual(data["telemetry"][0]["t"], 1.0)
        self.assertEqual(data["telemetry"][0]["speed"], 250)
        self.assertEqual(data["telemetry"][0]["gear"], 5)
        fetch_feed.assert_awaited_once_with("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "CarData.z", stream=True, meta={})

    async def test_track_replay_endpoint_decodes_livetiming_position_data(self):
        self.seed_session_cache()
        self.seed_driver_lap_cache()
        payload = compressed_z_payload({
            "Position": [{
                "Timestamp": "2026-07-05T15:00:01Z",
                "Entries": {
                    "44": {"Status": "OnTrack", "X": 10, "Y": 20, "Z": 0},
                    "16": {"Status": "OnTrack", "X": 30, "Y": 40, "Z": 0},
                },
            }]
        })
        fetch_feed = AsyncMock(return_value=[("00:00:01.000", payload)])

        with (
            patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)),
            patch.object(dashboard_app, "fetch_livetiming_feed", new=fetch_feed),
            patch.object(dashboard_app, "fetch_url", new=AsyncMock(side_effect=AssertionError("OpenF1 should not be called"))),
        ):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/track_replay?session_key=11326&driver_number=44&lap_number=1")

        self.assertEqual(response.status_code, 200)
        data = await response.get_json()
        drivers = {driver["driver_number"]: driver["samples"] for driver in data["drivers"]}
        self.assertEqual(drivers[44], [[1.0, 10, 20]])
        self.assertEqual(drivers[16], [[1.0, 30, 40]])
        fetch_feed.assert_awaited_once_with("2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/", "Position.z", stream=True, meta={})


if __name__ == "__main__":
    unittest.main()
