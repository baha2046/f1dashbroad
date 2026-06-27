import os
import json
import httpx
from datetime import datetime, timezone
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

async def fetch_url(url: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=15.0)
        response.raise_for_status()
        return response.json()

async def get_cached_api(url: str, cache_name: str, session_key=None, year=2026):
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
        data = await fetch_url(url)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return data
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

@app.route("/")
async def index():
    return await render_template("index.html")

@app.route("/api/sessions")
async def api_sessions():
    year = request.args.get("year", "2026")
    url = f"https://api.openf1.org/v1/sessions?year={year}"
    cache_name = f"sessions_{year}.json"
    data = await get_cached_api(url, cache_name, year=year)
    return jsonify(data)

@app.route("/api/drivers")
async def api_drivers():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
    
    url = f"https://api.openf1.org/v1/drivers?session_key={session_key}"
    cache_name = f"drivers_{session_key}.json"
    data = await get_cached_api(url, cache_name, session_key=session_key)
    return jsonify(data)

@app.route("/api/weather")
async def api_weather():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    url = f"https://api.openf1.org/v1/weather?session_key={session_key}"
    cache_name = f"weather_{session_key}.json"
    data = await get_cached_api(url, cache_name, session_key=session_key)
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
        
    data = await get_cached_api(url, cache_name, session_key=session_key)
    return jsonify(data)

@app.route("/api/stints")
async def api_stints():
    session_key = request.args.get("session_key")
    if not session_key:
        return jsonify({"error": "session_key is required"}), 400
        
    url = f"https://api.openf1.org/v1/stints?session_key={session_key}"
    cache_name = f"stints_{session_key}.json"
    data = await get_cached_api(url, cache_name, session_key=session_key)
    return jsonify(data)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5300, debug=True)
