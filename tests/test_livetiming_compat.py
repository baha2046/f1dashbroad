import unittest
from pathlib import Path

from livetiming_compat import (
    align_stints_with_lap_runs,
    flatten_car_data_z,
    flatten_position_z,
    normalize_livetiming_drivers,
    normalize_livetiming_intervals,
    normalize_livetiming_laps,
    normalize_livetiming_pit,
    normalize_livetiming_position,
    normalize_livetiming_race_control,
    normalize_livetiming_results,
    normalize_livetiming_session_status,
    normalize_livetiming_sessions,
    normalize_livetiming_stints,
    normalize_livetiming_team_radio,
    normalize_livetiming_weather,
)


class LivetimingCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]

    def test_normalize_sessions_keeps_existing_frontend_fields(self):
        payload = {
            "Meetings": [{
                "Key": 1289,
                "Name": "British Grand Prix",
                "Location": "Silverstone",
                "Country": {"Code": "GBR", "Name": "Great Britain"},
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

        sessions = normalize_livetiming_sessions(payload, 2026)

        self.assertEqual(sessions[0]["session_key"], 11326)
        self.assertEqual(sessions[0]["meeting_key"], 1289)
        self.assertEqual(sessions[0]["location"], "Silverstone")
        self.assertEqual(sessions[0]["session_name"], "Race")
        # StartDate/EndDate are local wall-clock; date_start must be UTC
        self.assertEqual(sessions[0]["date_start"], "2026-07-05T14:00:00Z")
        self.assertEqual(sessions[0]["date_end"], "2026-07-05T16:00:00Z")
        self.assertEqual(sessions[0]["gmt_offset"], "01:00:00")
        self.assertEqual(sessions[0]["circuit_short_name"], "Silverstone")

    def test_normalize_driver_list_maps_openf1_driver_fields(self):
        drivers = normalize_livetiming_drivers({
            "44": {
                "RacingNumber": "44",
                "BroadcastName": "L HAMILTON",
                "FullName": "Lewis HAMILTON",
                "Tla": "HAM",
                "TeamName": "Ferrari",
                "TeamColour": "E80020",
                "HeadshotUrl": "https://example.test/ham.png",
            }
        })

        self.assertEqual(drivers[0]["driver_number"], 44)
        self.assertEqual(drivers[0]["name_acronym"], "HAM")
        self.assertEqual(drivers[0]["team_name"], "Ferrari")
        self.assertEqual(drivers[0]["team_colour"], "E80020")

    def test_normalize_weather_stream_rows(self):
        rows = normalize_livetiming_weather([
            ("00:00:14.052", {
                "AirTemp": "21.0",
                "Humidity": "52.0",
                "Rainfall": "0",
                "TrackTemp": "42.1",
                "WindDirection": "217",
                "WindSpeed": "0.5",
            }),
        ], stream_start_utc="2024-07-28T12:00:00Z")

        self.assertEqual(rows[0]["date"], "2024-07-28T12:00:14.052000Z")
        self.assertEqual(rows[0]["air_temperature"], 21.0)
        self.assertEqual(rows[0]["track_temperature"], 42.1)
        self.assertEqual(rows[0]["humidity"], 52.0)
        self.assertEqual(rows[0]["rainfall"], 0.0)
        self.assertEqual(rows[0]["wind_direction"], 217)
        self.assertEqual(rows[0]["wind_speed"], 0.5)

    def test_normalize_race_control_messages(self):
        rows = normalize_livetiming_race_control([
            ("00:11:22.797", {
                "Messages": [{
                    "Utc": "2024-07-28T12:20:01",
                    "Lap": 1,
                    "Category": "Flag",
                    "Flag": "GREEN",
                    "Scope": "Track",
                    "Message": "GREEN LIGHT - PIT EXIT OPEN",
                }]
            })
        ])

        self.assertEqual(rows[0]["date"], "2024-07-28T12:20:01Z")
        self.assertEqual(rows[0]["lap_number"], 1)
        self.assertEqual(rows[0]["category"], "Flag")
        self.assertEqual(rows[0]["flag"], "GREEN")
        self.assertEqual(rows[0]["scope"], "Track")
        self.assertEqual(rows[0]["message"], "GREEN LIGHT - PIT EXIT OPEN")

    def test_normalize_team_radio_joins_recording_url(self):
        rows = normalize_livetiming_team_radio([
            ("00:00:29.542", {
                "Captures": [{
                    "Utc": "2024-07-28T12:09:11.2Z",
                    "RacingNumber": "55",
                    "Path": "TeamRadio/CARSAI01.mp3",
                }]
            })
        ], "2024/2024-07-28_Belgian_Grand_Prix/2024-07-28_Race/")

        self.assertEqual(rows[0]["date"], "2024-07-28T12:09:11.200000Z")
        self.assertEqual(rows[0]["driver_number"], 55)
        self.assertEqual(
            rows[0]["recording_url"],
            "https://livetiming.formula1.com/static/2024/2024-07-28_Belgian_Grand_Prix/2024-07-28_Race/TeamRadio/CARSAI01.mp3",
        )

    def test_normalize_position_and_intervals_from_timing_data(self):
        records = [("00:01:10.591", {
            "Lines": {
                "44": {
                    "Position": "1",
                    "GapToLeader": "",
                    "IntervalToPositionAhead": {"Value": ""},
                },
                "16": {
                    "Position": "2",
                    "GapToLeader": "+1.234",
                    "IntervalToPositionAhead": {"Value": "+1.234"},
                },
                "4": {
                    "Position": "3",
                    "GapToLeader": "1 LAP",
                    "IntervalToPositionAhead": {"Value": "+12.0"},
                },
            }
        })]

        position = normalize_livetiming_position(records, session_key=9574, stream_start_utc="2024-07-28T12:00:00Z")
        intervals = normalize_livetiming_intervals(records, session_key=9574, stream_start_utc="2024-07-28T12:00:00Z")

        self.assertEqual(position[0], {
            "session_key": 9574,
            "driver_number": 44,
            "position": 1,
            "date": "2024-07-28T12:01:10.591000Z",
        })
        self.assertEqual(intervals[0]["gap_to_leader"], None)
        self.assertEqual(intervals[1]["interval"], 1.234)
        self.assertEqual(intervals[1]["gap_to_leader"], 1.234)
        self.assertEqual(intervals[2]["gap_to_leader"], "1 LAP")

    def test_normalize_intervals_skips_position_only_deltas_and_carries_gaps_forward(self):
        # Latest-row-per-driver consumers must never see a position-only delta
        # null out a previously delivered gap
        records = [
            ("00:01:00.000", {"Lines": {"16": {
                "Position": "2",
                "GapToLeader": "+1.234",
                "IntervalToPositionAhead": {"Value": "+1.234"},
            }}}),
            ("00:01:05.000", {"Lines": {"16": {"Position": "3"}}}),
            ("00:01:10.000", {"Lines": {"16": {"GapToLeader": "+2.5"}}}),
        ]

        intervals = normalize_livetiming_intervals(records, session_key=9574, stream_start_utc="2024-07-28T12:00:00Z")

        # The position-only delta emits no row; the gap-only delta carries the
        # last known interval forward
        self.assertEqual(len(intervals), 2)
        self.assertEqual(intervals[0]["gap_to_leader"], 1.234)
        self.assertEqual(intervals[1]["date"], "2024-07-28T12:01:10Z")
        self.assertEqual(intervals[1]["gap_to_leader"], 2.5)
        self.assertEqual(intervals[1]["interval"], 1.234)

    def test_normalizers_survive_deletion_markers_and_malformed_entries(self):
        # Stream deltas can carry "_deleted" keys and non-dict items anywhere;
        # no normalizer may 500 on them (review 2026-07-07, section 2.2)
        timing_records = [("00:01:00.000", {"Lines": {
            "_deleted": ["4"],
            "16": {"Position": "2", "GapToLeader": "+1.0", "IntervalToPositionAhead": {"Value": "+1.0"}},
            "99": "retired",
        }})]
        self.assertEqual(
            [row["driver_number"] for row in normalize_livetiming_position(timing_records)], [16]
        )
        self.assertEqual(
            [row["driver_number"] for row in normalize_livetiming_intervals(timing_records)], [16]
        )

        race_control = normalize_livetiming_race_control(
            [(None, {"Messages": {"_deleted": ["1"], "2": {"Message": "ok"}, "3": "junk"}})]
        )
        self.assertEqual([row["message"] for row in race_control], ["ok"])

        team_radio = normalize_livetiming_team_radio(
            [(None, {"Captures": ["junk", {"Utc": "2024-07-28T12:00:00Z", "RacingNumber": "55", "Path": "x.mp3"}]})],
            "2024/race/",
        )
        self.assertEqual([row["driver_number"] for row in team_radio], [55])

        drivers = normalize_livetiming_drivers({
            "_kf": True,
            "44": {"RacingNumber": "44", "FullName": "LEWIS HAMILTON", "Tla": "HAM"},
        })
        self.assertEqual([row["driver_number"] for row in drivers], [44])

        weather = normalize_livetiming_weather([("00:01:00.000", "corrupt"), ("00:02:00.000", {"AirTemp": "20"})])
        self.assertEqual(len(weather), 1)

        stints = normalize_livetiming_stints([(None, {"Stints": {
            "_deleted": [], "44": [{"Compound": "SOFT", "TotalLaps": 5, "StartLaps": 0}],
        }})])
        self.assertEqual([row["driver_number"] for row in stints], [44])

    def test_normalize_stints_maps_lap_ranges(self):
        rows = normalize_livetiming_stints([
            (None, {
                "Stints": {
                    "44": [
                        {
                            "Compound": "MEDIUM",
                            "New": "true",
                            "TotalLaps": 18,
                            "StartLaps": 0,
                        },
                        {
                            "Compound": "HARD",
                            "New": "true",
                            "TotalLaps": 20,
                            "StartLaps": 0,
                        },
                        {
                            "Compound": "SOFT",
                            "New": "false",
                            "TotalLaps": 7,
                            "StartLaps": 3,
                        },
                    ]
                }
            })
        ], session_key=9574)

        self.assertEqual(rows[0]["session_key"], 9574)
        self.assertEqual(rows[0]["driver_number"], 44)
        self.assertEqual(rows[0]["stint_number"], 1)
        self.assertEqual(rows[0]["lap_start"], 1)
        self.assertEqual(rows[0]["lap_end"], 18)
        self.assertEqual(rows[0]["compound"], "MEDIUM")
        self.assertEqual(rows[0]["tyre_age_at_start"], 0)
        self.assertEqual(rows[1]["lap_start"], 19)
        self.assertEqual(rows[1]["lap_end"], 38)
        self.assertEqual(rows[2]["lap_start"], 39)
        self.assertEqual(rows[2]["lap_end"], 42)
        self.assertEqual(rows[2]["tyre_age_at_start"], 3)
        self.assertFalse(rows[2]["new"])

    def test_normalize_race_results_from_timing_data_keyframe(self):
        rows = normalize_livetiming_results([
            (None, {
                "Lines": {
                    "16": {
                        "Line": 1,
                        "Position": "1",
                        "RacingNumber": "16",
                        "GapToLeader": "",
                        "NumberOfLaps": 52,
                        "Retired": False,
                        "Stopped": False,
                    },
                    "44": {
                        "Line": 3,
                        "Position": "3",
                        "RacingNumber": "44",
                        "GapToLeader": "+0.772",
                        "NumberOfLaps": 52,
                        "Retired": False,
                        "Stopped": False,
                    },
                    "81": {
                        "Line": 11,
                        "Position": "11",
                        "RacingNumber": "81",
                        "GapToLeader": "+4.014",
                        "NumberOfLaps": 52,
                        "Retired": False,
                        "Stopped": False,
                    },
                }
            })
        ], session_key=11326)

        self.assertEqual([row["driver_number"] for row in rows], [16, 44, 81])
        self.assertEqual(rows[0]["position"], 1)
        self.assertIsNone(rows[0]["gap_to_leader"])
        self.assertEqual(rows[1]["gap_to_leader"], 0.772)
        self.assertEqual(rows[2]["number_of_laps"], 52)

    def test_normalize_qualifying_results_from_timing_data_keyframe(self):
        rows = normalize_livetiming_results([
            (None, {
                "Lines": {
                    "44": {
                        "Position": "3",
                        "RacingNumber": "44",
                        "NumberOfLaps": 17,
                        "BestLapTimes": [
                            {"Value": "1:29.644", "Lap": 2},
                            {"Value": "1:28.864", "Lap": 7},
                            {"Value": "1:28.458", "Lap": 16},
                        ],
                        "Stats": [
                            {"TimeDiffToFastest": "+0.368", "TimeDifftoPositionAhead": "+0.095"},
                            {"TimeDiffToFastest": "+0.371", "TimeDifftoPositionAhead": "+0.238"},
                            {"TimeDiffToFastest": "+0.347", "TimeDifftoPositionAhead": "+0.172"},
                        ],
                    },
                    "12": {
                        "Position": "1",
                        "RacingNumber": "12",
                        "NumberOfLaps": 19,
                        "BestLapTimes": [
                            {"Value": "1:29.719", "Lap": 2},
                            {"Value": "1:28.493", "Lap": 12},
                            {"Value": "1:28.111", "Lap": 18},
                        ],
                        "Stats": [
                            {"TimeDiffToFastest": "+0.443", "TimeDifftoPositionAhead": "+0.058"},
                            {"TimeDiffToFastest": "", "TimeDifftoPositionAhead": ""},
                            {"TimeDiffToFastest": "", "TimeDifftoPositionAhead": ""},
                        ],
                    },
                }
            })
        ], session_key=11325)

        winner = rows[0]
        hamilton = rows[1]
        self.assertEqual(winner["driver_number"], 12)
        self.assertEqual(winner["duration"], [89.719, 88.493, 88.111])
        self.assertEqual(winner["gap_to_leader"], [0.443, None, None])
        self.assertEqual(hamilton["driver_number"], 44)
        self.assertEqual(hamilton["duration"], [89.644, 88.864, 88.458])
        self.assertEqual(hamilton["gap_to_leader"], [0.368, 0.371, 0.347])

    def test_normalize_session_status_from_keyframe(self):
        rows = normalize_livetiming_session_status([
            (None, {
                "Series": [{"Utc": "2026-07-05T13:08:20.736Z", "Lap": 1}],
                "StatusSeries": [
                    {"Utc": "2026-07-05T13:04:43.267Z", "TrackStatus": "Yellow"},
                    {"Utc": "2026-07-05T13:15:27.484Z", "TrackStatus": "AllClear"},
                    {"Utc": "2026-07-05T14:03:54.054Z", "SessionStatus": "Started"},
                    {"Utc": "2026-07-05T15:31:05.617Z", "SessionStatus": "Finished"},
                ],
            })
        ], session_key=11326)

        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0], {
            "session_key": 11326,
            "date": "2026-07-05T13:04:43.267000Z",
            "track_status": "Yellow",
            "session_status": None,
        })
        self.assertEqual(rows[2]["session_status"], "Started")
        self.assertEqual(rows[3]["session_status"], "Finished")

    def test_normalize_session_status_from_stream_deltas(self):
        # Stream deltas address StatusSeries entries as index-keyed dicts
        rows = normalize_livetiming_session_status([
            ("00:00:00.000", {"Series": [], "StatusSeries": [
                {"Utc": "2026-07-05T13:04:43.267Z", "TrackStatus": "Yellow"},
            ]}),
            ("00:07:12.992", {"StatusSeries": {"1": {"Utc": "2026-07-05T13:15:27.484Z", "TrackStatus": "AllClear"}}}),
            ("00:55:39.562", {"Series": {"0": {"Utc": "2026-07-05T14:05:30.564Z", "Lap": 2}}}),
        ], session_key=11326)

        self.assertEqual([(row["date"], row["track_status"]) for row in rows], [
            ("2026-07-05T13:04:43.267000Z", "Yellow"),
            ("2026-07-05T13:15:27.484000Z", "AllClear"),
        ])

    def test_normalize_pit_lane_times(self):
        rows = normalize_livetiming_pit([
            ("01:08:46.647", {
                "PitTimes": {
                    "27": {
                        "RacingNumber": "27",
                        "Duration": "23.5",
                        "Lap": "7",
                    }
                }
            })
        ], session_key=9574, stream_start_utc="2024-07-28T12:00:00Z")

        self.assertEqual(rows[0]["session_key"], 9574)
        self.assertEqual(rows[0]["driver_number"], 27)
        self.assertEqual(rows[0]["lap_number"], 7)
        self.assertEqual(rows[0]["pit_duration"], 23.5)
        self.assertEqual(rows[0]["date"], "2024-07-28T13:08:46.647000Z")

    def test_normalize_laps_reconstructs_completed_timing_lap(self):
        rows = normalize_livetiming_laps([
            ("00:01:30.000", {
                "Lines": {
                    "44": {
                        "Position": "1",
                        "NumberOfLaps": 1,
                    }
                }
            }),
            ("00:03:20.240", {
                "Lines": {
                    "44": {
                        "Position": "1",
                        "NumberOfLaps": 2,
                        "LastLapTime": {"Value": "1:50.240"},
                        "Sectors": [
                            {"Value": "31.831"},
                            {"Value": "48.675"},
                            {"Value": "29.734"},
                        ],
                        "Speeds": {
                            "I1": {"Value": "303"},
                            "I2": {"Value": "203"},
                            "ST": {"Value": "304"},
                        },
                    }
                }
            }),
        ], session_key=9574, stream_start_utc="2024-07-28T13:02:25.045Z")

        self.assertEqual([row["lap_number"] for row in rows], [1, 2])
        self.assertEqual(rows[1], {
            "session_key": 9574,
            "driver_number": 44,
            "lap_number": 2,
            "date_start": "2024-07-28T13:03:55.045000Z",
            "lap_duration": 110.24,
            "duration_sector_1": 31.831,
            "duration_sector_2": 48.675,
            "duration_sector_3": 29.734,
            "i1_speed": 303,
            "i2_speed": 203,
            "st_speed": 304,
            "position": 1,
            "is_pit_out_lap": False,
        })

    def test_normalize_laps_accumulates_partial_timing_deltas(self):
        # Real TimingData is a partial-update stream: sector 1/2 times, speeds
        # and position land in separate records before the lap-completion
        # record, and lap 1 carries no LastLapTime at all.
        rows = normalize_livetiming_laps([
            ("00:55:39.562", {"Lines": {"1": {"Position": "2"}}}),
            ("00:57:20.486", {"Lines": {"1": {
                "NumberOfLaps": 1,
                "Sectors": {"2": {"Value": "26.468"}},
            }}}),
            ("00:57:55.000", {"Lines": {"1": {
                "Sectors": {"0": {"Value": "31.831"}},
                "Speeds": {"I1": {"Value": "303"}},
            }}}),
            ("00:58:29.000", {"Lines": {"1": {
                "Sectors": {"1": {"Value": "42.457"}},
                "Speeds": {"I2": {"Value": "203"}, "ST": {"Value": "304"}},
            }}}),
            ("00:58:55.222", {"Lines": {"1": {
                "NumberOfLaps": 2,
                "Sectors": {"2": {"Value": "25.948"}},
                "LastLapTime": {"Value": "1:34.736"},
            }}}),
        ], session_key=11326,
           stream_start_utc="2026-07-05T13:08:16.000Z",
           race_start_utc="2026-07-05T14:03:55.562Z")

        self.assertEqual([row["lap_number"] for row in rows], [1, 2])

        lap1 = rows[0]
        # Lap 1 starts at the green light and its duration falls back to the
        # green-light-to-crossing wall clock.
        self.assertEqual(lap1["date_start"], "2026-07-05T14:03:55.562000Z")
        self.assertEqual(lap1["lap_duration"], 100.924)
        self.assertEqual(lap1["duration_sector_3"], 26.468)
        self.assertEqual(lap1["position"], 2)

        lap2 = rows[1]
        # Lap 2 starts at the lap 1 line crossing and picks up the sector and
        # speed values that arrived in earlier partial updates.
        self.assertEqual(lap2["date_start"], "2026-07-05T14:05:36.486000Z")
        self.assertEqual(lap2["lap_duration"], 94.736)
        self.assertEqual(lap2["duration_sector_1"], 31.831)
        self.assertEqual(lap2["duration_sector_2"], 42.457)
        self.assertEqual(lap2["duration_sector_3"], 25.948)
        self.assertEqual(lap2["i1_speed"], 303)
        self.assertEqual(lap2["i2_speed"], 203)
        self.assertEqual(lap2["st_speed"], 304)

    def test_normalize_laps_marks_pit_out_lap(self):
        rows = normalize_livetiming_laps([
            ("01:00:00.000", {"Lines": {"1": {"NumberOfLaps": 10, "LastLapTime": {"Value": "1:35.000"}}}}),
            ("01:00:40.000", {"Lines": {"1": {"InPit": True}}}),
            ("01:01:05.000", {"Lines": {"1": {"InPit": False, "PitOut": True}}}),
            ("01:01:45.000", {"Lines": {"1": {"NumberOfLaps": 11, "LastLapTime": {"Value": "1:45.000"}}}}),
            ("01:03:20.000", {"Lines": {"1": {"NumberOfLaps": 12, "LastLapTime": {"Value": "1:35.000"}}}}),
        ], session_key=11326, stream_start_utc="2026-07-05T13:00:00Z")

        by_lap = {row["lap_number"]: row for row in rows}
        self.assertTrue(by_lap[11]["is_pit_out_lap"])
        self.assertFalse(by_lap[12]["is_pit_out_lap"])
        # Contiguous laps chain their start to the previous crossing
        self.assertEqual(by_lap[12]["date_start"], "2026-07-05T14:01:45Z")

    def test_normalize_laps_pit_out_with_crossing_flags_the_lap_starting_there(self):
        # Qualifying garage exits bump NumberOfLaps in the same record as the
        # PitOut delta: the lap completed by that record is the in-lap (plus
        # garage time), and the lap *starting* at the pit exit is the out-lap.
        rows = normalize_livetiming_laps([
            ("01:00:00.000", {"Lines": {"12": {"NumberOfLaps": 3, "LastLapTime": {"Value": "1:29.000"}}}}),
            ("01:00:40.000", {"Lines": {"12": {"InPit": True}}}),
            ("01:04:00.000", {"Lines": {"12": {"InPit": False, "PitOut": True, "NumberOfLaps": 4}}}),
            ("01:05:40.000", {"Lines": {"12": {"NumberOfLaps": 5, "LastLapTime": {"Value": "1:40.000"}}}}),
            ("01:07:10.000", {"Lines": {"12": {"NumberOfLaps": 6, "LastLapTime": {"Value": "1:29.500"}}}}),
        ], session_key=11322, stream_start_utc="2026-07-04T14:00:00Z")

        by_lap = {row["lap_number"]: row for row in rows}
        # The in-lap that ends at the pit exit is not the out-lap
        self.assertFalse(by_lap[4]["is_pit_out_lap"])
        self.assertTrue(by_lap[5]["is_pit_out_lap"])
        self.assertFalse(by_lap[6]["is_pit_out_lap"])
        # The in-lap window covers crossing-to-pit-exit including garage time
        self.assertEqual(by_lap[4]["lap_duration"], 240.0)
        self.assertEqual(by_lap[5]["date_start"], "2026-07-04T15:04:00Z")

    def test_normalize_laps_out_lap_duration_prefers_wall_clock_over_garage_time(self):
        # After a garage stay the upstream LastLapTime measures from pit entry,
        # overshooting the lap's real pit-exit-to-crossing span; the wall clock
        # wins so lap windows never overlap the next lap.
        rows = normalize_livetiming_laps([
            ("01:04:00.000", {"Lines": {"12": {"PitOut": True, "NumberOfLaps": 4}}}),
            ("01:05:40.190", {"Lines": {"12": {"NumberOfLaps": 5, "LastLapTime": {"Value": "4:26.533"}}}}),
            ("01:07:10.190", {"Lines": {"12": {"NumberOfLaps": 6, "LastLapTime": {"Value": "1:30.000"}}}}),
        ], session_key=11322, stream_start_utc="2026-07-04T14:00:00Z")

        by_lap = {row["lap_number"]: row for row in rows}
        self.assertEqual(by_lap[5]["lap_duration"], 100.19)
        # An honest LastLapTime within tolerance of the wall clock is kept
        self.assertEqual(by_lap[6]["lap_duration"], 90.0)

    def test_align_stints_with_lap_runs_uses_pit_out_boundaries(self):
        stints = [
            {"driver_number": 12, "stint_number": 1, "lap_start": 1, "lap_end": 3, "compound": "SOFT"},
            {"driver_number": 12, "stint_number": 2, "lap_start": 4, "lap_end": 6, "compound": "SOFT"},
            # Run/stint count mismatch: keeps the accumulated range
            {"driver_number": 44, "stint_number": 1, "lap_start": 1, "lap_end": 5, "compound": "MEDIUM"},
        ]
        laps = [
            # Lap 1 is the counter-initialization phantom (no date_start); the
            # pit-out flag on lap 2 must not split it into its own run
            {"driver_number": 12, "lap_number": 1},
            {"driver_number": 12, "lap_number": 2, "date_start": "2026-07-04T15:04:35Z", "is_pit_out_lap": True},
            {"driver_number": 12, "lap_number": 3, "date_start": "2026-07-04T15:06:31Z"},
            {"driver_number": 12, "lap_number": 4, "date_start": "2026-07-04T15:08:00Z"},
            {"driver_number": 12, "lap_number": 5, "date_start": "2026-07-04T15:12:41Z", "is_pit_out_lap": True},
            {"driver_number": 12, "lap_number": 6, "date_start": "2026-07-04T15:14:21Z"},
            {"driver_number": 12, "lap_number": 7, "date_start": "2026-07-04T15:15:52Z"},
            {"driver_number": 44, "lap_number": 1, "date_start": "2026-07-04T15:04:00Z"},
            {"driver_number": 44, "lap_number": 2, "date_start": "2026-07-04T15:06:00Z", "is_pit_out_lap": True},
            {"driver_number": 44, "lap_number": 3, "date_start": "2026-07-04T15:08:00Z", "is_pit_out_lap": True},
        ]

        aligned = align_stints_with_lap_runs(stints, laps)

        by_key = {(row["driver_number"], row["stint_number"]): row for row in aligned}
        self.assertEqual(by_key[(12, 1)]["lap_start"], 1)
        self.assertEqual(by_key[(12, 1)]["lap_end"], 4)
        self.assertEqual(by_key[(12, 2)]["lap_start"], 5)
        self.assertEqual(by_key[(12, 2)]["lap_end"], 7)
        self.assertEqual(by_key[(12, 2)]["compound"], "SOFT")
        self.assertEqual(by_key[(44, 1)]["lap_start"], 1)
        self.assertEqual(by_key[(44, 1)]["lap_end"], 5)
        # Inputs are not mutated
        self.assertEqual(stints[0]["lap_end"], 3)

    def test_align_stints_with_lap_runs_handles_missing_or_invalid_inputs(self):
        stints = [{"driver_number": 12, "stint_number": 1, "lap_start": 1, "lap_end": 3}]
        self.assertEqual(align_stints_with_lap_runs(stints, None), stints)
        self.assertEqual(align_stints_with_lap_runs(stints, []), stints)
        self.assertEqual(align_stints_with_lap_runs(None, [{"driver_number": 12, "lap_number": 1}]), [])

    def test_flatten_car_data_z_decodes_channel_rows(self):
        payload = (self.root / "tests" / "fixtures" / "livetiming" / "car_data_z_stream_sample.json").read_text(encoding="utf-8")

        rows = list(flatten_car_data_z([("00:02:29.866", payload)], session_key=9574))

        row = next(item for item in rows if item["driver_number"] == 44)
        self.assertEqual(row["session_key"], 9574)
        self.assertEqual(row["date"], "2024-07-28T12:11:07.0432965Z")
        self.assertEqual(row["rpm"], 0)
        self.assertEqual(row["speed"], 0)
        self.assertEqual(row["n_gear"], 0)
        self.assertEqual(row["throttle"], 0)
        self.assertEqual(row["brake"], 0)
        self.assertEqual(row["drs"], 0)

    def test_flatten_position_z_decodes_coordinate_rows(self):
        payload = (self.root / "tests" / "fixtures" / "livetiming" / "position_z_stream_sample.json").read_text(encoding="utf-8")

        rows = list(flatten_position_z([("00:01:45.570", payload)], session_key=9574))

        row = next(item for item in rows if item["driver_number"] == 44)
        self.assertEqual(row["session_key"], 9574)
        self.assertEqual(row["date"], "2024-07-28T12:10:22.7877313Z")
        self.assertEqual(row["x"], 0)
        self.assertEqual(row["y"], 0)
        self.assertEqual(row["z"], 0)


if __name__ == "__main__":
    unittest.main()
