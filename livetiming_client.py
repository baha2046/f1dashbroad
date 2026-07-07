import asyncio
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
    # splitlines() tolerates CRLF/LF variance from upstream or local fixtures
    records = []
    for line in text.splitlines():
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
    # Full-session streams run to tens of MB of line-delimited JSON; parse
    # off the event loop
    text = await fetch_livetiming_text(client, path)
    return await asyncio.to_thread(parse_livetiming_stream, text)


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
