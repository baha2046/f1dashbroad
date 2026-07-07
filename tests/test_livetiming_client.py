import unittest

from livetiming_client import (
    decode_z_payload,
    parse_livetiming_stream,
    resolve_livetiming_session_ref,
)


class LivetimingParserTests(unittest.TestCase):
    def test_parse_livetiming_stream_splits_timestamps_and_json(self):
        raw = (
            '00:00:14.052{"AirTemp":"21.0","Humidity":"52.0"}\r\n'
            '00:01:14.050{"AirTemp":"20.6","Humidity":"53.0"}\r\n'
        )

        records = parse_livetiming_stream(raw)

        self.assertEqual(records, [
            ("00:00:14.052", {"AirTemp": "21.0", "Humidity": "52.0"}),
            ("00:01:14.050", {"AirTemp": "20.6", "Humidity": "53.0"}),
        ])

    def test_decode_z_payload_returns_position_entries(self):
        payload = (
            '"7ZWxDoIwEIbf5WYg7ZVyTXdnTWRQjAMxDMQIBupE+u6iL2BvkuGWS5p8w/'
            '1396ULHMa5D/04gL8sUPePbg7t4wkeUGGZK8rR1Rq9Vh6xIEdktGkgg90Q'
            'pr6bwS+gP+UY2vBan7Af6qm93VfkBF5lcP7WZq0xA0xHTTpapqNaMVhGMM3'
            'poWKwjjFcRjZkbAIZq0DGHJAY18DYRcnowdp0tmLMgRjZXHK2GLNfkppCK6'
            'ockkgqkoqkW5XUrJJalJ9UJBVJNyupLanS1omkIqlI+hdJr/EN"'
        )

        decoded = decode_z_payload(payload)

        self.assertIn("Position", decoded)
        first = decoded["Position"][0]
        self.assertEqual(first["Timestamp"], "2024-07-28T12:10:22.7877313Z")
        self.assertEqual(first["Entries"]["1"]["Status"], "OnTrack")


class LivetimingSessionResolutionTests(unittest.TestCase):
    def test_resolve_session_path_finds_session_in_year_index(self):
        year_index = {
            "Meetings": [{
                "Key": 1289,
                "Name": "British Grand Prix",
                "Sessions": [{
                    "Key": 11326,
                    "Name": "Race",
                    "Type": "Race",
                    "Path": "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/",
                }],
            }],
        }

        ref = resolve_livetiming_session_ref(year_index, 2026, 11326)

        self.assertEqual(ref.year, 2026)
        self.assertEqual(ref.meeting_key, 1289)
        self.assertEqual(ref.session_key, 11326)
        self.assertEqual(ref.path, "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/")


if __name__ == "__main__":
    unittest.main()
