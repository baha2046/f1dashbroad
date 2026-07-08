import json
import unittest
from urllib.parse import parse_qs, urlparse

import livetiming_signalr as signalr


class SignalRUrlTests(unittest.TestCase):
    def test_negotiate_url_carries_streaming_hub_and_protocol(self):
        url = urlparse(signalr.build_negotiate_url())
        query = parse_qs(url.query)
        self.assertEqual(url.path, "/signalr/negotiate")
        self.assertEqual(query["clientProtocol"], ["1.5"])
        self.assertEqual(json.loads(query["connectionData"][0]), [{"name": "Streaming"}])

    def test_connect_url_is_websocket_transport_with_token(self):
        url = urlparse(signalr.build_connect_url("abc+/=123"))
        query = parse_qs(url.query)
        self.assertEqual(url.scheme, "wss")
        self.assertEqual(query["transport"], ["webSockets"])
        self.assertEqual(query["connectionToken"], ["abc+/=123"])

    def test_subscribe_message_shape(self):
        message = json.loads(signalr.build_subscribe_message(["TimingData"], invocation_id=7))
        self.assertEqual(message, {
            "H": "Streaming", "M": "Subscribe", "A": [["TimingData"]], "I": 7,
        })

    def test_default_feeds_cover_live_mode_consumers(self):
        for feed in ("TimingData", "SessionData", "RaceControlMessages", "Position.z", "CarData.z"):
            self.assertIn(feed, signalr.DEFAULT_FEEDS)


class SignalRFrameClassifierTests(unittest.TestCase):
    def test_subscribe_reply_is_a_snapshot(self):
        frame = json.dumps({"R": {"TimingData": {"Lines": {"44": {"Position": "1"}}}}, "I": "1"})
        result = signalr.classify_signalr_frame(frame)
        self.assertEqual(result["type"], "snapshot")
        self.assertIn("TimingData", result["feeds"])

    def test_hub_deltas_are_updates(self):
        frame = json.dumps({"C": "cursor", "M": [
            {"H": "Streaming", "M": "feed",
             "A": ["TimingData", {"Lines": {"44": {"NumberOfLaps": 3}}}, "2026-07-05T15:12:00.123Z"]},
            {"H": "Streaming", "M": "feed",
             "A": ["WeatherData", {"AirTemp": "25.1"}, "2026-07-05T15:12:01.000Z"]},
        ]})
        result = signalr.classify_signalr_frame(frame)
        self.assertEqual(result["type"], "updates")
        self.assertEqual(len(result["updates"]), 2)
        feed, payload, utc = result["updates"][0]
        self.assertEqual(feed, "TimingData")
        self.assertEqual(payload["Lines"]["44"]["NumberOfLaps"], 3)
        self.assertEqual(utc, "2026-07-05T15:12:00.123Z")

    def test_keepalives_and_junk_are_tolerated(self):
        self.assertEqual(signalr.classify_signalr_frame("{}")["type"], "keepalive")
        self.assertEqual(signalr.classify_signalr_frame("")["type"], "keepalive")
        # M list with non-feed hub calls only
        frame = json.dumps({"M": [{"H": "Streaming", "M": "other", "A": []}]})
        self.assertEqual(signalr.classify_signalr_frame(frame)["type"], "keepalive")
        with self.assertRaises(ValueError):
            signalr.classify_signalr_frame("not json")

    def test_updates_skip_malformed_entries(self):
        frame = json.dumps({"M": [
            "junk",
            {"H": "Streaming", "M": "feed", "A": ["TimingData"]},
            {"H": "Streaming", "M": "feed", "A": ["TrackStatus", {"Status": "1"}]},
        ]})
        result = signalr.classify_signalr_frame(frame)
        self.assertEqual(result["type"], "updates")
        self.assertEqual(result["updates"], [("TrackStatus", {"Status": "1"}, None)])


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


if __name__ == "__main__":
    unittest.main()
