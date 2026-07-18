import json
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import livetiming_signalr as signalr

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "signalr"


SEP = signalr.RECORD_SEPARATOR


class SignalRCoreProtocolTests(unittest.TestCase):
    def test_negotiate_url_targets_signalrcore(self):
        url = urlparse(signalr.SIGNALRCORE_NEGOTIATE_URL)
        query = parse_qs(url.query)
        self.assertEqual(url.path, "/signalrcore/negotiate")
        self.assertEqual(query["negotiateVersion"], ["1"])

    def test_handshake_message_declares_json_protocol(self):
        message = signalr.build_core_handshake_message()
        self.assertTrue(message.endswith(SEP))
        self.assertEqual(json.loads(message[:-1]), {"protocol": "json", "version": 1})

    def test_subscribe_message_is_a_hub_invocation(self):
        message = signalr.build_core_subscribe_message(["TimingData"], invocation_id=7)
        self.assertTrue(message.endswith(SEP))
        self.assertEqual(json.loads(message[:-1]), {
            "type": 1, "invocationId": "7", "target": "Subscribe",
            "arguments": [["TimingData"]],
        })

    def test_connect_url_carries_token_and_optional_access_token(self):
        client = signalr.SignalRClient()
        url = urlparse(client.build_connect_url("abc+/=123"))
        self.assertEqual(url.scheme, "wss")
        self.assertEqual(parse_qs(url.query)["id"], ["abc+/=123"])
        authed = signalr.SignalRClient(access_token="tok/en")
        query = parse_qs(urlparse(authed.build_connect_url("abc")).query)
        self.assertEqual(query["access_token"], ["tok/en"])

    def test_default_feeds_cover_live_mode_consumers(self):
        for feed in ("TimingData", "SessionData", "RaceControlMessages", "Position.z", "CarData.z",
                     "Heartbeat", "DriverList", "TyreStintSeries"):
            self.assertIn(feed, signalr.DEFAULT_FEEDS)


class SignalRCoreFrameParserTests(unittest.TestCase):
    def test_subscribe_completion_is_a_snapshot(self):
        frame = json.dumps({
            "type": 3, "invocationId": "1",
            "result": {"TimingData": {"Lines": {"44": {"Position": "1"}}}},
        }) + SEP
        events = signalr.parse_core_frame(frame)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "snapshot")
        self.assertIn("TimingData", events[0]["feeds"])

    def test_feed_invocations_batch_into_one_updates_event(self):
        frame = (
            json.dumps({"type": 1, "target": "feed", "arguments": [
                "TimingData", {"Lines": {"44": {"NumberOfLaps": 3}}}, "2026-07-18T15:12:00.123Z",
            ]}) + SEP
            + json.dumps({"type": 1, "target": "feed", "arguments": [
                "WeatherData", {"AirTemp": "25.1"}, "2026-07-18T15:12:01Z",
            ]}) + SEP
        )
        events = signalr.parse_core_frame(frame)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "updates")
        feed, payload, utc = events[0]["updates"][0]
        self.assertEqual(feed, "TimingData")
        self.assertEqual(payload["Lines"]["44"]["NumberOfLaps"], 3)
        self.assertEqual(utc, "2026-07-18T15:12:00.123Z")
        self.assertEqual(events[0]["updates"][1][0], "WeatherData")

    def test_updates_without_utc_default_to_none(self):
        frame = json.dumps({"type": 1, "target": "feed",
                            "arguments": ["TrackStatus", {"Status": "1"}]}) + SEP
        events = signalr.parse_core_frame(frame)
        self.assertEqual(events[0]["updates"], [("TrackStatus", {"Status": "1"}, None)])

    def test_pings_and_handshake_ack_are_keepalives(self):
        frame = "{}" + SEP + json.dumps({"type": 6}) + SEP
        self.assertEqual(signalr.parse_core_frame(frame), [{"type": "keepalive"}])
        self.assertEqual(signalr.parse_core_frame(""), [{"type": "keepalive"}])

    def test_arrival_order_is_preserved_across_snapshot_and_updates(self):
        frame = (
            json.dumps({"type": 1, "target": "feed",
                        "arguments": ["WeatherData", {"AirTemp": "25.0"}, None]}) + SEP
            + json.dumps({"type": 3, "invocationId": "1", "result": {"Heartbeat": {"Utc": "x"}}}) + SEP
            + json.dumps({"type": 1, "target": "feed",
                          "arguments": ["WeatherData", {"AirTemp": "25.2"}, None]}) + SEP
        )
        kinds = [event["type"] for event in signalr.parse_core_frame(frame)]
        self.assertEqual(kinds, ["updates", "snapshot", "updates"])

    def test_foreign_completions_are_other_and_junk_raises(self):
        frame = json.dumps({"type": 3, "invocationId": "99", "result": {}}) + SEP
        self.assertEqual(signalr.parse_core_frame(frame)[0]["type"], "other")
        with self.assertRaises(ValueError):
            signalr.parse_core_frame("not json" + SEP)


class SignalRRecordConversionTests(unittest.TestCase):
    def test_update_becomes_static_stream_shaped_record(self):
        record = signalr.record_from_update(
            {"Lines": {"44": {"NumberOfLaps": 3}}},
            "2026-07-05T15:12:00.123Z",
            "2026-07-05T14:00:00Z",
        )
        self.assertEqual(record[0], "01:12:00.123")
        self.assertEqual(record[1]["Lines"]["44"]["NumberOfLaps"], 3)

    def test_unanchorable_updates_return_none(self):
        self.assertIsNone(signalr.record_from_update({}, "2026-07-05T15:00:00Z", None))
        self.assertIsNone(signalr.record_from_update({}, "garbage", "2026-07-05T14:00:00Z"))

    def test_records_interoperate_with_normalizers(self):
        from livetiming_compat import normalize_livetiming_weather
        record = signalr.record_from_update(
            {"AirTemp": "25.1", "Humidity": "40"},
            "2026-07-05T14:30:00Z",
            "2026-07-05T14:00:00Z",
        )
        rows = normalize_livetiming_weather([record], stream_start_utc="2026-07-05T14:00:00Z")
        self.assertEqual(rows[0]["air_temperature"], 25.1)
        self.assertEqual(rows[0]["date"], "2026-07-05T14:30:00Z")


class MergeLiveStateTests(unittest.TestCase):
    def test_nested_dicts_merge_and_scalars_replace(self):
        state = {"Lines": {"44": {"Position": "3", "InPit": True}}}
        merged = signalr.merge_live_state(state, {"Lines": {"44": {"Position": "2"}}})
        self.assertIs(merged, state)
        self.assertEqual(state["Lines"]["44"], {"Position": "2", "InPit": True})

    def test_index_keyed_patches_keep_lists_as_lists(self):
        state = {"BestLapTimes": [{"Value": "1:30.000"}, {"Value": ""}]}
        signalr.merge_live_state(state, {"BestLapTimes": {"1": {"Value": "1:29.500"}}})
        self.assertIsInstance(state["BestLapTimes"], list)
        self.assertEqual(state["BestLapTimes"][0]["Value"], "1:30.000")
        self.assertEqual(state["BestLapTimes"][1]["Value"], "1:29.500")

    def test_list_patch_extends_missing_indices(self):
        state = {"Sectors": [{"Value": "20.1"}]}
        signalr.merge_live_state(state, {"Sectors": {"2": {"Value": "31.9"}}})
        self.assertEqual(len(state["Sectors"]), 3)
        self.assertEqual(state["Sectors"][1], {})
        self.assertEqual(state["Sectors"][2]["Value"], "31.9")

    def test_patch_values_are_decoupled_from_the_source(self):
        payload = {"Messages": [{"Message": "GREEN LIGHT"}]}
        state = signalr.merge_live_state({}, payload)
        payload["Messages"][0]["Message"] = "mutated"
        self.assertEqual(state["Messages"][0]["Message"], "GREEN LIGHT")


SNAPSHOT_FEEDS = {
    "Heartbeat": {"Utc": "2026-07-18T14:00:00Z"},
    "TimingData": {"Lines": {"44": {"Position": "1", "BestLapTimes": [{"Value": "1:44.100"}]}}},
    "CarData.z": "compressed-0",
}


def snapshot_store(session_key=11329, **kwargs):
    store = signalr.LiveFeedStore(session_key, **kwargs)
    store.on_frame("snapshot", {"feeds": dict(SNAPSHOT_FEEDS)})
    return store


class LiveFeedStoreTests(unittest.TestCase):
    def test_snapshot_anchor_comes_from_heartbeat(self):
        self.assertEqual(snapshot_store().anchor_utc, "2026-07-18T14:00:00Z")

    def test_snapshot_becomes_stream_shaped_records(self):
        from livetiming_compat import derive_stream_start_utc
        store = snapshot_store()
        records = store.get_records("Heartbeat")
        self.assertEqual(records, [("00:00:00.000", {"Utc": "2026-07-18T14:00:00Z"})])
        # The static-stream anchor derivation must reproduce the store anchor
        self.assertEqual(derive_stream_start_utc(records), store.anchor_utc)

    def test_updates_append_anchored_records(self):
        store = snapshot_store()
        store.on_frame("updates", {"updates": [
            ("TimingData", {"Lines": {"44": {"NumberOfLaps": 3}}}, "2026-07-18T14:30:00Z"),
        ]})
        records = store.get_records("TimingData")
        self.assertEqual(len(records), 2)
        self.assertEqual(records[1][0], "00:30:00.000")
        self.assertEqual(records[1][1]["Lines"]["44"]["NumberOfLaps"], 3)

    def test_state_merges_updates_and_keeps_keyframe_lists(self):
        store = snapshot_store()
        store.on_frame("updates", {"updates": [
            ("TimingData", {"Lines": {"44": {"BestLapTimes": {"0": {"Value": "1:43.000"}}}}},
             "2026-07-18T14:30:00Z"),
        ]})
        line = store.get_state("TimingData")["Lines"]["44"]
        self.assertEqual(line["Position"], "1")
        self.assertIsInstance(line["BestLapTimes"], list)
        self.assertEqual(line["BestLapTimes"][0]["Value"], "1:43.000")
        # The record list keeps the raw delta, not the merged state
        self.assertEqual(
            store.get_records("TimingData")[1][1],
            {"Lines": {"44": {"BestLapTimes": {"0": {"Value": "1:43.000"}}}}},
        )

    def test_get_state_returns_isolated_copies(self):
        store = snapshot_store()
        store.get_state("TimingData")["Lines"]["44"]["Position"] = "99"
        self.assertEqual(store.get_state("TimingData")["Lines"]["44"]["Position"], "1")

    def test_missing_feeds_return_none(self):
        store = snapshot_store()
        self.assertIsNone(store.get_records("WeatherData"))
        self.assertIsNone(store.get_state("WeatherData"))

    def test_z_records_are_bounded_keeping_latest(self):
        store = snapshot_store(max_z_records=3)
        for minute in range(1, 6):
            store.on_frame("updates", {"updates": [
                ("CarData.z", f"compressed-{minute}", f"2026-07-18T14:0{minute}:00Z"),
            ]})
        records = store.get_records("CarData.z")
        self.assertEqual(len(records), 3)
        self.assertEqual(records[-1][1], "compressed-5")

    def test_resubscribe_snapshot_replaces_and_reanchors(self):
        store = snapshot_store()
        store.on_frame("updates", {"updates": [
            ("TimingData", {"Lines": {"44": {"NumberOfLaps": 3}}}, "2026-07-18T14:30:00Z"),
        ]})
        store.on_frame("snapshot", {"feeds": {
            "Heartbeat": {"Utc": "2026-07-18T15:00:00Z"},
            "TimingData": {"Lines": {"44": {"Position": "2"}}},
        }})
        self.assertEqual(store.anchor_utc, "2026-07-18T15:00:00Z")
        self.assertEqual(len(store.get_records("TimingData")), 1)
        self.assertEqual(store.get_state("TimingData")["Lines"]["44"], {"Position": "2"})
        self.assertIsNone(store.get_records("CarData.z"))

    def test_updates_before_snapshot_anchor_at_first_timestamp(self):
        store = signalr.LiveFeedStore(11329)
        store.on_frame("updates", {"updates": [
            ("WeatherData", {"AirTemp": "25.1"}, "2026-07-18T14:10:00Z"),
            ("WeatherData", {"AirTemp": "25.3"}, "2026-07-18T14:15:00Z"),
        ]})
        self.assertEqual(store.anchor_utc, "2026-07-18T14:10:00Z")
        records = store.get_records("WeatherData")
        self.assertEqual([record[0] for record in records], ["00:00:00.000", "00:05:00.000"])

    def test_freshness_tracks_last_frame(self):
        store = signalr.LiveFeedStore(11329)
        self.assertFalse(store.is_fresh(60))
        store.on_frame("keepalive", {"type": "keepalive"})
        self.assertTrue(store.is_fresh(60))
        store._last_frame_at -= 120
        self.assertFalse(store.is_fresh(60))

    def test_store_records_interoperate_with_stream_normalizers(self):
        from livetiming_compat import normalize_livetiming_intervals
        store = snapshot_store()
        store.on_frame("updates", {"updates": [
            ("TimingData", {"Lines": {"44": {"GapToLeader": "+1.234"}}}, "2026-07-18T14:30:00Z"),
        ]})
        rows = normalize_livetiming_intervals(
            store.get_records("TimingData"), session_key=11329, stream_start_utc=store.anchor_utc
        )
        self.assertEqual(rows[-1]["gap_to_leader"], 1.234)
        self.assertEqual(rows[-1]["date"], "2026-07-18T14:30:00Z")


class RecordedTrafficReplayTests(unittest.TestCase):
    """Replays a slice of real hub traffic recorded during 2026 Belgian GP
    qualifying (trimmed snapshot + 24 deltas across six feeds)."""

    @classmethod
    def setUpClass(cls):
        with open(FIXTURES / "quali_2026_belgian_slice.json", encoding="utf-8") as f:
            cls.fixture = json.load(f)
        cls.store = signalr.LiveFeedStore(11330)
        cls.store.on_frame("snapshot", {"feeds": cls.fixture["snapshot"]})
        cls.store.on_frame("updates", {"updates": [tuple(u) for u in cls.fixture["updates"]]})

    def test_anchor_derives_from_the_real_heartbeat(self):
        from livetiming_compat import parse_utc_datetime
        self.assertIsNotNone(parse_utc_datetime(self.store.anchor_utc))

    def test_session_info_names_qualifying(self):
        info = self.store.get_state("SessionInfo")
        self.assertEqual(info["Key"], 11330)
        self.assertEqual(info["Name"], "Qualifying")

    def test_recorded_weather_normalizes(self):
        from livetiming_compat import normalize_livetiming_weather
        rows = normalize_livetiming_weather(
            self.store.get_records("WeatherData"),
            session_key=11330,
            stream_start_utc=self.store.anchor_utc,
        )
        self.assertGreaterEqual(len(rows), 1)
        self.assertIsInstance(rows[-1]["air_temperature"], float)

    def test_recorded_driver_list_normalizes(self):
        from livetiming_compat import normalize_livetiming_drivers
        rows = normalize_livetiming_drivers(self.store.get_state("DriverList"))
        self.assertGreaterEqual(len(rows), 2)
        # Deltas touching drivers outside the trimmed snapshot slice leave
        # partial rows; the snapshot-seeded drivers must be complete
        seeded = {int(k) for k in self.fixture["snapshot"]["DriverList"]}
        complete = {row["driver_number"]: row for row in rows if row["driver_number"] in seeded}
        self.assertEqual(set(complete), seeded)
        for row in complete.values():
            self.assertTrue(row["full_name"])

    def test_recorded_timing_deltas_merge_into_line_state(self):
        lines = self.store.get_state("TimingData")["Lines"]
        for driver_number in self.fixture["snapshot"]["TimingData"]["Lines"]:
            self.assertIn("Position", lines[driver_number])


if __name__ == "__main__":
    unittest.main()
