"""Client primitives for the Livetiming SignalR Core hub.

Protocol background in doc/2026-07-08-signalr-live-mode-design.md; that doc
describes the legacy 1.5 hub at /signalr, which now answers 401 — livetiming
moved to ASP.NET Core SignalR at /signalrcore (anonymous access works for the
core feeds; an F1 TV bearer token unlocks the premium ones). This module
covers negotiation, subscription and frame parsing plus a recording CLI, and
the LiveFeedStore the cache layer consults behind the F1_LIVE_SIGNALR flag.
"""

import asyncio
import copy
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

try:
    import websockets
except ImportError:  # optional at import time; run() needs it
    websockets = None

from livetiming_compat import format_utc, parse_utc_datetime

logger = logging.getLogger("f1_dashboard.signalr")

SIGNALRCORE_NEGOTIATE_URL = "https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1"
SIGNALRCORE_WS_URL = "wss://livetiming.formula1.com/signalrcore"
# SignalR Core frames are JSON records terminated by 0x1e
RECORD_SEPARATOR = "\x1e"
SUBSCRIBE_INVOCATION_ID = "1"

# Feeds live mode consumes; identical names to the static-feed manifests
DEFAULT_FEEDS = [
    "Heartbeat",
    "SessionInfo",
    "DriverList",
    "TimingData",
    "TimingAppData",
    "WeatherData",
    "TrackStatus",
    "SessionStatus",
    "SessionData",
    "RaceControlMessages",
    "TeamRadio",
    "TyreStintSeries",
    "PitLaneTimeCollection",
    "Position.z",
    "CarData.z",
]

RECONNECT_BASE_DELAY_SECONDS = 1.0
RECONNECT_MAX_DELAY_SECONDS = 30.0
PING_INTERVAL_SECONDS = 15.0
RECEIVE_IDLE_TIMEOUT_SECONDS = 60.0


def build_core_handshake_message():
    return json.dumps({"protocol": "json", "version": 1}) + RECORD_SEPARATOR


def build_core_ping_message():
    return json.dumps({"type": 6}) + RECORD_SEPARATOR


def build_core_subscribe_message(feeds=None, invocation_id=SUBSCRIBE_INVOCATION_ID):
    return json.dumps({
        "type": 1,
        "invocationId": str(invocation_id),
        "target": "Subscribe",
        "arguments": [list(feeds or DEFAULT_FEEDS)],
    }) + RECORD_SEPARATOR


def parse_core_frame(raw_text, subscribe_invocation_id=SUBSCRIBE_INVOCATION_ID):
    """Parse one websocket text frame of 0x1e-separated hub records.

    Returns a list of classified events, in arrival order:
      {"type": "snapshot", "feeds": {feed: payload}}          — Subscribe completion
      {"type": "updates", "updates": [(feed, payload, utc)]}  — feed invocations
      {"type": "keepalive"}                                   — pings/handshake ack only
      {"type": "other", "frame": <parsed>}                    — anything unrecognized
    A frame carrying only pings still yields one keepalive event so consumers
    can track connection liveness. Raises ValueError on non-JSON records.
    """
    events = []
    updates = []

    def flush_updates():
        if updates:
            events.append({"type": "updates", "updates": list(updates)})
            updates.clear()

    for chunk in (raw_text or "").split(RECORD_SEPARATOR):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            record = json.loads(chunk)
        except json.JSONDecodeError as e:
            raise ValueError(f"Unparseable SignalR record: {chunk[:80]!r}") from e
        if not isinstance(record, dict) or not record:
            continue  # {} is the handshake ack
        record_type = record.get("type")
        if record_type == 1 and record.get("target") == "feed":
            args = record.get("arguments")
            if isinstance(args, list) and len(args) >= 2:
                updates.append((args[0], args[1], args[2] if len(args) > 2 else None))
            continue
        if (
            record_type == 3
            and str(record.get("invocationId")) == str(subscribe_invocation_id)
            and isinstance(record.get("result"), dict)
        ):
            flush_updates()
            events.append({"type": "snapshot", "feeds": record["result"]})
            continue
        if record_type == 6:
            continue  # server ping
        flush_updates()
        events.append({"type": "other", "frame": record})

    flush_updates()
    if not events:
        events.append({"type": "keepalive"})
    return events


def format_elapsed(delta):
    total_ms = max(0, int(delta.total_seconds() * 1000))
    hours, remainder = divmod(total_ms, 3600 * 1000)
    minutes, remainder = divmod(remainder, 60 * 1000)
    seconds, ms = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{ms:03d}"


def record_from_update(payload, utc, stream_start_utc):
    """Convert one hub delta into the (elapsed, payload) record shape the
    static-stream normalizers consume. Returns None when the timestamps
    cannot be anchored."""
    anchor = parse_utc_datetime(stream_start_utc)
    moment = parse_utc_datetime(utc)
    if anchor is None or moment is None:
        return None
    if moment < anchor:
        moment = anchor
    return (format_elapsed(moment - anchor), payload)


def merge_live_state(target, patch):
    """Deep-merge a hub delta into keyframe-shaped state, preserving lists.

    Deltas address list items as index-keyed dicts ({"2": {...}}). Unlike
    merge_timing_delta — which normalizes lists into dicts for the stream
    reducers — keyframe consumers (results, stints, drivers) branch on
    isinstance(list), so index keys must patch the list in place, extending
    with empty dicts as needed. Returns the merged value; container inputs
    are merged in place, scalars replaced."""
    if isinstance(target, list) and isinstance(patch, dict):
        for key, value in patch.items():
            try:
                index = int(key)
            except (TypeError, ValueError):
                return copy.deepcopy(patch)
            if index < 0:
                continue
            while len(target) <= index:
                target.append({})
            target[index] = merge_live_state(target[index], value)
        return target
    if isinstance(target, dict) and isinstance(patch, dict):
        for key, value in patch.items():
            if isinstance(value, dict) and isinstance(target.get(key), (dict, list)):
                target[key] = merge_live_state(target[key], value)
            else:
                target[key] = copy.deepcopy(value)
        return target
    return copy.deepcopy(patch)


# Position/CarData arrive roughly every second; ~7200 records covers a full
# race plus the overrun window before the oldest samples are dropped.
LIVE_STORE_MAX_Z_RECORDS = 7200


class LiveFeedStore:
    """In-memory state for one live session, fed by SignalRClient frames.

    Per feed it keeps both the (elapsed, payload) record list the stream
    normalizers consume (same shape as parse_livetiming_stream output) and a
    keyframe-equivalent merged state for stream=False consumers. Elapsed
    timestamps anchor at the subscribe snapshot's Heartbeat Utc, so
    derive_stream_start_utc over the stored Heartbeat records reproduces the
    anchor exactly as it would for a static stream."""

    def __init__(self, session_key, max_z_records=LIVE_STORE_MAX_Z_RECORDS):
        self.session_key = session_key
        self.max_z_records = max_z_records
        self.anchor_utc = None
        self._records = {}
        self._state = {}
        self._last_frame_at = None

    def on_frame(self, kind, frame):
        """SignalRClient callback; every frame, keepalives included, counts
        as connection liveness."""
        self._last_frame_at = time.monotonic()
        if kind == "snapshot":
            self._apply_snapshot(frame.get("feeds") or {})
        elif kind == "updates":
            for feed, payload, utc in frame.get("updates") or []:
                self._apply_update(feed, payload, utc)

    def _apply_snapshot(self, feeds):
        # A (re)subscribe snapshot resyncs everything: records and state are
        # replaced and the timeline re-anchored so elapsed offsets stay
        # internally consistent (missed deltas are harmless per the design).
        heartbeat = feeds.get("Heartbeat")
        anchor = parse_utc_datetime(heartbeat.get("Utc")) if isinstance(heartbeat, dict) else None
        if anchor is None:
            anchor = datetime.now(timezone.utc)
        self.anchor_utc = format_utc(anchor)
        self._records = {feed: [("00:00:00.000", payload)] for feed, payload in feeds.items()}
        self._state = {
            feed: copy.deepcopy(payload)
            for feed, payload in feeds.items()
            if isinstance(payload, (dict, list))
        }

    def _apply_update(self, feed, payload, utc):
        if isinstance(payload, dict):
            state = self._state.get(feed)
            if isinstance(state, (dict, list)):
                self._state[feed] = merge_live_state(state, payload)
            else:
                self._state[feed] = copy.deepcopy(payload)
        if self.anchor_utc is None:
            # Updates can precede the subscribe reply; anchor at the first
            # sighted timestamp so the stream stays usable.
            self.anchor_utc = format_utc(parse_utc_datetime(utc) or datetime.now(timezone.utc))
        record = record_from_update(payload, utc, self.anchor_utc)
        if record is None:
            return
        records = self._records.setdefault(feed, [])
        records.append(record)
        if feed.endswith(".z") and len(records) > self.max_z_records:
            del records[: len(records) - self.max_z_records]

    def age_seconds(self):
        if self._last_frame_at is None:
            return None
        return time.monotonic() - self._last_frame_at

    def is_fresh(self, max_age_seconds):
        age = self.age_seconds()
        return age is not None and age < max_age_seconds

    def get_records(self, feed):
        records = self._records.get(feed)
        return list(records) if records else None

    def get_state(self, feed):
        state = self._state.get(feed)
        return copy.deepcopy(state) if state is not None else None


class SignalRClient:
    """Connects to the hub and forwards classified events to a callback.

    The callback receives (kind, data) tuples matching parse_core_frame
    output. Reconnects with exponential backoff; the Subscribe completion
    after a reconnect carries a fresh snapshot, so missed deltas are
    harmless. An optional F1 TV bearer token unlocks the premium feeds
    (CarData.z, Position.z); the core feeds work anonymously.
    """

    def __init__(self, feeds=None, http_client=None, access_token=None):
        self.feeds = list(feeds or DEFAULT_FEEDS)
        self.access_token = access_token
        self._http_client = http_client
        self._stopped = asyncio.Event()

    def stop(self):
        self._stopped.set()

    async def negotiate(self):
        client = self._http_client or httpx.AsyncClient(timeout=15.0)
        owns_client = self._http_client is None
        try:
            headers = {"User-Agent": "BestHTTP"}
            if self.access_token:
                headers["Authorization"] = f"Bearer {self.access_token}"
            response = await client.post(SIGNALRCORE_NEGOTIATE_URL, headers=headers)
            response.raise_for_status()
            data = response.json()
            token = data.get("connectionToken") or data.get("connectionId")
            if not token:
                raise ValueError("SignalR negotiate reply carried no connectionToken")
            # The AWSALB cookie pins the websocket to the negotiating server;
            # without it the connection id is unknown to the node that answers
            cookie = "; ".join(f"{c.name}={c.value}" for c in response.cookies.jar)
            return token, cookie, data
        finally:
            if owns_client:
                await client.aclose()

    def build_connect_url(self, connection_token):
        url = f"{SIGNALRCORE_WS_URL}?id={quote(connection_token, safe='')}"
        if self.access_token:
            url += f"&access_token={quote(self.access_token, safe='')}"
        return url

    async def run(self, on_frame):
        if websockets is None:
            raise RuntimeError("the websockets package is required for SignalR live mode")

        delay = RECONNECT_BASE_DELAY_SECONDS
        while not self._stopped.is_set():
            try:
                token, cookie, _negotiate_data = await self.negotiate()
                headers = {"User-Agent": "BestHTTP", "Accept-Encoding": "gzip,identity"}
                if cookie:
                    headers["Cookie"] = cookie
                async with websockets.connect(
                    self.build_connect_url(token), additional_headers=headers, max_size=None
                ) as socket:
                    await socket.send(build_core_handshake_message())
                    ack_raw = await asyncio.wait_for(socket.recv(), timeout=15.0)
                    for event in parse_core_frame(ack_raw):
                        if event["type"] == "other" and event.get("frame", {}).get("error"):
                            raise ValueError(f"SignalR handshake rejected: {event['frame']['error']}")
                    await socket.send(build_core_subscribe_message(self.feeds))
                    delay = RECONNECT_BASE_DELAY_SECONDS  # healthy connection
                    last_activity = time.monotonic()
                    last_ping = time.monotonic()
                    while not self._stopped.is_set():
                        now = time.monotonic()
                        if now - last_ping >= PING_INTERVAL_SECONDS:
                            # The server drops clients that stay silent
                            await socket.send(build_core_ping_message())
                            last_ping = now
                        try:
                            raw = await asyncio.wait_for(
                                socket.recv(), timeout=PING_INTERVAL_SECONDS / 2
                            )
                        except asyncio.TimeoutError:
                            if time.monotonic() - last_activity > RECEIVE_IDLE_TIMEOUT_SECONDS:
                                raise TimeoutError("SignalR hub went silent")
                            continue
                        last_activity = time.monotonic()
                        try:
                            events = parse_core_frame(raw)
                        except ValueError as e:
                            logger.warning(f"Dropping SignalR frame: {e}")
                            continue
                        for event in events:
                            result = on_frame(event["type"], event)
                            if asyncio.iscoroutine(result):
                                await result
            except asyncio.CancelledError:
                raise
            except Exception as e:
                if self._stopped.is_set():
                    return
                logger.warning(f"SignalR connection lost ({e}); reconnecting in {delay:.0f}s")
                try:
                    await asyncio.wait_for(self._stopped.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass
                delay = min(delay * 2, RECONNECT_MAX_DELAY_SECONDS)


async def _record(path):
    """Capture raw classified traffic to JSONL — run during a live session to
    collect real fixtures for the integration step."""
    count = 0

    def write_frame(kind, data):
        nonlocal count
        count += 1
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": kind, "data": data.get("feeds") or data.get("updates")}) + "\n")
        if count % 50 == 0:
            logger.info(f"recorded {count} frames")

    client = SignalRClient()
    logger.info(f"Recording SignalR traffic to {path} — Ctrl-C to stop")
    await client.run(write_frame)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if len(sys.argv) >= 3 and sys.argv[1] == "record":
        asyncio.run(_record(sys.argv[2]))
    else:
        print("usage: python livetiming_signalr.py record <out.jsonl>")
