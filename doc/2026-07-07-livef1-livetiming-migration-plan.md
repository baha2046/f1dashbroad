# LiveF1 Livetiming Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenF1-backed dashboard data with keyless LiveF1 / official Formula 1 Livetiming data while preserving the current frontend `/api/*` payload contracts.

**Architecture:** Keep the existing Quart API routes as the compatibility boundary and swap their internals from `api.openf1.org` to a local async Livetiming adapter. The adapter fetches official `https://livetiming.formula1.com/static/` indexes, keyframes, and stream archives, decodes `.z` telemetry feeds, and normalizes records into the OpenF1-shaped JSON that the current JavaScript already understands. Real-time mode keeps the existing 30 second polling loop first, then can optionally move to LiveF1's SignalR client for lower-latency streaming after the static-feed migration is stable.

**Tech Stack:** Python (Quart, httpx, stdlib `base64`/`zlib`), JavaScript (vanilla), Python `unittest`, Node-based JS static tests, official F1 Livetiming static feeds, Jolpica for championship/calendar gaps.

---

## Source Findings

- LiveF1 documents real-time and historical F1 data, using Formula 1 Livetiming plus Jolpica rather than OpenF1.
- The official Livetiming static tree starts at `https://livetiming.formula1.com/static/Index.json`, then `/{year}/Index.json`, then per-session `Index.json` manifests with `Feeds`.
- A race session manifest exposes the feeds this dashboard needs: `SessionInfo`, `DriverList`, `TimingData`, `TimingAppData`, `LapSeries`, `TyreStintSeries`, `WeatherData`, `RaceControlMessages`, `TeamRadio`, `Position.z`, `CarData.z`, `PitLaneTimeCollection`, `TrackStatus`, `SessionStatus`, and `LapCount`.
- `Position.z` and `CarData.z` keyframes and streams are JSON strings containing base64 raw-deflate payloads. Decode with `zlib.decompress(base64.b64decode(value), -zlib.MAX_WBITS)`.
- LiveF1's high-level package is useful as a reference, but its static adapter is synchronous `requests` and its silver-table generation pulls pandas/numpy/scipy into request paths. For this async web app, use a slim local async adapter in production and keep LiveF1's documented topic names/parsing model as the compatibility guide.

## File Structure

- Create `livetiming_client.py`: async low-level Livetiming HTTP client, stream parser, `.z` decoder, session-path resolver, and per-feed fetch helpers.
- Create `livetiming_compat.py`: functions that normalize Livetiming/Jolpica records into the current OpenF1-style response shapes.
- Modify `app.py`: route handlers call the compatibility layer instead of constructing OpenF1 URLs; OpenF1 auth errors and key forwarding are removed or renamed to generic upstream errors.
- Modify `static/js/03-api-settings.js`: remove `X-OpenF1-Key` injection and key-management behavior; keep `customFetch` as the central error wrapper.
- Modify `templates/index.html`: remove OpenF1 API key UI, the Stripe key link, and live-restriction banner copy.
- Modify `README.md` and `ubuntu-apache-deployment-guide.md`: replace OpenF1 architecture and key instructions with Livetiming/LiveF1 notes.
- Create `tests/test_livetiming_client.py`: isolated parser/client tests using local sample payloads.
- Create `tests/test_livetiming_compat.py`: OpenF1-compatible normalization tests for each dashboard endpoint shape.
- Update OpenF1-specific tests: `tests/test_openf1_retry.py`, `tests/test_live_mode.py`, `tests/test_phase0_hardening.py`, `tests/test_phase1_maintenance.py`, and endpoint-specific tests that assert upstream URL construction.

## Endpoint Mapping

| Current route | Current OpenF1 source | Replacement source | Compatibility output |
| --- | --- | --- | --- |
| `/api/sessions?year=` | `/v1/sessions` | Livetiming `/{year}/Index.json`, enriched by Jolpica when needed | Existing session rows: `session_key`, `meeting_key`, `year`, `location`, `country_code`, `session_name`, `session_type`, `date_start`, `date_end`, `gmt_offset`, `path`, `is_cancelled` |
| `/api/meetings?meeting_key=` | `/v1/meetings` | Livetiming yearly index meeting object and `SessionInfo.json` | Existing `{ meeting, circuit_info }` shape |
| `/api/drivers?session_key=` | `/v1/drivers` plus `f1api.dev` | `DriverList.json`, optionally existing `f1api.dev` biography enrichment | Existing driver rows: `driver_number`, names, acronym, team, colour, headshot, biography extras |
| `/api/weather` | `/v1/weather` | `WeatherData.jsonStream`, fallback `WeatherDataSeries.json`/`WeatherData.json` | List of weather samples with `date`, `air_temperature`, `track_temperature`, `humidity`, `rainfall`, `wind_speed`, `wind_direction` |
| `/api/race_control` | `/v1/race_control` | `RaceControlMessages.jsonStream`, fallback keyframe | List with `date`, `lap_number`, `category`, `flag`, `scope`, `message`, `driver_number` where parseable |
| `/api/team_radio` | `/v1/team_radio` | `TeamRadio.jsonStream`, fallback keyframe | List with `date`, `driver_number`, `recording_url` joined against session static path |
| `/api/position` | `/v1/position` | `TimingData.jsonStream` for order by lap, plus `Position.z` only for coordinates | For compare/live timing, use `TimingData` to emit `date`, `driver_number`, `position` |
| `/api/intervals` | `/v1/intervals` | `TimingData.jsonStream` | Existing gap rows: `date`, `driver_number`, `interval`, `gap_to_leader` |
| `/api/stints` | `/v1/stints` | `TyreStintSeries.jsonStream`, fallback keyframe | Existing stint rows: `driver_number`, `stint_number`, `lap_start`, `lap_end`, `compound`, `tyre_age_start` |
| `/api/pit` | `/v1/pit` | `PitLaneTimeCollection.jsonStream` and/or `PitStopSeries` when present | Existing pit rows: `driver_number`, `lap_number`, `date`, `pit_duration` |
| `/api/laps` | `/v1/laps` | Local lap reconstruction from `TimingData`, `RaceControlMessages`, `TyreStintSeries`, `TrackStatus` | Existing lap rows: `driver_number`, `lap_number`, `date_start`, `lap_duration`, sectors, speeds, pit markers |
| `/api/results` | `/v1/session_result` | Prefer Jolpica/F1 results for completed sessions; for live sessions use `TimingData` current classification | Existing result rows used by results table |
| `/api/car_telemetry` | `/v1/car_data` | Decoded `CarData.z.jsonStream` filtered by lap window | Existing payload `telemetry: [{ t, speed, throttle, brake, gear, drs }]` |
| `/api/track_replay` | `/v1/location` | Decoded `Position.z.jsonStream` filtered by lap window | Existing payload `drivers: [{ driver_number, samples: [[t, x, y]] }]` |

## Task 1: Add Livetiming Parser Tests

**Files:**
- Create: `tests/test_livetiming_client.py`
- Create: `tests/fixtures/livetiming/position_z_stream_sample.json`
- Create: `tests/fixtures/livetiming/car_data_z_stream_sample.json`

- [ ] **Step 1: Write tests for stream splitting and `.z` decoding**

```python
import json
import unittest

from livetiming_client import decode_z_payload, parse_livetiming_stream


class LivetimingParserTests(unittest.TestCase):
    def test_parse_livetiming_stream_splits_timestamps_and_json(self):
        raw = (
            '00:00:14.052{"AirTemp":"21.0","Humidity":"52.0"}\\r\\n'
            '00:01:14.050{"AirTemp":"20.6","Humidity":"53.0"}\\r\\n'
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
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `.venv/bin/python3 -m unittest tests.test_livetiming_client -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'livetiming_client'`.

## Task 2: Implement Low-Level Livetiming Client

**Files:**
- Create: `livetiming_client.py`
- Test: `tests/test_livetiming_client.py`

- [ ] **Step 1: Implement async fetch, stream parsing, and z decoding**

```python
import base64
import json
import zlib
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx

LIVETIMING_BASE_URL = "https://livetiming.formula1.com"
LIVETIMING_STATIC_BASE = f"{LIVETIMING_BASE_URL}/static/"


@dataclass(frozen=True)
class LivetimingSessionRef:
    year: int
    meeting_key: int | str
    session_key: int | str
    path: str


def decode_livetiming_text(raw: bytes) -> str:
    return raw.decode("utf-8-sig")


def parse_livetiming_stream(text: str):
    records = []
    for line in text.split("\r\n"):
        if not line:
            continue
        timestamp = line[:12]
        payload = json.loads(line[12:])
        records.append((timestamp, payload))
    return records


def decode_z_payload(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8-sig")
    if isinstance(value, str) and value.startswith('"'):
        value = json.loads(value)
    decoded = zlib.decompress(base64.b64decode(value), -zlib.MAX_WBITS)
    return json.loads(decoded.decode("utf-8-sig"))


def livetiming_static_url(path: str) -> str:
    return urljoin(LIVETIMING_STATIC_BASE, path)


async def fetch_livetiming_text(client: httpx.AsyncClient, path: str) -> str:
    response = await client.get(livetiming_static_url(path), timeout=15.0)
    response.raise_for_status()
    return decode_livetiming_text(response.content)


async def fetch_livetiming_json(client: httpx.AsyncClient, path: str):
    return json.loads(await fetch_livetiming_text(client, path))


async def fetch_livetiming_stream(client: httpx.AsyncClient, path: str):
    return parse_livetiming_stream(await fetch_livetiming_text(client, path))
```

- [ ] **Step 2: Run parser tests**

Run: `.venv/bin/python3 -m unittest tests.test_livetiming_client -v`

Expected: PASS.

## Task 3: Add Source Resolution and Fixture-Based Client Tests

**Files:**
- Modify: `livetiming_client.py`
- Modify: `tests/test_livetiming_client.py`

- [ ] **Step 1: Add tests for session-path resolution**

```python
from unittest.mock import AsyncMock


class LivetimingSessionResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_session_path_finds_session_in_year_index(self):
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
```

- [ ] **Step 2: Implement session resolver**

```python
def resolve_livetiming_session_ref(year_index: dict, year: int, session_key: int | str):
    target = str(session_key)
    for meeting in year_index.get("Meetings") or []:
        for session in meeting.get("Sessions") or []:
            if str(session.get("Key")) == target:
                return LivetimingSessionRef(
                    year=year,
                    meeting_key=meeting.get("Key"),
                    session_key=session.get("Key"),
                    path=session.get("Path"),
                )
    return None
```

- [ ] **Step 3: Run tests**

Run: `.venv/bin/python3 -m unittest tests.test_livetiming_client -v`

Expected: PASS.

## Task 4: Normalize Sessions, Meetings, and Drivers

**Files:**
- Create: `livetiming_compat.py`
- Create: `tests/test_livetiming_compat.py`
- Modify: `app.py`

- [ ] **Step 1: Write compatibility tests**

```python
import unittest

from livetiming_compat import normalize_livetiming_drivers, normalize_livetiming_sessions


class LivetimingCompatibilityTests(unittest.TestCase):
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
        self.assertEqual(sessions[0]["date_start"], "2026-07-05T15:00:00")
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
```

- [ ] **Step 2: Implement normalizers**

```python
def normalize_livetiming_sessions(year_index: dict, year: int):
    rows = []
    for meeting in year_index.get("Meetings") or []:
        for session in meeting.get("Sessions") or []:
            rows.append({
                "session_key": session.get("Key"),
                "meeting_key": meeting.get("Key"),
                "year": year,
                "location": meeting.get("Location"),
                "country_code": (meeting.get("Country") or {}).get("Code"),
                "country_name": (meeting.get("Country") or {}).get("Name"),
                "circuit_key": (meeting.get("Circuit") or {}).get("Key"),
                "circuit_short_name": (meeting.get("Circuit") or {}).get("ShortName"),
                "meeting_name": meeting.get("Name"),
                "session_name": session.get("Name"),
                "session_type": session.get("Type"),
                "date_start": session.get("StartDate"),
                "date_end": session.get("EndDate"),
                "gmt_offset": session.get("GmtOffset"),
                "path": session.get("Path"),
                "is_cancelled": False,
            })
    return rows


def split_full_name(full_name: str | None):
    parts = str(full_name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0].title(), ""
    return parts[0].title(), " ".join(parts[1:]).title()


def normalize_livetiming_drivers(driver_list: dict):
    rows = []
    for key, driver in (driver_list or {}).items():
        first_name, last_name = split_full_name(driver.get("FullName"))
        rows.append({
            "driver_number": int(driver.get("RacingNumber") or key),
            "broadcast_name": driver.get("BroadcastName"),
            "full_name": driver.get("FullName"),
            "first_name": first_name,
            "last_name": last_name,
            "name_acronym": driver.get("Tla"),
            "team_name": driver.get("TeamName"),
            "team_colour": driver.get("TeamColour"),
            "headshot_url": driver.get("HeadshotUrl"),
        })
    return sorted(rows, key=lambda row: row["driver_number"])
```

- [ ] **Step 3: Change `/api/sessions`, `/api/meetings`, and `/api/drivers` to use Livetiming**

Keep the route URLs and JSON contracts unchanged. Cache filenames stay `sessions_<year>.json`, `meetings_<meeting_key>.json`, and `drivers_<session_key>.json` so frontend code and existing stale-cache behavior remain stable.

- [ ] **Step 4: Run focused tests**

Run: `.venv/bin/python3 -m unittest tests.test_livetiming_compat tests.test_session_autofocus -v`

Expected: PASS after updating any URL-specific assertions from OpenF1 to Livetiming.

## Task 5: Replace Generic Session Endpoints

**Files:**
- Modify: `livetiming_compat.py`
- Modify: `app.py`
- Modify: `tests/test_weather_trends.py`
- Modify: `tests/test_race_control_feed.py`
- Modify: `tests/test_team_radio.py`
- Modify: `tests/test_compare_position_chart.py`
- Modify: `tests/test_live_mode.py`

- [ ] **Step 1: Add normalizer tests for weather, race control, team radio, position, intervals, and stints**

```python
from livetiming_compat import (
    normalize_livetiming_intervals,
    normalize_livetiming_race_control,
    normalize_livetiming_team_radio,
    normalize_livetiming_weather,
)


def test_normalize_weather_stream_rows():
    rows = normalize_livetiming_weather([
        ("00:00:14.052", {"AirTemp": "21.0", "Humidity": "52.0", "Rainfall": "0", "TrackTemp": "42.1", "WindDirection": "217", "WindSpeed": "0.5"})
    ], session_start_utc="2024-07-28T12:00:00Z")

    assert rows[0]["air_temperature"] == 21.0
    assert rows[0]["track_temperature"] == 42.1
    assert rows[0]["rainfall"] == 0


def test_normalize_team_radio_joins_recording_url():
    rows = normalize_livetiming_team_radio([
        ("00:00:29.542", {"Captures": [{"Utc": "2024-07-28T12:09:11.2Z", "RacingNumber": "55", "Path": "TeamRadio/CARSAI01.mp3"}]})
    ], "2024/2024-07-28_Belgian_Grand_Prix/2024-07-28_Race/")

    assert rows[0]["driver_number"] == 55
    assert rows[0]["recording_url"] == "https://livetiming.formula1.com/static/2024/2024-07-28_Belgian_Grand_Prix/2024-07-28_Race/TeamRadio/CARSAI01.mp3"
```

- [ ] **Step 2: Replace `OPENF1_SESSION_ENDPOINTS`**

In `app.py`, rename the table and point each route at a feed normalizer:

```python
LIVETIMING_SESSION_ENDPOINTS = {
    "weather": ("WeatherData", normalize_livetiming_weather),
    "stints": ("TyreStintSeries", normalize_livetiming_stints),
    "pit": ("PitLaneTimeCollection", normalize_livetiming_pit),
    "position": ("TimingData", normalize_livetiming_position),
    "intervals": ("TimingData", normalize_livetiming_intervals),
    "results": ("TimingData", normalize_livetiming_results),
    "race_control": ("RaceControlMessages", normalize_livetiming_race_control),
    "team_radio": ("TeamRadio", normalize_livetiming_team_radio),
}
```

- [ ] **Step 3: Update endpoint factory**

The factory should:

1. Parse `session_key`.
2. Resolve the session year from cached sessions.
3. Resolve the session path from the year index.
4. Fetch the feed's `StreamPath` for stream feeds, falling back to `KeyFramePath` when the stream is missing.
5. Normalize to the current route payload.
6. Cache under the existing cache filename.

- [ ] **Step 4: Run focused endpoint tests**

Run: `.venv/bin/python3 -m unittest tests.test_weather_trends tests.test_race_control_feed tests.test_team_radio tests.test_compare_position_chart tests.test_live_mode -v`

Expected: PASS with tests asserting Livetiming static paths such as `/WeatherData.jsonStream`, `/RaceControlMessages.jsonStream`, and `/TimingData.jsonStream`.

## Task 6: Rebuild Lap Rows from Livetiming

**Files:**
- Modify: `livetiming_compat.py`
- Modify: `app.py`
- Modify: `tests/test_laps_driver_bottom_bar.py`
- Modify: `tests/test_compare_head_to_head.py`
- Modify: `tests/test_compare_gap_chart.py`
- Modify: `tests/test_compare_tyre_strategy.py`
- Modify: `tests/test_pit_annotations.py`

- [ ] **Step 1: Add lap reconstruction unit tests**

Use a compact `TimingData.jsonStream` fixture with:

- Lap 1 start.
- Sector 1/2/3 values.
- `LastLapTime.Value`.
- `NumberOfLaps` increment.
- Pit-in and pit-out markers.

Expected normalized lap:

```python
{
    "session_key": 9574,
    "driver_number": 44,
    "lap_number": 2,
    "date_start": "2024-07-28T13:05:45.045000Z",
    "lap_duration": 110.240,
    "duration_sector_1": 31.831,
    "duration_sector_2": 48.675,
    "duration_sector_3": 29.734,
    "i1_speed": 303,
    "i2_speed": 203,
    "st_speed": 304,
}
```

- [ ] **Step 2: Implement `normalize_livetiming_laps`**

Implementation rules:

- Convert stream timestamps to absolute UTC using session start time and stream `Utc` fields when present.
- Maintain latest timing state per driver.
- Emit a completed lap when `LastLapTime.Value` changes or sector 3 completes.
- Use `NumberOfLaps` as `lap_number` when present.
- Convert `"M:SS.mmm"` and `"SS.mmm"` strings to float seconds.
- Join tyre compound from `TyreStintSeries` by driver and lap range.
- Join pit data from `PitLaneTimeCollection` by driver and lap.
- Sort by `driver_number`, then `lap_number`.

- [ ] **Step 3: Route `/api/laps` through reconstructed rows**

Preserve the optional `driver_number` filter by filtering normalized rows after reconstruction.

- [ ] **Step 4: Run lap and compare tests**

Run: `.venv/bin/python3 -m unittest tests.test_laps_driver_bottom_bar tests.test_compare_head_to_head tests.test_compare_gap_chart tests.test_compare_tyre_strategy tests.test_pit_annotations -v`

Expected: PASS.

## Task 7: Replace Telemetry and Track Replay Sources

**Files:**
- Modify: `livetiming_compat.py`
- Modify: `app.py`
- Modify: `tests/test_car_telemetry.py`
- Modify: `tests/test_track_replay.py`
- Modify: `tests/test_session_replay_tab.py`

- [ ] **Step 1: Add decoded telemetry and position fixture tests**

Expected `CarData.z` row:

```python
{
    "date": "2024-07-28T12:11:08.0831416Z",
    "driver_number": 44,
    "rpm": 0,
    "speed": 0,
    "n_gear": 0,
    "throttle": 0,
    "brake": 0,
    "drs": 0,
}
```

Expected `Position.z` row:

```python
{
    "date": "2024-07-28T12:10:22.7877313Z",
    "driver_number": 44,
    "x": 0,
    "y": 0,
    "z": 0,
}
```

- [ ] **Step 2: Implement decoded row helpers**

```python
CHANNEL_MAP = {
    "0": "rpm",
    "2": "speed",
    "3": "n_gear",
    "4": "throttle",
    "5": "brake",
    "45": "drs",
}


def flatten_car_data_z(records, session_key):
    for _stream_ts, payload in records:
        decoded = decode_z_payload(payload)
        for entry in decoded.get("Entries") or []:
            date = entry.get("Utc")
            for driver_number, car in (entry.get("Cars") or {}).items():
                channels = car.get("Channels") or {}
                row = {
                    "session_key": session_key,
                    "date": date,
                    "driver_number": int(driver_number),
                }
                row.update({target: channels.get(source) for source, target in CHANNEL_MAP.items()})
                yield row
```

- [ ] **Step 3: Update `/api/car_telemetry` and `/api/track_replay`**

Keep the existing lap-window logic. Replace the OpenF1 date-range upstream calls with:

- Fetch full `CarData.z.jsonStream`, decode, filter by `driver_number` and lap window, downsample.
- Fetch full `Position.z.jsonStream`, decode, filter by lap window, group and downsample.

Cache outputs under the existing `car_telemetry_*` and `track_replay_*` filenames.

- [ ] **Step 4: Run telemetry and replay tests**

Run: `.venv/bin/python3 -m unittest tests.test_car_telemetry tests.test_track_replay tests.test_session_replay_tab -v`

Expected: PASS.

## Task 8: Remove OpenF1 Key UX and Auth Forwarding

**Files:**
- Modify: `static/js/03-api-settings.js`
- Modify: `templates/index.html`
- Modify: `static/css/styles.css`
- Modify: `tests/test_phase0_hardening.py`
- Modify: `tests/test_openf1_retry.py`

- [ ] **Step 1: Add/update static tests**

Assertions:

- `static/js/03-api-settings.js` does not read `localStorage.getItem('openf1_api_key')`.
- `static/js/03-api-settings.js` does not set `X-OpenF1-Key`.
- `templates/index.html` does not contain `openF1ApiKeyInput`.
- `templates/index.html` does not contain the Stripe API-key link.
- `customFetch` still displays upstream errors for 502/503 JSON payloads.

- [ ] **Step 2: Simplify frontend fetch wrapper**

Keep:

```javascript
async function customFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 502 || response.status === 503) {
        try {
            const errData = await response.clone().json();
            if (errData && errData.error === 'upstream_error') {
                showDataSourceBanner(errData.detail || 'F1 data service is temporarily unavailable.');
            }
        } catch (e) {
            console.error('Error parsing upstream error details:', e);
        }
    } else if (response.ok) {
        hideDataSourceBanner();
    }
    return response;
}
```

- [ ] **Step 3: Remove key panel markup**

Replace the sidebar API key footer with a compact source status:

```html
<div class="sidebar-footer">
    <div class="api-status-bar active" id="apiStatusBar">
        <span class="material-icons-round status-icon">sensors</span>
        <span class="status-text" id="apiStatusText">Data Source: F1 Livetiming</span>
    </div>
</div>
```

- [ ] **Step 4: Rename backend errors**

In `app.py`, replace `OpenF1AuthError` with generic source exceptions only:

```python
class UpstreamAPIError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
```

- [ ] **Step 5: Run frontend/key tests**

Run: `.venv/bin/python3 -m unittest tests.test_phase0_hardening tests.test_openf1_retry -v`

Expected: PASS after renaming `test_openf1_retry.py` to a generic upstream retry test or removing OpenF1-auth-specific cases.

## Task 9: Preserve Live Mode Without Keys

**Files:**
- Modify: `static/js/11-live-mode.js`
- Modify: `tests/test_live_mode.py`
- Modify: `app.py`

- [ ] **Step 1: Keep the existing polling cadence**

The first keyless version should keep:

```javascript
const LIVE_REFRESH_SECONDS = 30;
```

The frontend continues polling:

- `/api/position`
- `/api/intervals`
- `/api/race_control`
- `/api/team_radio`

- [ ] **Step 2: Ensure live TTL still works**

Tests should assert live cache TTL is 30 seconds and does not depend on any OpenF1 key header.

- [ ] **Step 3: Add optional future SignalR note in code comments only if implemented**

Do not add a `RealF1Client` background worker in this migration unless static-stream polling proves too stale during a live session. If implemented later, isolate it behind a process-local buffer and keep `/api/*` JSON contracts unchanged.

- [ ] **Step 4: Run live tests**

Run: `.venv/bin/python3 -m unittest tests.test_live_mode -v`

Expected: PASS.

## Task 10: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `ubuntu-apache-deployment-guide.md`
- Modify: `doc/2026-07-07-livef1-livetiming-migration-plan.md` only if implementation discoveries change this plan

- [ ] **Step 1: Update README architecture**

Replace OpenF1 references with:

```markdown
Powered by official Formula 1 Livetiming static feeds (`https://livetiming.formula1.com/static/`) and LiveF1-compatible parsing, with Jolpica for championship/calendar-style data.
```

- [ ] **Step 2: Remove API-key deployment instructions**

Delete `OPENF1_API_KEY` and browser key setup instructions. Add an operational note:

```markdown
No API key is required for Livetiming-backed dashboard data. These are third-party external services and may change format, availability, or terms, so production deployments should use respectful cache TTLs and stale-cache fallback.
```

- [ ] **Step 3: Run full test suite**

Run: `.venv/bin/python3 -m unittest discover -s tests`

Expected: PASS.

- [ ] **Step 4: Manual web verification**

Run: `.venv/bin/python3 app.py`

Open: `http://localhost:5300/`

Verify:

- Sessions load for 2026 without an OpenF1 key.
- Selecting the 2026 British Grand Prix race loads drivers, weather, stints, results, race control, team radio, laps, compare charts, telemetry, and replay.
- Browser devtools Network tab shows no request header named `X-OpenF1-Key`.
- UI has no API key input, no "Get API Key" link, and no live-restriction copy.
- Live mode still shows the live indicator/countdown for a synthetic live-session fixture or the next live F1 session.

## Rollout Order

1. Land parser/client and compatibility tests first.
2. Migrate `/api/sessions`, `/api/meetings`, and `/api/drivers`.
3. Migrate lightweight feeds: weather, race control, team radio, intervals, position, stints, pit.
4. Migrate lap reconstruction.
5. Migrate telemetry/replay.
6. Remove API-key UI and OpenF1 auth forwarding.
7. Update docs and run the full suite.

## Known Risks

- Livetiming schemas can change without notice. Mitigation: keep parser tests small, explicit, and fixture-based; keep stale cache fallback.
- Lap reconstruction is more complex than OpenF1 `/laps`. Mitigation: treat `/api/laps` as its own task and compare known 2024/2026 session outputs against current UI assumptions.
- Live static streams may lag SignalR during an active session. Mitigation: preserve 30 second polling first; add a separate SignalR buffer only if live sessions prove stale.
- Team radio `Path` values are relative to the session static path. Mitigation: normalize every `recording_url` with `https://livetiming.formula1.com/static/{session_path}/{Path}`.
- Some completed session results may be easier from Jolpica/F1 results pages than Livetiming. Mitigation: keep existing Jolpica championship endpoints and use `TimingData` only for live/current classification.

## References

- LiveF1 Getting Started: https://livef1.goktugocal.com/getting_started/index.html
- LiveF1 data sources: https://livef1.goktugocal.com/user_guide/data_sources.html
- LiveF1 real-time data: https://livef1.goktugocal.com/user_guide/realtime_data.html
- Formula 1 Livetiming data structure: https://livef1.goktugocal.com/livetimingf1/f1_data.html
- Livetiming data topics: https://livef1.goktugocal.com/livetimingf1/data_topics.html
- LiveF1 source repository: https://github.com/GoktugOcal/LiveF1
