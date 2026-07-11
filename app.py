import logging
import os
import re
import secrets
import gzip
import json
import asyncio
import tempfile
import weakref
import httpx
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

from quart import Quart, g, render_template, jsonify, request

from livetiming_client import (
    fetch_livetiming_json,
    fetch_livetiming_stream,
    resolve_livetiming_session_ref,
)
from livetiming_compat import (
    align_stints_with_lap_runs,
    derive_session_started_utc,
    derive_stream_start_utc,
    flatten_car_data_z,
    flatten_position_z,
    normalize_livetiming_drivers,
    normalize_livetiming_intervals,
    normalize_livetiming_laps,
    normalize_livetiming_meeting,
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("f1_dashboard")

app = Quart(__name__)

PUBLIC_BASE_URL = os.environ.get("F1_PUBLIC_BASE_URL", "https://f1.nagoya-jp.me").rstrip("/")

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
HTTP_429_MAX_RETRIES = 3
HTTP_429_BASE_DELAY_SECONDS = 1.0
HTTP_429_MAX_DELAY_SECONDS = 10.0

DATE_PARAM_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

CACHE_MAX_BYTES = int(os.environ.get("F1_CACHE_MAX_MB", "512")) * 1024 * 1024
GZIP_MIN_BYTES = 1024

TELEMETRY_MAX_POINTS = 700
REPLAY_MAX_POINTS_PER_DRIVER = 400
# Cap explicit start/end replay windows (full-session slices are ~2 min;
# the cap only guards against runaway requests)
REPLAY_WINDOW_MAX_SECONDS = 1800

LIVE_CACHE_TTL_SECONDS = 30
LIVE_SESSION_OVERRUN_SECONDS = 1800  # sessions (especially races) overrun date_end

def current_season_year():
    return datetime.now(timezone.utc).year

def parse_int_param(value):
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None

def invalid_param_response(name):
    return jsonify({"error": f"{name} is required and must be an integer"}), 400

def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

# Shared HTTP client (connection pooling); created lazily, closed on shutdown
_http_client = None

def get_http_client():
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client

def _evict_cache_if_over_limit():
    entries = []
    total_bytes = 0
    for name in os.listdir(CACHE_DIR):
        path = os.path.join(CACHE_DIR, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        if not os.path.isfile(path):
            continue
        entries.append((st.st_mtime, st.st_size, path))
        total_bytes += st.st_size

    logger.info(
        f"data_cache: {len(entries)} files, {total_bytes / (1024 * 1024):.1f} MB "
        f"(limit {CACHE_MAX_BYTES / (1024 * 1024):.0f} MB)"
    )
    if total_bytes <= CACHE_MAX_BYTES:
        return

    entries.sort()  # oldest mtime first; evicted files are simply refetched on demand
    removed = 0
    for _mtime, size, path in entries:
        if total_bytes <= CACHE_MAX_BYTES:
            break
        try:
            os.unlink(path)
        except OSError:
            continue
        total_bytes -= size
        removed += 1
    logger.info(f"data_cache eviction: removed {removed} files, now {total_bytes / (1024 * 1024):.1f} MB")

CACHE_EVICTION_INTERVAL_SECONDS = 3600
_cache_maintenance_task = None

async def _periodic_cache_maintenance():
    # Live weekends generate replay-window and raw-feed files continuously;
    # a startup-only eviction pass would let a long-running server overshoot
    while True:
        await asyncio.sleep(CACHE_EVICTION_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(_evict_cache_if_over_limit)
        except Exception as e:
            logger.warning(f"Cache eviction pass failed: {e}")

@app.before_serving
async def _startup_cache_maintenance():
    global _cache_maintenance_task
    await asyncio.to_thread(_evict_cache_if_over_limit)
    _cache_maintenance_task = asyncio.ensure_future(_periodic_cache_maintenance())

@app.after_serving
async def _stop_cache_maintenance():
    global _cache_maintenance_task
    if _cache_maintenance_task is not None:
        _cache_maintenance_task.cancel()
        _cache_maintenance_task = None

# All scripts are external files, so script-src stays strict; style-src needs
# 'unsafe-inline' for the template's inline styles; img-src allows any https
# host (F1 media CDN + circuit map sources); media-src covers team radio mp3s.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' {script_nonce}",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src https://livetiming.formula1.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
])

@app.before_request
async def _create_content_security_nonce():
    g.csp_nonce = secrets.token_urlsafe(16)

@app.after_request
async def _api_response_headers(response):
    if not request.path.startswith("/api/"):
        if (response.content_type or "").startswith("text/html"):
            nonce_source = f"'nonce-{g.csp_nonce}'"
            response.headers.setdefault(
                "Content-Security-Policy",
                CONTENT_SECURITY_POLICY.format(script_nonce=nonce_source),
            )
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    response.headers.setdefault("Cache-Control", "public, max-age=60")
    response.headers["Vary"] = "Accept-Encoding"

    accepts_gzip = "gzip" in (request.headers.get("Accept-Encoding") or "").lower()
    if response.status_code == 200 and accepts_gzip and "Content-Encoding" not in response.headers:
        body = await response.get_data(as_text=False)
        if len(body) >= GZIP_MIN_BYTES:
            compressed = await asyncio.to_thread(gzip.compress, body, 6)
            if len(compressed) < len(body):
                response.set_data(compressed)
                response.headers["Content-Encoding"] = "gzip"
    return response

@app.after_serving
async def _close_http_client():
    global _http_client
    if _http_client is not None:
        if not _http_client.is_closed:
            await _http_client.aclose()
        _http_client = None

# Per-cache-file fetch locks, scoped per event loop so tests with fresh
# loops don't collide. Prevents cache stampedes: only one request fetches
# an uncached key while the rest wait and read the fresh cache.
_cache_locks_by_loop = weakref.WeakKeyDictionary()

def get_cache_lock(cache_path):
    loop = asyncio.get_running_loop()
    locks = _cache_locks_by_loop.get(loop)
    if locks is None:
        locks = {}
        _cache_locks_by_loop[loop] = locks
    lock = locks.get(cache_path)
    if lock is None:
        lock = asyncio.Lock()
        locks[cache_path] = lock
    return lock

def _read_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def cache_age_seconds(cache_path):
    try:
        return datetime.now().timestamp() - os.path.getmtime(cache_path)
    except OSError:
        return None

async def read_cache(cache_path, ttl=None):
    """Return cached data if present and within ttl (ttl=None: no expiry)."""
    age = cache_age_seconds(cache_path)
    if age is None:
        return None
    if ttl is not None and age >= ttl:
        return None
    return await asyncio.to_thread(_read_json_file, cache_path)

async def read_stale_cache(cache_path):
    if not os.path.exists(cache_path):
        return None
    return await asyncio.to_thread(_read_json_file, cache_path)

def _write_json_file_atomic(cache_path, data):
    fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(cache_path), prefix=".cache-", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp_path, cache_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

async def write_cache(cache_path, data):
    try:
        await asyncio.to_thread(_write_json_file_atomic, cache_path, data)
    except Exception as e:
        logger.warning(f"Error writing cache {cache_path}: {e}")

def _read_gzip_json(path):
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def _write_gzip_json_atomic(cache_path, data):
    fd, tmp_path = tempfile.mkstemp(
        dir=os.path.dirname(cache_path), prefix=".cache-", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6) as gz:
                gz.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
        os.replace(tmp_path, cache_path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

async def read_gzip_cache(cache_path, ttl=None):
    age = cache_age_seconds(cache_path)
    if age is None:
        return None
    if ttl is not None and age >= ttl:
        return None
    return await asyncio.to_thread(_read_gzip_json, cache_path)

def _scan_cached_sessions_for_year(skey):
    for filename in os.listdir(CACHE_DIR):
        if filename.startswith("sessions_") and filename.endswith(".json"):
            sessions = _read_json_file(os.path.join(CACHE_DIR, filename))
            if not isinstance(sessions, list):
                continue
            for s in sessions:
                if s.get("session_key") == skey:
                    return s.get("year")
    return None

async def find_session_year(session_key):
    try:
        skey = int(session_key)
    except (TypeError, ValueError):
        return current_season_year()

    year = await asyncio.to_thread(_scan_cached_sessions_for_year, skey)
    return year if year is not None else current_season_year()

async def get_f1api_drivers(year):
    url = f"https://f1api.dev/api/{year}/drivers"
    cache_path = os.path.join(CACHE_DIR, f"f1api_drivers_{year}.json")

    ttl = None if int(year) < current_season_year() else 86400  # past years cached permanently

    cached = await read_cache(cache_path, ttl)
    if cached is not None:
        return cached

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl)
        if cached is not None:
            return cached
        try:
            client = get_http_client()
            response = await client.get(url, timeout=10.0)
            response.raise_for_status()
            drivers = response.json().get("drivers", [])
            await write_cache(cache_path, drivers)
            return drivers
        except Exception as e:
            logger.warning(f"Error fetching f1api drivers: {e}")
            stale = await read_stale_cache(cache_path)
            return stale if stale is not None else []

# Helper to load cached sessions
def get_session_info(session_key, year=None):
    if year is None:
        year = current_season_year()
    sessions_file = os.path.join(CACHE_DIR, f"sessions_{year}.json")
    sessions = _read_json_file(sessions_file)
    if isinstance(sessions, list):
        for s in sessions:
            if s.get("session_key") == int(session_key):
                return s
    return None

def is_historical(session):
    if not session:
        return False

    year = session.get("year")
    if year is not None and year < current_season_year():
        return True

    date_end_str = session.get("date_end")
    if not date_end_str:
        return False
    try:
        # Parse ISO date and compare with current time in UTC
        date_end = datetime.fromisoformat(date_end_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return (now - date_end).total_seconds() > 86400  # More than 24 hours ago is historical
    except Exception:
        return False

def is_session_live(session, now=None):
    """A session is live from date_start until date_end plus an overrun buffer."""
    if not session or session.get("is_cancelled"):
        return False

    start = parse_iso_utc(session.get("date_start"))
    end = parse_iso_utc(session.get("date_end"))
    if start is None or end is None:
        return False

    if now is None:
        now = datetime.now(timezone.utc)
    return start <= now <= end + timedelta(seconds=LIVE_SESSION_OVERRUN_SECONDS)

class UpstreamAPIError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code

class DegradedPayload:
    """Wraps a fetcher result built from fallback data (keyframe snapshot or
    missing stream anchor): usable now, but never cached permanently."""
    __slots__ = ("data",)

    def __init__(self, data):
        self.data = data

def get_retry_delay(response, retry_index):
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return min(float(retry_after), HTTP_429_MAX_DELAY_SECONDS)
        except ValueError:
            pass
    return min(HTTP_429_BASE_DELAY_SECONDS * (2 ** retry_index), HTTP_429_MAX_DELAY_SECONDS)

async def fetch_url(url: str):
    client = get_http_client()
    response = None
    for retry_index in range(HTTP_429_MAX_RETRIES + 1):
        response = await client.get(url, timeout=15.0)
        if response.status_code != 429 or retry_index == HTTP_429_MAX_RETRIES:
            break
        delay = get_retry_delay(response, retry_index)
        await asyncio.sleep(delay)

    response.raise_for_status()
    return response.json()

async def session_cache_ttl(session_key, year=None):
    """Cache TTL for session-scoped data: 30 s live, 5 min recent, permanent historical."""
    session = await asyncio.to_thread(get_session_info, session_key, year) if session_key else None
    if session is not None and is_session_live(session):
        return LIVE_CACHE_TTL_SECONDS
    if not session or not is_historical(session):
        return 300
    return None

async def get_cached_livetiming(cache_name: str, fetcher, session_key=None, year=None):
    cache_path = os.path.join(CACHE_DIR, cache_name)
    if year is None:
        year = current_season_year()

    if "sessions" in cache_name:
        ttl = 3600 if int(year) >= current_season_year() else None
    else:
        ttl = await session_cache_ttl(session_key, year)

    cached = await read_cache(cache_path, ttl)
    if cached is not None:
        return cached

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl)
        if cached is not None:
            return cached
        try:
            data = await fetcher()
        except Exception as e:
            logger.warning(f"Error fetching Livetiming data for {cache_name}: {e}")
            stale = await read_stale_cache(cache_path)
            if stale is not None:
                return stale
            raise UpstreamAPIError(f"Upstream API request failed for {cache_name}")
        degraded = isinstance(data, DegradedPayload)
        if degraded:
            data = data.data
        # Degraded payloads may only live under a TTL that retires them; a
        # permanent (historical) cache entry must come from real stream data
        if not degraded or ttl is not None:
            await write_cache(cache_path, data)
        return data

async def fetch_livetiming_year_index(year):
    client = get_http_client()
    return await fetch_livetiming_json(client, f"{int(year)}/Index.json")

async def fetch_livetiming_session_index(session_path):
    client = get_http_client()
    return await fetch_livetiming_json(client, urljoin(session_path, "Index.json"))

async def fetch_livetiming_feed(session_path, feed_name, stream=True, meta=None):
    """Fetch a feed's stream (or keyframe). When a requested stream falls back
    to its keyframe snapshot, meta["degraded"] is set so callers can avoid
    caching the snapshot permanently."""
    session_index = await fetch_livetiming_session_index(session_path)
    feed = (session_index.get("Feeds") or {}).get(feed_name)
    if not feed:
        raise UpstreamAPIError(f"Livetiming feed {feed_name} is unavailable")
    client = get_http_client()
    if stream:
        stream_path = feed.get("StreamPath")
        if stream_path:
            try:
                return await fetch_livetiming_stream(client, urljoin(session_path, stream_path))
            except Exception:
                if meta is not None:
                    meta["degraded"] = True
    keyframe_path = feed.get("KeyFramePath")
    if not keyframe_path:
        raise UpstreamAPIError(f"Livetiming feed {feed_name} has no keyframe path")
    return await fetch_livetiming_json(client, urljoin(session_path, keyframe_path))

RAW_FEED_SAFE_RE = re.compile(r"[^A-Za-z0-9_-]")

async def fetch_livetiming_feed_cached(session_key, session_path, feed_name, stream=True, year=None, meta=None):
    """Disk-backed raw feed fetch: one upstream download per session+feed
    serves every normalized endpoint, telemetry lap and replay window derived
    from it. Stored gzipped; TTL follows the session's liveness."""
    variant = "stream" if stream else "keyframe"
    safe_feed = RAW_FEED_SAFE_RE.sub("_", feed_name)
    cache_path = os.path.join(CACHE_DIR, f"raw_{session_key}_{safe_feed}_{variant}.json.gz")
    ttl = await session_cache_ttl(session_key, year)

    def unpack(cached):
        if not isinstance(cached, dict) or "records" not in cached:
            return None
        if meta is not None and cached.get("degraded"):
            meta["degraded"] = True
        return cached["records"]

    cached = unpack(await read_gzip_cache(cache_path, ttl))
    if cached is not None:
        return cached

    async with get_cache_lock(cache_path):
        cached = unpack(await read_gzip_cache(cache_path, ttl))
        if cached is not None:
            return cached
        fetch_meta = {}
        data = await fetch_livetiming_feed(session_path, feed_name, stream=stream, meta=fetch_meta)
        degraded = bool(fetch_meta.get("degraded"))
        if meta is not None and degraded:
            meta["degraded"] = True
        # A keyframe snapshot standing in for a stream must not become the
        # permanent copy for a historical session — retry on the next request
        if not degraded or ttl is not None:
            try:
                await asyncio.to_thread(
                    _write_gzip_json_atomic, cache_path, {"degraded": degraded, "records": data}
                )
            except Exception as e:
                logger.warning(f"Error writing raw feed cache {cache_path}: {e}")
        return data

def find_livetiming_meeting(year_index, meeting_key):
    target = str(meeting_key)
    for meeting in year_index.get("Meetings") or []:
        if str(meeting.get("Key")) == target:
            return meeting
    return None

# Stream elapsed timestamps count from when the Livetiming recording began,
# not the advertised session start; the Heartbeat feed pins that instant to
# UTC. The anchor never changes for a given session, so memoize it.
_stream_start_cache = {}

async def fetch_livetiming_stream_start(session_key, session_path, fallback=None, year=None, meta=None):
    if session_path in _stream_start_cache:
        return _stream_start_cache[session_path]
    anchor = None
    try:
        records = await fetch_livetiming_feed_cached(
            session_key, session_path, "Heartbeat", stream=True, year=year
        )
        anchor = derive_stream_start_utc(ensure_livetiming_records(records))
    except Exception as e:
        logger.warning(f"Error deriving Livetiming stream start for {session_path}: {e}")
    if anchor:
        _stream_start_cache[session_path] = anchor
        return anchor
    # The advertised session start is not the stream anchor; timestamps
    # derived from it are approximations, so mark the payload degraded
    if meta is not None:
        meta["degraded"] = True
    return fallback

async def resolve_livetiming_session_path(session_key, year=None):
    if year is None:
        year = await find_session_year(session_key)
    session = await asyncio.to_thread(get_session_info, session_key, year)
    if session and session.get("path"):
        return session["path"], year

    year_index = await fetch_livetiming_year_index(year)
    ref = resolve_livetiming_session_ref(year_index, int(year), session_key)
    if ref is None or not ref.path:
        raise UpstreamAPIError(f"Livetiming session {session_key} was not found", 404)
    return ref.path, year

async def get_cached_circuit_info(url: str, cache_name: str):
    cache_path = os.path.join(CACHE_DIR, cache_name)
    cached = await read_cache(cache_path)
    if cached is not None:
        return cached

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path)
        if cached is not None:
            return cached
        try:
            client = get_http_client()
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            response = await client.get(url, headers=headers, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            await write_cache(cache_path, data)
            return data
        except Exception as e:
            logger.warning(f"Error fetching circuit info from {url}: {e}")
            return await read_stale_cache(cache_path)

async def get_cached_jolpica_api(url: str, cache_name: str, year=None):
    cache_path = os.path.join(CACHE_DIR, cache_name)
    if year is None:
        year = current_season_year()
    ttl = None if int(year) < current_season_year() else 3600

    cached = await read_cache(cache_path, ttl)
    if cached is not None:
        return cached

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl)
        if cached is not None:
            return cached
        try:
            data = await fetch_url(url)
        except Exception as e:
            logger.warning(f"Error fetching Jolpica data from {url}: {e}")
            stale = await read_stale_cache(cache_path)
            if stale is not None:
                return stale
            raise UpstreamAPIError(f"Upstream API request failed for {cache_name}")
        await write_cache(cache_path, data)
        return data

def extract_jolpica_races(data):
    return (
        data.get("MRData", {})
        .get("RaceTable", {})
        .get("Races", [])
        if isinstance(data, dict)
        else []
    )

def extract_jolpica_standings(data, standings_key):
    if not isinstance(data, dict):
        return []
    standings_lists = (
        data.get("MRData", {})
        .get("StandingsTable", {})
        .get("StandingsLists", [])
    )
    if not standings_lists:
        return []
    return standings_lists[0].get(standings_key, [])

def extract_jolpica_constructors(data):
    if not isinstance(data, dict):
        return []
    constructors = (
        data.get("MRData", {})
        .get("ConstructorTable", {})
        .get("Constructors", [])
    )
    return constructors if isinstance(constructors, list) else []

def race_matches_date(race, target_date):
    if race.get("date") == target_date:
        return True

    session_keys = (
        "FirstPractice",
        "SecondPractice",
        "ThirdPractice",
        "Qualifying",
        "Sprint",
        "SprintQualifying",
    )
    return any(
        isinstance(race.get(key), dict) and race[key].get("date") == target_date
        for key in session_keys
    )

def find_jolpica_race_by_date(races, target_date):
    for race in races:
        if race_matches_date(race, target_date):
            return race
    return None

JOLPICA_SCHEDULE_SESSION_KEYS = (
    ("FirstPractice", "Practice 1"),
    ("SecondPractice", "Practice 2"),
    ("ThirdPractice", "Practice 3"),
    ("SprintQualifying", "Sprint Qualifying"),
    ("Sprint", "Sprint"),
    ("Qualifying", "Qualifying"),
)

def normalize_jolpica_schedule(races):
    schedule = []
    for race in races if isinstance(races, list) else []:
        if not isinstance(race, dict):
            continue
        circuit = race.get("Circuit") or {}
        location = circuit.get("Location") or {}
        sessions = []
        for key, name in JOLPICA_SCHEDULE_SESSION_KEYS:
            entry = race.get(key)
            if isinstance(entry, dict) and entry.get("date"):
                sessions.append({
                    "name": name,
                    "date": entry.get("date"),
                    "time": entry.get("time"),
                })
        if race.get("date"):
            sessions.append({
                "name": "Race",
                "date": race.get("date"),
                "time": race.get("time"),
            })
        sessions.sort(key=lambda s: (s.get("date") or "", s.get("time") or ""))
        schedule.append({
            "round": parse_int_param(race.get("round")),
            "race_name": race.get("raceName"),
            "circuit_name": circuit.get("circuitName"),
            "locality": location.get("locality"),
            "country": location.get("country"),
            "date": race.get("date"),
            "time": race.get("time"),
            "sessions": sessions,
        })
    return schedule

@app.errorhandler(UpstreamAPIError)
async def handle_upstream_api_error(error):
    return jsonify({
        "error": "upstream_error",
        "detail": error.message
    }), error.status_code

@app.route("/api/meetings")
async def api_meetings():
    meeting_key = parse_int_param(request.args.get("meeting_key"))
    if meeting_key is None:
        return invalid_param_response("meeting_key")

    year = request.args.get("year")
    if year is not None:
        year = parse_int_param(year)
        if year is None:
            return invalid_param_response("year")
    else:
        year = current_season_year()

    cache_name = f"meetings_{meeting_key}_{year}.json"

    async def fetch_meeting():
        year_index = await fetch_livetiming_year_index(year)
        meeting = find_livetiming_meeting(year_index, meeting_key)
        if not meeting:
            raise UpstreamAPIError("Meeting not found", 404)
        return {"meeting": normalize_livetiming_meeting(meeting, year)}

    data = await get_cached_livetiming(cache_name, fetch_meeting, year=year)
    meeting = data.get("meeting") if isinstance(data, dict) else None

    # Track layout/corner map for the Circuit tab and replay outline; the
    # MultiViewer API keys circuits by the same official F1 circuit key.
    circuit_info = None
    circuit_key = (meeting or {}).get("circuit_key")
    if circuit_key is not None:
        circuit_info = await get_cached_circuit_info(
            f"https://api.multiviewer.app/api/v1/circuits/{circuit_key}/{year}",
            f"circuit_info_{circuit_key}_{year}.json",
        )

    return jsonify({
        "meeting": meeting,
        "circuit_info": circuit_info,
    })

@app.route("/")
async def index():
    return await render_template(
        "index.html",
        version=datetime.timestamp(datetime.now()),
        public_base_url=PUBLIC_BASE_URL,
        csp_nonce=g.csp_nonce,
    )


@app.route("/robots.txt")
async def robots_txt():
    body = f"User-agent: *\nAllow: /\nSitemap: {PUBLIC_BASE_URL}/sitemap.xml\n"
    return body, 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.route("/sitemap.xml")
async def sitemap_xml():
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{PUBLIC_BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n"
        "</urlset>\n"
    )
    return body, 200, {"Content-Type": "application/xml; charset=utf-8"}


# The Livetiming root index only lists the current season, so seasons are
# probed individually; the archive is irregular (e.g. 2022 is missing).
YEARS_PROBE_FLOOR = 2018

@app.route("/api/years")
async def api_years():
    cache_path = os.path.join(CACHE_DIR, "years_available.json")
    cached = await read_cache(cache_path, ttl=86400)
    if cached:
        return jsonify(cached)

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl=86400)
        if cached:
            return jsonify(cached)

        current = current_season_year()
        # current + 1 lets the next season appear as soon as Livetiming does
        candidates = list(range(current + 1, YEARS_PROBE_FLOOR - 1, -1))
        semaphore = asyncio.Semaphore(4)

        async def probe(year):
            async with semaphore:
                try:
                    index = await fetch_livetiming_year_index(year)
                    return year if index.get("Meetings") else None
                except Exception:
                    return None

        results = await asyncio.gather(*(probe(year) for year in candidates))
        years = [year for year in results if year is not None]
        if not years:
            stale = await read_stale_cache(cache_path)
            if stale is not None:
                return jsonify(stale)
            # Upstream unreachable and no cache: a sane offline default,
            # deliberately not cached so the next request re-probes
            return jsonify(list(range(current, current - 4, -1)))
        await write_cache(cache_path, years)
        return jsonify(years)

@app.route("/api/sessions")
async def api_sessions():
    year = parse_int_param(request.args.get("year", str(current_season_year())))
    if year is None:
        return invalid_param_response("year")
    cache_name = f"sessions_{year}.json"

    async def fetch_sessions():
        year_index = await fetch_livetiming_year_index(year)
        return normalize_livetiming_sessions(year_index, year)

    data = await get_cached_livetiming(cache_name, fetch_sessions, year=year)
    return jsonify(data)

@app.route("/api/schedule")
async def api_schedule():
    """Full season calendar from Jolpica — includes race weekends that have
    not happened yet, which the livetiming archive can't provide."""
    year = parse_int_param(request.args.get("year", str(current_season_year())))
    if year is None:
        return invalid_param_response("year")

    races_data = await get_cached_jolpica_api(
        f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json",
        f"jolpica_races_{year}.json",
        year=year,
    )
    return jsonify(normalize_jolpica_schedule(extract_jolpica_races(races_data)))

@app.route("/api/drivers")
async def api_drivers():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    cache_name = f"drivers_{session_key}.json"

    year = request.args.get("year")
    if year is not None:
        year = parse_int_param(year)
        if year is None:
            return invalid_param_response("year")
    else:
        year = await find_session_year(session_key)

    async def fetch_drivers():
        session_path, _year = await resolve_livetiming_session_path(session_key, year)
        driver_list = await fetch_livetiming_feed(session_path, "DriverList", stream=False)
        return normalize_livetiming_drivers(driver_list)

    livetiming_drivers = await get_cached_livetiming(
        cache_name,
        fetch_drivers,
        session_key=session_key,
        year=year,
    )

    f1api_drivers = await get_f1api_drivers(year)

    f1api_map = {}
    f1api_acronym_map = {}
    for d in f1api_drivers:
        num = d.get("number")
        if num is not None:
            f1api_map[int(num)] = d
        acronym = d.get("shortName")
        if acronym:
            f1api_acronym_map[acronym.upper()] = d

    if isinstance(livetiming_drivers, list):
        for d in livetiming_drivers:
            driver_number = d.get("driver_number")
            acronym = d.get("name_acronym")
            extra = None
            if driver_number is not None:
                extra = f1api_map.get(int(driver_number))
            if not extra and acronym:
                extra = f1api_acronym_map.get(acronym.upper())

            if extra:
                d["nationality"] = extra.get("nationality")
                d["birthday"] = extra.get("birthday")
                d["wiki_url"] = extra.get("url")
                d["driver_id"] = extra.get("driverId")

    return jsonify(livetiming_drivers)

# Session-scoped Livetiming endpoints that share identical handling.
# Cache file names stay "<route>_<session_key>.json" to preserve local caches.
LIVETIMING_SESSION_ENDPOINTS = {
    "weather": {"feed": "WeatherData", "normalizer": normalize_livetiming_weather},
    "pit": {"feed": "PitLaneTimeCollection", "normalizer": normalize_livetiming_pit},
    "position": {"feed": "TimingData", "normalizer": normalize_livetiming_position},
    "intervals": {"feed": "TimingData", "normalizer": normalize_livetiming_intervals},
    "race_control": {"feed": "RaceControlMessages", "normalizer": normalize_livetiming_race_control},
    "team_radio": {"feed": "TeamRadio", "normalizer": normalize_livetiming_team_radio, "needs_session_path": True},
    "session_status": {"feed": "SessionData", "normalizer": normalize_livetiming_session_status},
}

def ensure_livetiming_records(feed_data):
    return feed_data if isinstance(feed_data, list) else [(None, feed_data)]

def parse_optional_year_param():
    """Returns (year, error_response); year is None when the param is absent."""
    year = request.args.get("year")
    if year is None:
        return None, None
    year = parse_int_param(year)
    if year is None:
        return None, invalid_param_response("year")
    return year, None

def session_cache_control(session):
    if session and is_session_live(session):
        # Live mode polls every 30 s; intermediary caches must not satisfy it
        return "no-store"
    if session and is_historical(session):
        return "public, max-age=3600"
    return "public, max-age=60"

async def session_response(data, session_key, year=None):
    session = await asyncio.to_thread(get_session_info, session_key, year)
    response = jsonify(data)
    response.headers["Cache-Control"] = session_cache_control(session)
    return response

async def get_livetiming_session_payload(route_name, endpoint_config, session_key, year=None):
    cache_prefix = endpoint_config.get("cache_prefix", route_name)
    cache_name = f"{cache_prefix}_{session_key}.json"

    async def fetch_endpoint():
        resolved = year if year is not None else await find_session_year(session_key)
        session_path, resolved_year = await resolve_livetiming_session_path(session_key, resolved)
        session = await asyncio.to_thread(get_session_info, session_key, resolved_year)
        session_start = session.get("date_start") if session else None
        meta = {}
        stream_start = await fetch_livetiming_stream_start(
            session_key, session_path, fallback=session_start, year=resolved_year, meta=meta
        )
        feed_data = await fetch_livetiming_feed_cached(
            session_key,
            session_path,
            endpoint_config["feed"],
            stream=endpoint_config.get("stream", True),
            year=resolved_year,
            meta=meta,
        )
        records = ensure_livetiming_records(feed_data)
        normalizer = endpoint_config["normalizer"]
        if endpoint_config.get("needs_session_path"):
            payload = await asyncio.to_thread(
                normalizer,
                records,
                session_path,
                session_key=session_key,
                stream_start_utc=stream_start,
            )
        else:
            payload = await asyncio.to_thread(
                normalizer,
                records,
                session_key=session_key,
                stream_start_utc=stream_start,
            )
        return DegradedPayload(payload) if meta.get("degraded") else payload

    return await get_cached_livetiming(cache_name, fetch_endpoint, session_key=session_key, year=year)

def _make_session_endpoint(route_name, endpoint_config):
    async def handler():
        session_key = parse_int_param(request.args.get("session_key"))
        if session_key is None:
            return invalid_param_response("session_key")
        year, year_error = parse_optional_year_param()
        if year_error is not None:
            return year_error
        data = await get_livetiming_session_payload(route_name, endpoint_config, session_key, year=year)
        return await session_response(data, session_key, year=year)

    handler.__name__ = f"api_{route_name}"
    return handler

for _route_name, _endpoint_config in LIVETIMING_SESSION_ENDPOINTS.items():
    app.add_url_rule(f"/api/{_route_name}", view_func=_make_session_endpoint(_route_name, _endpoint_config))

# /api/results is bespoke: Livetiming TimingData carries the classification
# order but no championship points and no DNS/DSQ flags, so completed
# Race/Sprint results are enriched from Jolpica's official results.
RESULTS_ENDPOINT_CONFIG = {
    "feed": "TimingData",
    "normalizer": normalize_livetiming_results,
    "stream": False,
    "cache_prefix": "results_v2",
}

def merge_jolpica_results(rows, official_by_number):
    merged = []
    for row in rows:
        item = official_by_number.get(parse_int_param(row.get("driver_number"))) if isinstance(row, dict) else None
        if not item:
            merged.append(row)
            continue
        row = dict(row)
        position_text = str(item.get("positionText") or "")
        status = str(item.get("status") or "")
        row["points"] = parse_float(item.get("points"))
        row["dnf"] = position_text == "R"
        row["dsq"] = position_text in ("D", "E")
        row["dns"] = position_text == "W" or status == "Did not start"
        if status:
            row["status"] = status
        fastest = item.get("FastestLap")
        if isinstance(fastest, dict):
            row["fastest_lap"] = str(fastest.get("rank") or "") == "1"
            time = fastest.get("Time")
            row["fastest_lap_time"] = time.get("time") if isinstance(time, dict) else None
            row["fastest_lap_number"] = parse_int_param(fastest.get("lap"))
        merged.append(row)
    return merged

async def enrich_results_with_jolpica(rows, session_key, year=None):
    """Best-effort merge of official points/DNS/DSQ into Race/Sprint results;
    returns the rows unchanged when Jolpica has nothing (yet)."""
    if not isinstance(rows, list) or not rows:
        return rows
    if year is None:
        year = await find_session_year(session_key)
    session = await asyncio.to_thread(get_session_info, session_key, year)
    # Livetiming types Sprint sessions as "Race" (name "Sprint"), but accept
    # an explicit Sprint type too in case older seasons label them directly
    if not session or session.get("session_type") not in ("Race", "Sprint"):
        return rows

    date_token = str(session.get("date_start") or "")[:10]
    if not DATE_PARAM_RE.match(date_token):
        return rows
    is_sprint = (
        session.get("session_type") == "Sprint"
        or "sprint" in str(session.get("session_name") or "").lower()
    )
    endpoint = "sprint" if is_sprint else "results"
    try:
        races_data = await get_cached_jolpica_api(
            f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json",
            f"jolpica_races_{year}.json",
            year=year,
        )
        race = find_jolpica_race_by_date(extract_jolpica_races(races_data), date_token)
        if not race or not race.get("round"):
            return rows
        results_data = await get_cached_jolpica_api(
            f"https://api.jolpi.ca/ergast/f1/{year}/{race['round']}/{endpoint}/?format=json",
            f"jolpica_{endpoint}_{year}_{race['round']}.json",
            year=year,
        )
    except UpstreamAPIError:
        return rows

    result_races = extract_jolpica_races(results_data)
    items = (result_races[0].get("SprintResults" if is_sprint else "Results") or []) if result_races else []
    official_by_number = {}
    for item in items:
        number = parse_int_param(item.get("number"))
        if number is not None:
            official_by_number[number] = item
    if not official_by_number:
        return rows
    return merge_jolpica_results(rows, official_by_number)

@app.route("/api/results")
async def api_results():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")
    year, year_error = parse_optional_year_param()
    if year_error is not None:
        return year_error
    data = await get_livetiming_session_payload("results", RESULTS_ENDPOINT_CONFIG, session_key, year=year)
    data = await enrich_results_with_jolpica(data, session_key, year=year)
    return await session_response(data, session_key, year=year)

# Bumped to v2 when lap normalization fixed garage-polluted out-lap durations
# and pit-out flags landing on the in-lap; older laps_* files carry bad values
def laps_cache_name(session_key, driver_number=None):
    if driver_number is None:
        return f"laps_v2_{session_key}.json"
    return f"laps_v2_{session_key}_{driver_number}.json"

async def fetch_livetiming_laps_payload(session_key, driver_number=None, year=None):
    if year is None:
        year = await find_session_year(session_key)
    session_path, resolved_year = await resolve_livetiming_session_path(session_key, year)
    session = await asyncio.to_thread(get_session_info, session_key, resolved_year)
    session_start = session.get("date_start") if session else None
    meta = {}
    stream_start = await fetch_livetiming_stream_start(
        session_key, session_path, fallback=session_start, year=resolved_year, meta=meta
    )
    records = await fetch_livetiming_feed_cached(
        session_key, session_path, "TimingData", stream=True, year=resolved_year, meta=meta
    )

    # Race/Sprint lap 1 has no LastLapTime upstream; anchor it at the green
    # light so its window (and full-race replay) still works. Other session
    # types start lap 1 whenever each driver leaves the pits, so no anchor.
    race_start = None
    if session and session.get("session_type") in ("Race", "Sprint"):
        try:
            status_records = await fetch_livetiming_feed_cached(
                session_key, session_path, "SessionStatus", stream=True, year=resolved_year
            )
            race_start = derive_session_started_utc(
                ensure_livetiming_records(status_records), stream_start
            )
        except Exception as e:
            logger.warning(f"Error fetching Livetiming SessionStatus for {session_key}: {e}")

    laps = await asyncio.to_thread(
        normalize_livetiming_laps,
        ensure_livetiming_records(records),
        session_key=session_key,
        stream_start_utc=stream_start,
        race_start_utc=race_start,
    )
    if driver_number is not None:
        laps = [lap for lap in laps if lap.get("driver_number") == driver_number]
    return DegradedPayload(laps) if meta.get("degraded") else laps

@app.route("/api/laps")
async def api_laps():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")
    year, year_error = parse_optional_year_param()
    if year_error is not None:
        return year_error

    driver_number = request.args.get("driver_number")
    if driver_number is not None:
        driver_number = parse_int_param(driver_number)
        if driver_number is None:
            return invalid_param_response("driver_number")
    cache_name = laps_cache_name(session_key, driver_number)

    data = await get_cached_livetiming(
        cache_name,
        lambda: fetch_livetiming_laps_payload(session_key, driver_number, year=year),
        session_key=session_key,
        year=year,
    )
    return await session_response(data, session_key, year=year)

# /api/stints is bespoke: TyreStintSeries lap counts drift from the lap
# records in qualifying-style sessions (the first out-lap is never counted),
# so stint lap ranges are realigned to the laps payload's runs per request.
STINTS_ENDPOINT_CONFIG = {
    "feed": "TyreStintSeries",
    "normalizer": normalize_livetiming_stints,
    "stream": False,
    "cache_prefix": "stints_v2",
}

@app.route("/api/stints")
async def api_stints():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")
    year, year_error = parse_optional_year_param()
    if year_error is not None:
        return year_error

    data = await get_livetiming_session_payload("stints", STINTS_ENDPOINT_CONFIG, session_key, year=year)
    try:
        laps = await get_cached_livetiming(
            laps_cache_name(session_key),
            lambda: fetch_livetiming_laps_payload(session_key, year=year),
            session_key=session_key,
            year=year,
        )
        data = align_stints_with_lap_runs(data, laps)
    except Exception as e:
        # Alignment is best-effort: without laps the accumulated ranges stand
        logger.warning(f"Stint/lap alignment unavailable for session {session_key}: {e}")
    return await session_response(data, session_key, year=year)

def parse_iso_utc(value):
    """Parse an ISO timestamp into an aware-UTC datetime (naive input treated as UTC)."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)

def build_lap_telemetry_window(laps, lap_number):
    """Return (lap, start, end) datetimes for a lap, or None when no usable window exists.

    car_data has no lap_number upstream, so the window is derived from the lap's
    date_start + lap_duration; in/out laps without a duration close at the next
    lap's start instead.
    """
    if not isinstance(laps, list):
        return None
    ordered = sorted(
        (lap for lap in laps if isinstance(lap, dict) and lap.get("lap_number") is not None),
        key=lambda lap: lap["lap_number"],
    )
    for index, lap in enumerate(ordered):
        if lap.get("lap_number") != lap_number:
            continue
        start = parse_iso_utc(lap.get("date_start"))
        if start is None:
            return None
        duration = parse_float(lap.get("lap_duration"))
        if duration is not None and duration > 0:
            return lap, start, start + timedelta(seconds=duration)
        for next_lap in ordered[index + 1:]:
            next_start = parse_iso_utc(next_lap.get("date_start"))
            if next_start is not None and next_start > start:
                return lap, start, next_start
        return None
    return None

def build_race_lap_window(laps, lap_number):
    """Return (start, end) datetimes for a race lap, or None when no usable window exists.

    Race lap N opens when the first driver starts lap N (the race leader) and
    closes when the first driver starts a later lap; the final lap closes at
    the latest lap end across the field so every car reaches the flag. Only
    meaningful for Race/Sprint sessions, where lap numbers are field-wide.
    """
    if not isinstance(laps, list):
        return None
    starts = {}
    completed = set()  # lap numbers some driver has a recorded duration for
    latest_end = None
    for lap in laps:
        if not isinstance(lap, dict) or lap.get("lap_number") is None:
            continue
        start = parse_iso_utc(lap.get("date_start"))
        if start is None:
            continue
        number = lap["lap_number"]
        if number not in starts or start < starts[number]:
            starts[number] = start
        duration = parse_float(lap.get("lap_duration"))
        if duration is not None and duration > 0:
            completed.add(number)
            end = start + timedelta(seconds=duration)
            if latest_end is None or end > latest_end:
                latest_end = end
    start = starts.get(lap_number)
    if start is None:
        return None
    later_starts = [value for number, value in starts.items() if number > lap_number and value > start]
    if later_starts:
        return start, min(later_starts)
    # Close the final lap only once someone has completed it: a live
    # in-progress lap must not get a window from an unrelated earlier lap end
    # (e.g. a stale many-laps-down entry), matching the per-driver 404.
    if lap_number in completed and latest_end is not None and latest_end > start:
        return start, latest_end
    return None

def downsample_telemetry(samples, max_points=TELEMETRY_MAX_POINTS):
    if len(samples) <= max_points:
        return samples, False
    step = len(samples) / max_points
    picked = [samples[int(i * step)] for i in range(max_points)]
    picked[-1] = samples[-1]
    return picked, True

def _telemetry_sample_t(sample):
    """Best-effort float `t` (seconds into lap) for a telemetry sample."""
    if not isinstance(sample, dict):
        return None
    try:
        return float(sample.get("t"))
    except (TypeError, ValueError):
        return None

def compute_telemetry_distance(telemetry):
    """Cumulative distance (m) per sample via trapezoidal integration of speed.

    speed (km/h) is converted to m/s; d[0]=0 and
    d[i] = d[i-1] + (v[i-1]+v[i])/2 * (t[i]-t[i-1]). Missing speed carries the
    previous speed forward; a missing or non-increasing t contributes 0.
    Distances round to 0.1 m. Returns a list parallel to `telemetry`.
    """
    distances = []
    prev_t = None
    prev_v = 0.0  # m/s
    total = 0.0
    for sample in telemetry:
        raw_speed = sample.get("speed") if isinstance(sample, dict) else None
        if raw_speed is None:
            v = prev_v
        else:
            try:
                v = float(raw_speed) / 3.6
            except (TypeError, ValueError):
                v = prev_v
        t = _telemetry_sample_t(sample)
        if prev_t is not None and t is not None:
            dt = t - prev_t
            if dt > 0:
                total += (prev_v + v) / 2.0 * dt
        distances.append(round(total, 1))
        prev_v = v
        if t is not None:
            prev_t = t
    return distances

def _interpolate_t_at_distance(distances, telemetry, d):
    """Linearly interpolate a lap's `t` at cumulative distance `d`.

    `distances` is the monotonic (non-decreasing) output of
    compute_telemetry_distance for `telemetry`. Clamps to the endpoints.
    """
    n = len(distances)
    if n == 0:
        return None
    if d <= distances[0]:
        return _telemetry_sample_t(telemetry[0])
    if d >= distances[-1]:
        return _telemetry_sample_t(telemetry[-1])
    lo, hi = 0, n - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if distances[mid] < d:
            lo = mid + 1
        else:
            hi = mid
    i = lo - 1
    d0, d1 = distances[i], distances[i + 1]
    t0 = _telemetry_sample_t(telemetry[i])
    t1 = _telemetry_sample_t(telemetry[i + 1])
    if t0 is None:
        return t1
    if t1 is None or d1 == d0:
        return t0
    return t0 + (t1 - t0) * ((d - d0) / (d1 - d0))

def compute_telemetry_delta(main_telemetry, ref_telemetry, points=200):
    """Time gap (main - ref) sampled over the distance both laps share.

    Distances are integrated for each lap; the common range is
    0..min(main_total, ref_total). For `points` evenly spaced distances across
    that range (both endpoints included) the lap times are linearly
    interpolated and the gap emitted as {"d", "gap"}. Positive gap => the main
    lap is slower (behind) at that distance. Returns [] when either lap has
    fewer than 2 samples or the common range is <= 0.
    """
    if len(main_telemetry) < 2 or len(ref_telemetry) < 2:
        return []
    main_dist = compute_telemetry_distance(main_telemetry)
    ref_dist = compute_telemetry_distance(ref_telemetry)
    common = min(main_dist[-1], ref_dist[-1])
    if common <= 0:
        return []
    delta = []
    for i in range(points):
        d = common * i / (points - 1) if points > 1 else common
        t_main = _interpolate_t_at_distance(main_dist, main_telemetry, d)
        t_ref = _interpolate_t_at_distance(ref_dist, ref_telemetry, d)
        if t_main is None or t_ref is None:
            continue
        delta.append({"d": round(d, 1), "gap": round(t_main - t_ref, 3)})
    return delta

def telemetry_payload_with_distance(payload):
    """Return a copy of a car-telemetry payload whose samples carry `d` (metres).

    Copies are made at both the payload and sample level so the cached
    `d`-free single-lap payload is never mutated (see compare endpoint).
    """
    telemetry = payload.get("telemetry") or []
    distances = compute_telemetry_distance(telemetry)
    enriched = [dict(sample, d=distances[index]) for index, sample in enumerate(telemetry)]
    result = dict(payload)
    result["telemetry"] = enriched
    return result

async def build_car_telemetry_payload(session_key, driver_number, lap_number, year):
    """Build (or cache-load) one lap's car-telemetry payload.

    Returns (payload, error_response) with exactly one non-None. When non-None,
    error_response is a ready-to-return Flask response (a 404 tuple or a
    stale-cache body) so callers can propagate it verbatim.
    """
    # v3: include the selected lap's sector durations so telemetry charts can
    # place the official sector boundaries on both time and distance axes.
    cache_name = f"car_telemetry_v3_{session_key}_{driver_number}_{lap_number}.json"
    cache_path = os.path.join(CACHE_DIR, cache_name)
    session = await asyncio.to_thread(get_session_info, session_key, year)
    ttl = None if is_historical(session) else 300

    cached = await read_cache(cache_path, ttl)
    if cached is not None:
        return cached, None

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl)
        if cached is not None:
            return cached, None

        laps = await get_cached_livetiming(
            laps_cache_name(session_key, driver_number),
            lambda: fetch_livetiming_laps_payload(session_key, driver_number, year=year),
            session_key=session_key,
            year=year,
        )
        window = build_lap_telemetry_window(laps, lap_number)
        if window is None:
            return None, (jsonify({"error": "No telemetry window available for this lap"}), 404)
        lap, start, end = window

        try:
            session_path, _ = await resolve_livetiming_session_path(session_key, year)
            car_records = await fetch_livetiming_feed_cached(
                session_key, session_path, "CarData.z", stream=True, year=year
            )
            car_data = await asyncio.to_thread(
                lambda: list(flatten_car_data_z(ensure_livetiming_records(car_records), session_key=session_key))
            )
        except Exception as e:
            logger.warning(f"Error fetching Livetiming CarData.z for {cache_name}: {e}")
            stale = await read_stale_cache(cache_path)
            if stale is not None:
                return None, jsonify(stale)
            raise UpstreamAPIError(f"Upstream API request failed for {cache_name}")

        window_seconds = (end - start).total_seconds()
        telemetry = []
        for sample in car_data if isinstance(car_data, list) else []:
            sample_time = parse_iso_utc(sample.get("date")) if isinstance(sample, dict) else None
            if sample_time is None:
                continue
            sample_driver = parse_int_param(sample.get("driver_number"))
            if sample_driver != driver_number:
                continue
            t = (sample_time - start).total_seconds()
            if t < 0 or t > window_seconds:
                continue
            telemetry.append({
                "t": round(t, 3),
                "speed": sample.get("speed"),
                "throttle": sample.get("throttle"),
                "brake": sample.get("brake"),
                "gear": sample.get("n_gear"),
                "drs": sample.get("drs"),
            })
        telemetry.sort(key=lambda item: item["t"])
        telemetry, downsampled = downsample_telemetry(telemetry)

        payload = {
            "session_key": session_key,
            "driver_number": driver_number,
            "lap_number": lap_number,
            "lap_date_start": lap.get("date_start"),
            "lap_duration": parse_float(lap.get("lap_duration")),
            "duration_sector_1": parse_float(lap.get("duration_sector_1")),
            "duration_sector_2": parse_float(lap.get("duration_sector_2")),
            "duration_sector_3": parse_float(lap.get("duration_sector_3")),
            "sample_count": len(telemetry),
            "downsampled": downsampled,
            "telemetry": telemetry,
        }
        await write_cache(cache_path, payload)
        return payload, None

@app.route("/api/car_telemetry")
async def api_car_telemetry():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")
    driver_number = parse_int_param(request.args.get("driver_number"))
    if driver_number is None:
        return invalid_param_response("driver_number")
    lap_number = parse_int_param(request.args.get("lap_number"))
    if lap_number is None:
        return invalid_param_response("lap_number")
    year, year_error = parse_optional_year_param()
    if year_error is not None:
        return year_error

    payload, error = await build_car_telemetry_payload(session_key, driver_number, lap_number, year)
    if error is not None:
        return error
    return await session_response(payload, session_key, year=year)

@app.route("/api/telemetry_compare")
async def api_telemetry_compare():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")
    driver_number = parse_int_param(request.args.get("driver_number"))
    if driver_number is None:
        return invalid_param_response("driver_number")
    lap_number = parse_int_param(request.args.get("lap_number"))
    if lap_number is None:
        return invalid_param_response("lap_number")
    ref_driver_number = parse_int_param(request.args.get("ref_driver_number"))
    if ref_driver_number is None:
        return invalid_param_response("ref_driver_number")
    ref_lap_number = parse_int_param(request.args.get("ref_lap_number"))
    if ref_lap_number is None:
        return invalid_param_response("ref_lap_number")
    year, year_error = parse_optional_year_param()
    if year_error is not None:
        return year_error

    # Reuse the per-lap builder/caches; propagate its error shape verbatim so an
    # unknown ref lap yields the same 404 the single endpoint gives.
    main_payload, main_error = await build_car_telemetry_payload(
        session_key, driver_number, lap_number, year
    )
    if main_error is not None:
        return main_error
    ref_payload, ref_error = await build_car_telemetry_payload(
        session_key, ref_driver_number, ref_lap_number, year
    )
    if ref_error is not None:
        return ref_error

    # Enrich copies with distance so the cached, d-free single-lap payloads stay
    # byte-identical to what /api/car_telemetry serves.
    delta = compute_telemetry_delta(
        main_payload.get("telemetry") or [], ref_payload.get("telemetry") or []
    )
    return await session_response(
        {
            "main": telemetry_payload_with_distance(main_payload),
            "ref": telemetry_payload_with_distance(ref_payload),
            "delta": delta,
        },
        session_key,
        year=year,
    )

@app.route("/api/track_replay")
async def api_track_replay():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")
    # Full-race mode: omitting driver_number replays leader-based race-lap
    # windows instead of one driver's laps (doc/2026-07-05-full-race-replay-design.md)
    driver_number = None
    if request.args.get("driver_number") is not None:
        driver_number = parse_int_param(request.args.get("driver_number"))
        if driver_number is None:
            return invalid_param_response("driver_number")

    # Full-session mode (qualifying): an explicit start/end UTC window replaces
    # the lap-derived one — quali lap numbers are per-driver, so the frontend
    # slices the session's Q1/Q2/Q3 phases into windows itself
    # (doc/2026-07-07-full-qualifying-replay-design.md)
    window_start = window_end = None
    if driver_number is None and (
        request.args.get("start") is not None or request.args.get("end") is not None
    ):
        window_start = parse_iso_utc(request.args.get("start"))
        if window_start is None:
            return invalid_param_response("start")
        window_end = parse_iso_utc(request.args.get("end"))
        if window_end is None:
            return invalid_param_response("end")
        window_length = (window_end - window_start).total_seconds()
        if window_length <= 0 or window_length > REPLAY_WINDOW_MAX_SECONDS:
            return jsonify({"error": (
                f"start/end must describe a window of at most {REPLAY_WINDOW_MAX_SECONDS} seconds"
            )}), 400

    lap_number = None
    if window_start is None:
        lap_number = parse_int_param(request.args.get("lap_number"))
        if lap_number is None:
            return invalid_param_response("lap_number")

    year, year_error = parse_optional_year_param()
    if year_error is not None:
        return year_error

    # v2: lap-scoped windows derive from the laps payload, rebuilt when laps
    # moved to v2 (explicit windows share the prefix for tidy cache naming)
    if window_start is not None:
        start_token = int(window_start.timestamp() * 1000)
        end_token = int(window_end.timestamp() * 1000)
        cache_name = f"track_replay_v2_{session_key}_window_{start_token}_{end_token}.json"
    else:
        replay_scope = "race" if driver_number is None else driver_number
        cache_name = f"track_replay_v2_{session_key}_{replay_scope}_{lap_number}.json"
    cache_path = os.path.join(CACHE_DIR, cache_name)
    session = await asyncio.to_thread(get_session_info, session_key, year)
    ttl = None if is_historical(session) else 300

    cached = await read_cache(cache_path, ttl)
    if cached is not None:
        return await session_response(cached, session_key, year=year)

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl)
        if cached is not None:
            return await session_response(cached, session_key, year=year)

        if window_start is not None:
            # Explicit window: no laps needed, the bounds are the window
            start, end = window_start, window_end
            lap_duration = None
        else:
            laps = await get_cached_livetiming(
                laps_cache_name(session_key, driver_number),
                lambda: fetch_livetiming_laps_payload(session_key, driver_number, year=year),
                session_key=session_key,
                year=year,
            )
            if driver_number is None:
                window = build_race_lap_window(laps, lap_number)
                if window is None:
                    return jsonify({"error": "No replay window available for this lap"}), 404
                start, end = window
                lap_duration = None
            else:
                window = build_lap_telemetry_window(laps, lap_number)
                if window is None:
                    return jsonify({"error": "No replay window available for this lap"}), 404
                lap, start, end = window
                lap_duration = parse_float(lap.get("lap_duration"))

        try:
            session_path, _ = await resolve_livetiming_session_path(session_key, year)
            position_records = await fetch_livetiming_feed_cached(
                session_key, session_path, "Position.z", stream=True, year=year
            )
            location_data = await asyncio.to_thread(
                lambda: list(flatten_position_z(ensure_livetiming_records(position_records), session_key=session_key))
            )
        except Exception as e:
            logger.warning(f"Error fetching Livetiming Position.z for {cache_name}: {e}")
            stale = await read_stale_cache(cache_path)
            if stale is not None:
                return jsonify(stale)
            raise UpstreamAPIError(f"Upstream API request failed for {cache_name}")

        window_seconds = (end - start).total_seconds()
        samples_by_driver = {}
        for sample in location_data if isinstance(location_data, list) else []:
            if not isinstance(sample, dict):
                continue
            sample_driver = parse_int_param(sample.get("driver_number"))
            sample_time = parse_iso_utc(sample.get("date"))
            x = parse_float(sample.get("x"))
            y = parse_float(sample.get("y"))
            if sample_driver is None or sample_time is None or x is None or y is None:
                continue
            t = (sample_time - start).total_seconds()
            if t < 0 or t > window_seconds:
                continue
            samples_by_driver.setdefault(sample_driver, []).append(
                [round(t, 3), round(x), round(y)]
            )

        downsampled = False
        drivers = []
        for number in sorted(samples_by_driver):
            series = sorted(samples_by_driver[number], key=lambda item: item[0])
            series, was_downsampled = downsample_telemetry(series, REPLAY_MAX_POINTS_PER_DRIVER)
            downsampled = downsampled or was_downsampled
            drivers.append({"driver_number": number, "samples": series})

        payload = {
            "session_key": session_key,
            "driver_number": driver_number,
            "lap_number": lap_number,
            "lap_duration": lap_duration,
            "window_seconds": round(window_seconds, 3),
            "downsampled": downsampled,
            "drivers": drivers,
        }
        await write_cache(cache_path, payload)
        return await session_response(payload, session_key, year=year)

@app.route("/api/season_progression")
async def api_season_progression():
    year = parse_int_param(request.args.get("year") or str(current_season_year()))
    if year is None:
        return invalid_param_response("year")

    races_url = f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json"
    races_data = await get_cached_jolpica_api(races_url, f"jolpica_races_{year}.json", year=year)
    today = datetime.now(timezone.utc).date().isoformat()
    completed_races = [
        race for race in extract_jolpica_races(races_data)
        if race.get("round") and race.get("date") and race["date"] <= today
    ]

    # Jolpica rate-limits aggressively; cap concurrency (fetch_url retries 429s).
    semaphore = asyncio.Semaphore(4)

    async def fetch_round_standings(round_number):
        driver_url = f"https://api.jolpi.ca/ergast/f1/{year}/{round_number}/driverstandings/?format=json"
        constructor_url = f"https://api.jolpi.ca/ergast/f1/{year}/{round_number}/constructorstandings/?format=json"
        async with semaphore:
            driver_data = await get_cached_jolpica_api(
                driver_url, f"jolpica_driver_standings_{year}_{round_number}.json", year=year
            )
        async with semaphore:
            constructor_data = await get_cached_jolpica_api(
                constructor_url, f"jolpica_constructor_standings_{year}_{round_number}.json", year=year
            )
        return driver_data, constructor_data

    round_results = await asyncio.gather(
        *(fetch_round_standings(race["round"]) for race in completed_races)
    )

    rounds = []
    driver_series = {}
    constructor_series = {}

    def pad_to_previous_round(series):
        while len(series["points"]) < len(rounds) - 1:
            series["points"].append(None)
            series["positions"].append(None)

    for race, (driver_data, constructor_data) in zip(completed_races, round_results):
        driver_standings = extract_jolpica_standings(driver_data, "DriverStandings")
        constructor_standings = extract_jolpica_standings(constructor_data, "ConstructorStandings")
        if not driver_standings and not constructor_standings:
            continue  # raced too recently for standings to be published yet

        rounds.append({
            "round": race.get("round"),
            "race_name": race.get("raceName"),
            "date": race.get("date"),
        })

        for item in driver_standings:
            driver = item.get("Driver") or {}
            key = driver.get("driverId") or driver.get("code") or driver.get("familyName")
            if not key:
                continue
            series = driver_series.setdefault(key, {
                "id": key,
                "code": driver.get("code"),
                "name": f"{driver.get('givenName', '')} {driver.get('familyName', '')}".strip(),
                "team": None,
                "points": [],
                "positions": [],
            })
            pad_to_previous_round(series)
            series["points"].append(parse_float(item.get("points")))
            series["positions"].append(parse_int_param(item.get("position")))
            constructors = item.get("Constructors") or []
            if constructors:
                series["team"] = constructors[-1].get("name")

        for item in constructor_standings:
            constructor = item.get("Constructor") or {}
            key = constructor.get("constructorId") or constructor.get("name")
            if not key:
                continue
            series = constructor_series.setdefault(key, {
                "id": key,
                "name": constructor.get("name"),
                "team": constructor.get("name"),
                "points": [],
                "positions": [],
            })
            pad_to_previous_round(series)
            series["points"].append(parse_float(item.get("points")))
            series["positions"].append(parse_int_param(item.get("position")))

    def finalize_series(series_map):
        def latest_points(series):
            return next((p for p in reversed(series["points"]) if p is not None), 0)

        series_list = list(series_map.values())
        for series in series_list:
            while len(series["points"]) < len(rounds):
                series["points"].append(None)
                series["positions"].append(None)
        series_list.sort(key=latest_points, reverse=True)
        return series_list

    return jsonify({
        "season": str(year),
        "rounds": rounds,
        "drivers": finalize_series(driver_series),
        "constructors": finalize_series(constructor_series),
    })

@app.route("/api/constructors")
async def api_constructors():
    year = parse_int_param(request.args.get("year") or request.args.get("season") or str(current_season_year()))
    if year is None:
        return invalid_param_response("year")

    selected_date = request.args.get("date")
    round_number = request.args.get("round")
    if round_number is not None:
        round_number = parse_int_param(round_number)
        if round_number is None:
            return invalid_param_response("round")

    race = None
    if not round_number:
        if not selected_date:
            return jsonify({"error": "date or round is required"}), 400

        selected_date = selected_date[:10]
        if not DATE_PARAM_RE.match(selected_date):
            return jsonify({"error": "date must be in YYYY-MM-DD format"}), 400

        races_url = f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json"
        races_data = await get_cached_jolpica_api(
            races_url,
            f"jolpica_races_{year}.json",
            year=year,
        )
        race = find_jolpica_race_by_date(extract_jolpica_races(races_data), selected_date)
        if not race:
            return jsonify({"error": "round not found for selected date"}), 404
        round_number = race.get("round")

    constructors_url = f"https://api.jolpi.ca/ergast/f1/{year}/{round_number}/constructors/?format=json"
    constructors_data = await get_cached_jolpica_api(
        constructors_url,
        f"jolpica_constructors_{year}_{round_number}.json",
        year=year,
    )

    if not race:
        races_url = f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json"
        races_data = await get_cached_jolpica_api(
            races_url,
            f"jolpica_races_{year}.json",
            year=year,
        )
        race = next(
            (item for item in extract_jolpica_races(races_data) if item.get("round") == str(round_number)),
            None,
        )

    return jsonify({
        "season": str(year),
        "round": str(round_number),
        "race_name": race.get("raceName") if race else None,
        "date": race.get("date") if race else selected_date,
        "constructors": extract_jolpica_constructors(constructors_data),
    })

@app.route("/api/race_standings")
async def api_race_standings():
    year = parse_int_param(request.args.get("year") or request.args.get("season") or str(current_season_year()))
    if year is None:
        return invalid_param_response("year")

    selected_date = request.args.get("date")
    round_number = request.args.get("round")
    if round_number is not None:
        round_number = parse_int_param(round_number)
        if round_number is None:
            return invalid_param_response("round")
    race = None

    if not round_number:
        if not selected_date:
            return jsonify({"error": "date or round is required"}), 400

        selected_date = selected_date[:10]
        if not DATE_PARAM_RE.match(selected_date):
            return jsonify({"error": "date must be in YYYY-MM-DD format"}), 400
        races_url = f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json"
        races_data = await get_cached_jolpica_api(
            races_url,
            f"jolpica_races_{year}.json",
            year=year,
        )
        race = find_jolpica_race_by_date(extract_jolpica_races(races_data), selected_date)
        if not race:
            return jsonify({"error": "round not found for selected date"}), 404
        round_number = race.get("round")

    driver_url = f"https://api.jolpi.ca/ergast/f1/{year}/{round_number}/driverstandings/?format=json"
    constructor_url = f"https://api.jolpi.ca/ergast/f1/{year}/{round_number}/constructorstandings/?format=json"
    driver_data, constructor_data = await asyncio.gather(
        get_cached_jolpica_api(
            driver_url,
            f"jolpica_driver_standings_{year}_{round_number}.json",
            year=year,
        ),
        get_cached_jolpica_api(
            constructor_url,
            f"jolpica_constructor_standings_{year}_{round_number}.json",
            year=year,
        ),
    )

    if not race:
        races_url = f"https://api.jolpi.ca/ergast/f1/{year}/races/?format=json"
        races_data = await get_cached_jolpica_api(
            races_url,
            f"jolpica_races_{year}.json",
            year=year,
        )
        race = next(
            (item for item in extract_jolpica_races(races_data) if item.get("round") == str(round_number)),
            None,
        )

    return jsonify({
        "season": str(year),
        "round": str(round_number),
        "race_name": race.get("raceName") if race else None,
        "date": race.get("date") if race else selected_date,
        "driver_standings": extract_jolpica_standings(driver_data, "DriverStandings"),
        "constructor_standings": extract_jolpica_standings(constructor_data, "ConstructorStandings"),
    })

if __name__ == "__main__":
    debug_mode = os.environ.get("F1_DASHBOARD_DEBUG", "1") == "1"
    port = int(os.environ.get("PORT", "5300"))
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
