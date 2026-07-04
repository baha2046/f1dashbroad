import os
import re
import json
import asyncio
import tempfile
import weakref
import httpx
from datetime import datetime, timezone

from quart import Quart, render_template, jsonify, request

app = Quart(__name__)

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_cache")
os.makedirs(CACHE_DIR, exist_ok=True)
OPENF1_429_MAX_RETRIES = 3
OPENF1_429_BASE_DELAY_SECONDS = 1.0
OPENF1_429_MAX_DELAY_SECONDS = 10.0

DATE_PARAM_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NATIONALITY_TO_FLAG = {
    'argentina': '🇦🇷',
    'australia': '🇦🇺',
    'austria': '🇦🇹',
    'azerbaijan': '🇦🇿',
    'belgium': '🇧🇪',
    'brazil': '🇧🇷',
    'bahrain': '🇧🇭',
    'canada': '🇨🇦',
    'china': '🇨🇳',
    'denmark': '🇩🇰',
    'finland': '🇫🇮',
    'france': '🇫🇷',
    'germany': '🇩🇪',
    'great britain': '🇬🇧',
    'british': '🇬🇧',
    'italy': '🇮🇹',
    'japan': '🇯🇵',
    'mexico': '🇲🇽',
    'monaco': '🇲🇨',
    'netherlands': '🇳🇱',
    'dutch': '🇳🇱',
    'new zealand': '🇳🇿',
    'spain': '🇪🇸',
    'thailand': '🇹🇭',
    'united states': '🇺🇸',
    'american': '🇺🇸',
    'switzerland': '🇨🇭',
    'swiss': '🇨🇭',
    'sweden': '🇸🇪',
    'swedish': '🇸🇪',
    'poland': '🇵🇱',
    'polish': '🇵🇱',
    'russia': '🇷🇺',
    'russian': '🇷🇺',
    'india': '🇮🇳',
    'indian': '🇮🇳',
    'venezuela': '🇻🇪',
    'indonesia': '🇮🇩',
    'colombia': '🇨🇴',
}

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

# Shared HTTP client (connection pooling); created lazily, closed on shutdown
_http_client = None

def get_http_client():
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client

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
        print(f"Error writing cache {cache_path}: {e}")

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
            print(f"Error fetching f1api drivers: {e}")
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

class OpenF1AuthError(Exception):
    def __init__(self, message, status_code=403):
        super().__init__(message)
        self.message = message
        self.status_code = status_code

class UpstreamAPIError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code

def get_openf1_retry_delay(response, retry_index):
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return min(float(retry_after), OPENF1_429_MAX_DELAY_SECONDS)
        except ValueError:
            pass
    return min(OPENF1_429_BASE_DELAY_SECONDS * (2 ** retry_index), OPENF1_429_MAX_DELAY_SECONDS)

async def fetch_url(url: str, api_key: str = None):
    headers = {}
    if not api_key:
        api_key = os.environ.get("OPENF1_API_KEY")

    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    client = get_http_client()
    response = None
    for retry_index in range(OPENF1_429_MAX_RETRIES + 1):
        response = await client.get(url, headers=headers, timeout=15.0)
        if response.status_code != 429 or retry_index == OPENF1_429_MAX_RETRIES:
            break
        delay = get_openf1_retry_delay(response, retry_index)
        await asyncio.sleep(delay)

    if response.status_code in (401, 403):
        try:
            error_data = response.json()
            if isinstance(error_data, dict) and "detail" in error_data:
                raise OpenF1AuthError(error_data["detail"], response.status_code)
        except OpenF1AuthError:
            raise
        except Exception:
            pass
    response.raise_for_status()
    return response.json()

async def get_cached_api(url: str, cache_name: str, session_key=None, year=None, api_key: str = None):
    cache_path = os.path.join(CACHE_DIR, cache_name)
    if year is None:
        year = current_season_year()

    # Determine TTL
    ttl = None  # None means permanent cache (historical)

    if "sessions" in cache_name:
        # If it's the current year or future, cache sessions for 1 hour to fetch updates
        if int(year) >= current_season_year():
            ttl = 3600
    else:
        # For session-specific data (drivers, weather, laps, etc.)
        session = await asyncio.to_thread(get_session_info, session_key, year) if session_key else None
        if not session or not is_historical(session):
            ttl = 300  # 5 minutes for active/live/future sessions

    cached = await read_cache(cache_path, ttl)
    if cached is not None:
        return cached

    async with get_cache_lock(cache_path):
        cached = await read_cache(cache_path, ttl)
        if cached is not None:
            return cached
        try:
            data = await fetch_url(url, api_key=api_key)
        except OpenF1AuthError:
            raise
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            stale = await read_stale_cache(cache_path)
            if stale is not None:
                return stale
            raise UpstreamAPIError(f"Upstream API request failed for {cache_name}")
        await write_cache(cache_path, data)
        return data

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
            print(f"Error fetching circuit info from {url}: {e}")
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
            print(f"Error fetching Jolpica data from {url}: {e}")
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

@app.errorhandler(OpenF1AuthError)
async def handle_openf1_auth_error(error):
    return jsonify({
        "error": "live_session_restriction",
        "detail": error.message
    }), error.status_code

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

    url = f"https://api.openf1.org/v1/meetings?meeting_key={meeting_key}"
    cache_name = f"meetings_{meeting_key}.json"

    api_key = request.headers.get("X-OpenF1-Key")
    meeting_data = await get_cached_api(url, cache_name, api_key=api_key)

    if not meeting_data:
        return jsonify({"error": "Meeting not found"}), 404

    if isinstance(meeting_data, list) and len(meeting_data) > 0:
        meeting = meeting_data[0]
    elif isinstance(meeting_data, dict):
        meeting = meeting_data
    else:
        return jsonify({"error": "Meeting not found"}), 404

    circuit_info = None
    circuit_info_url = meeting.get("circuit_info_url")
    if circuit_info_url:
        circuit_key = meeting.get("circuit_key")
        year = meeting.get("year", current_season_year())
        circuit_cache_name = f"circuit_info_{circuit_key}_{year}.json"
        circuit_info = await get_cached_circuit_info(circuit_info_url, circuit_cache_name)

    return jsonify({
        "meeting": meeting,
        "circuit_info": circuit_info
    })

@app.route("/")
async def index():
    return await render_template("index.html", version=datetime.timestamp(datetime.now()))


@app.route("/api/sessions")
async def api_sessions():
    year = parse_int_param(request.args.get("year", str(current_season_year())))
    if year is None:
        return invalid_param_response("year")
    url = f"https://api.openf1.org/v1/sessions?year={year}"
    cache_name = f"sessions_{year}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, year=year, api_key=api_key)
    return jsonify(data)

@app.route("/api/drivers")
async def api_drivers():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/drivers?session_key={session_key}"
    cache_name = f"drivers_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")

    openf1_drivers = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)

    year = request.args.get("year")
    if year is not None:
        year = parse_int_param(year)
        if year is None:
            return invalid_param_response("year")
    else:
        year = await find_session_year(session_key)

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

    if isinstance(openf1_drivers, list):
        for d in openf1_drivers:
            driver_number = d.get("driver_number")
            acronym = d.get("name_acronym")
            extra = None
            if driver_number is not None:
                extra = f1api_map.get(int(driver_number))
            if not extra and acronym:
                extra = f1api_acronym_map.get(acronym.upper())

            if extra:
                d["nationality"] = extra.get("nationality")
                nationality_key = str(extra.get("nationality", "")).lower()
                d["nationality_flag"] = NATIONALITY_TO_FLAG.get(nationality_key, "🏳️")
                d["birthday"] = extra.get("birthday")
                d["wiki_url"] = extra.get("url")
                d["driver_id"] = extra.get("driverId")

    return jsonify(openf1_drivers)

@app.route("/api/weather")
async def api_weather():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/weather?session_key={session_key}"
    cache_name = f"weather_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/laps")
async def api_laps():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    driver_number = request.args.get("driver_number")
    if driver_number is not None:
        driver_number = parse_int_param(driver_number)
        if driver_number is None:
            return invalid_param_response("driver_number")
        url = f"https://api.openf1.org/v1/laps?session_key={session_key}&driver_number={driver_number}"
        cache_name = f"laps_{session_key}_{driver_number}.json"
    else:
        url = f"https://api.openf1.org/v1/laps?session_key={session_key}"
        cache_name = f"laps_{session_key}.json"

    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/stints")
async def api_stints():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/stints?session_key={session_key}"
    cache_name = f"stints_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/pit")
async def api_pit():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/pit?session_key={session_key}"
    cache_name = f"pit_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/position")
async def api_position():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/position?session_key={session_key}"
    cache_name = f"position_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/results")
async def api_results():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/session_result?session_key={session_key}"
    cache_name = f"results_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

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

@app.route("/api/race_control")
async def api_race_control():
    session_key = parse_int_param(request.args.get("session_key"))
    if session_key is None:
        return invalid_param_response("session_key")

    url = f"https://api.openf1.org/v1/race_control?session_key={session_key}"
    cache_name = f"race_control_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

if __name__ == "__main__":
    debug_mode = os.environ.get("F1_DASHBOARD_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=5300, debug=debug_mode)
