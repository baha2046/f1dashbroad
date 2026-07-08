"""Client primitives for the Livetiming SignalR hub (legacy protocol 1.5).

Protocol details in doc/2026-07-08-signalr-live-mode-design.md. This module
covers negotiation, subscription and message classification plus a recording
CLI; wiring the live store into the cache layer happens behind the
F1_LIVE_SIGNALR flag once the classifier has been validated against a real
live session.
"""

import asyncio
import json
import logging
import sys
from datetime import timedelta
from urllib.parse import quote, urlencode

import httpx

from livetiming_compat import parse_utc_datetime

logger = logging.getLogger("f1_dashboard.signalr")

SIGNALR_BASE = "https://livetiming.formula1.com/signalr"
SIGNALR_WS_BASE = "wss://livetiming.formula1.com/signalr"
CONNECTION_DATA = json.dumps([{"name": "Streaming"}])
CLIENT_PROTOCOL = "1.5"

# Feeds live mode consumes; identical names to the static-feed manifests
DEFAULT_FEEDS = [
    "Heartbeat",
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


def build_negotiate_url():
    query = urlencode({
        "connectionData": CONNECTION_DATA,
        "clientProtocol": CLIENT_PROTOCOL,
    })
    return f"{SIGNALR_BASE}/negotiate?{query}"


def build_connect_url(connection_token):
    query = urlencode({
        "transport": "webSockets",
        "clientProtocol": CLIENT_PROTOCOL,
        "connectionToken": connection_token,
        "connectionData": CONNECTION_DATA,
    }, quote_via=quote)
    return f"{SIGNALR_WS_BASE}/connect?{query}"


def build_subscribe_message(feeds=None, invocation_id=1):
    return json.dumps({
        "H": "Streaming",
        "M": "Subscribe",
        "A": [list(feeds or DEFAULT_FEEDS)],
        "I": invocation_id,
    })


def classify_signalr_frame(raw_text):
    """Classify one websocket text frame.

    Returns one of:
      {"type": "snapshot", "feeds": {feed: payload}}          — subscribe reply (R)
      {"type": "updates", "updates": [(feed, payload, utc)]}  — hub deltas (M)
      {"type": "keepalive"}                                   — empty frame
      {"type": "other", "frame": <parsed>}                    — anything else
    Raises ValueError on non-JSON frames.
    """
    text = (raw_text or "").strip()
    if not text:
        return {"type": "keepalive"}
    try:
        frame = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Unparseable SignalR frame: {text[:80]!r}") from e
    if not isinstance(frame, dict) or not frame:
        return {"type": "keepalive"} if frame == {} else {"type": "other", "frame": frame}

    if isinstance(frame.get("R"), dict):
        return {"type": "snapshot", "feeds": frame["R"]}

    messages = frame.get("M")
    if isinstance(messages, list):
        updates = []
        for message in messages:
            if not isinstance(message, dict) or message.get("M") != "feed":
                continue
            args = message.get("A")
            if not isinstance(args, list) or len(args) < 2:
                continue
            feed_name = args[0]
            payload = args[1]
            utc = args[2] if len(args) > 2 else None
            updates.append((feed_name, payload, utc))
        if updates:
            return {"type": "updates", "updates": updates}
        return {"type": "keepalive"}

    return {"type": "other", "frame": frame}


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


class SignalRClient:
    """Connects to the hub and forwards classified frames to a callback.

    The callback receives (kind, data) tuples matching classify_signalr_frame
    output. Reconnects with exponential backoff; the subscribe reply after a
    reconnect carries a fresh snapshot, so missed deltas are harmless.
    """

    def __init__(self, feeds=None, http_client=None):
        self.feeds = list(feeds or DEFAULT_FEEDS)
        self._http_client = http_client
        self._stopped = asyncio.Event()

    def stop(self):
        self._stopped.set()

    async def negotiate(self):
        client = self._http_client or httpx.AsyncClient(timeout=15.0)
        owns_client = self._http_client is None
        try:
            response = await client.get(build_negotiate_url(), headers={"User-Agent": "BestHTTP"})
            response.raise_for_status()
            data = response.json()
            token = data.get("ConnectionToken")
            if not token:
                raise ValueError("SignalR negotiate reply carried no ConnectionToken")
            cookie = "; ".join(f"{c.name}={c.value}" for c in response.cookies.jar)
            return token, cookie, data
        finally:
            if owns_client:
                await client.aclose()

    async def run(self, on_frame):
        import websockets

        delay = RECONNECT_BASE_DELAY_SECONDS
        while not self._stopped.is_set():
            try:
                token, cookie, negotiate_data = await self.negotiate()
                headers = {"User-Agent": "BestHTTP", "Accept-Encoding": "gzip,identity"}
                if cookie:
                    headers["Cookie"] = cookie
                keepalive = float(negotiate_data.get("KeepAliveTimeout") or 20.0)
                async with websockets.connect(
                    build_connect_url(token), additional_headers=headers, max_size=None
                ) as socket:
                    await socket.send(build_subscribe_message(self.feeds))
                    delay = RECONNECT_BASE_DELAY_SECONDS  # healthy connection
                    while not self._stopped.is_set():
                        raw = await asyncio.wait_for(socket.recv(), timeout=keepalive * 2)
                        try:
                            classified = classify_signalr_frame(raw)
                        except ValueError as e:
                            logger.warning(f"Dropping SignalR frame: {e}")
                            continue
                        result = on_frame(classified["type"], classified)
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
