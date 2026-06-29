import os
import json
import httpx
from datetime import datetime, timezone

from httpx import __version__
from quart import Quart, render_template, jsonify, request

app = Quart(__name__)

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Helper to load cached sessions
def get_session_info(session_key, year=2026):
    sessions_file = os.path.join(CACHE_DIR, f"sessions_{year}.json")
    if os.path.exists(sessions_file):
        try:
            with open(sessions_file, "r", encoding="utf-8") as f:
                sessions = json.load(f)
                for s in sessions:
                    if s.get("session_key") == int(session_key):
                        return s
        except Exception:
            pass
    return None

def is_historical(session):
    if not session:
        return False
    
    # If year is in the past relative to current year (2026)
    year = session.get("year", 2026)
    if year < 2026:
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

async def fetch_url(url: str, api_key: str = None):
    headers = {}
    if not api_key:
        api_key = os.environ.get("OPENF1_API_KEY")
        
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["x-api-key"] = api_key
        headers["api-key"] = api_key
        headers["apikey"] = api_key
        
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, timeout=15.0)
        if response.status_code in (401, 403):
            try:
                error_data = response.json()
                if isinstance(error_data, dict) and "detail" in error_data:
                    raise OpenF1AuthError(error_data["detail"], response.status_code)
            except Exception:
                pass
        response.raise_for_status()
        return response.json()

async def get_cached_api(url: str, cache_name: str, session_key=None, year=2026, api_key: str = None):
    cache_path = os.path.join(CACHE_DIR, cache_name)
    
    # Determine TTL
    ttl = None  # None means permanent cache (historical)
    
    if "sessions" in cache_name:
        # If it's the current year or future, cache sessions for 1 hour to fetch updates
        if int(year) >= 2026:
            ttl = 3600
    else:
        # For session-specific data (drivers, weather, laps, etc.)
        session = get_session_info(session_key, year) if session_key else None
        if not session or not is_historical(session):
            ttl = 300  # 5 minutes for active/live/future sessions
            
    # Check if cache file exists and is valid
    if os.path.exists(cache_path):
        mtime = os.path.getmtime(cache_path)
        age = datetime.now().timestamp() - mtime
        if ttl is None or age < ttl:
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
                
    # Fetch from API
    try:
        data = await fetch_url(url, api_key=api_key)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return data
    except OpenF1AuthError as e:
        raise e
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        # Try to fallback to stale cache
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

async def get_cached_circuit_info(url: str, cache_name: str):
    cache_path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
            
    try:
        async with httpx.AsyncClient() as client:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            response = await client.get(url, headers=headers, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            return data
    except Exception as e:
        print(f"Error fetching circuit info from {url}: {e}")
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return None

@app.errorhandler(OpenF1AuthError)
async def handle_openf1_auth_error(error):
    return jsonify({
        "error": "live_session_restriction",
        "detail": error.message
    }), error.status_code

@app.route("/api/meetings")
async def api_meetings():
    meeting_key = request.args.get("meeting_key")
    if not meeting_key:
        return jsonify({"error": "meeting_key is required"}), 400
    
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
        year = meeting.get("year", 2026)
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
    year = request.args.get("year", "2026")
    url = f"https://api.openf1.org/v1/sessions?year={year}"
    cache_name = f"sessions_{year}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, year=year, api_key=api_key)
    return jsonify(data)

@app.route("/api/drivers")
async def api_drivers():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
    
    url = f"https://api.openf1.org/v1/drivers?session_key={session_key}"
    cache_name = f"drivers_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/weather")
async def api_weather():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    url = f"https://api.openf1.org/v1/weather?session_key={session_key}"
    cache_name = f"weather_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/laps")
async def api_laps():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    driver_number = request.args.get("driver_number")
    if driver_number:
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
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    url = f"https://api.openf1.org/v1/stints?session_key={session_key}"
    cache_name = f"stints_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/results")
async def api_results():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    url = f"https://api.openf1.org/v1/session_result?session_key={session_key}"
    cache_name = f"results_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

@app.route("/api/race_control")
async def api_race_control():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    url = f"https://api.openf1.org/v1/race_control?session_key={session_key}"
    cache_name = f"race_control_{session_key}.json"
    api_key = request.headers.get("X-OpenF1-Key")
    data = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
    return jsonify(data)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5300, debug=True)


