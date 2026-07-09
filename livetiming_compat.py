import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin

from livetiming_client import LIVETIMING_STATIC_BASE, decode_z_payload

# A LastLapTime exceeding the crossing-to-crossing wall clock by more than
# this is garage-polluted (measured from pit entry) and gets replaced by it
LAP_DURATION_OVERSHOOT_SECONDS = 3.0


def to_float(value):
    try:
        if value is None or value == "":
            return None
        return float(str(value).replace("+", "").replace("s", "").strip())
    except (TypeError, ValueError):
        return None


def to_int(value):
    try:
        if value is None or value == "":
            return None
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def format_utc(dt):
    dt = dt.astimezone(timezone.utc)
    if dt.microsecond:
        return dt.isoformat().replace("+00:00", "Z")
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_utc_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def elapsed_to_timedelta(value):
    text = str(value or "").strip()
    match = re.match(r"^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$", text)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return timedelta(hours=int(hours), minutes=int(minutes), seconds=float(seconds))


def date_from_elapsed(timestamp, stream_start_utc=None):
    if not stream_start_utc:
        return None
    start = parse_utc_datetime(stream_start_utc)
    elapsed = elapsed_to_timedelta(timestamp)
    if start is None or elapsed is None:
        return None
    return format_utc(start + elapsed)


def parse_gmt_offset(value):
    text = str(value or "").strip()
    match = re.match(r"^(-)?(\d{1,2}):(\d{2})(?::(\d{2}))?$", text)
    if not match:
        return None
    sign = -1 if match.group(1) else 1
    return sign * timedelta(
        hours=int(match.group(2)),
        minutes=int(match.group(3)),
        seconds=int(match.group(4) or 0),
    )


def local_session_date_to_utc(value, gmt_offset):
    """Livetiming StartDate/EndDate are naive local wall-clock; shift by GmtOffset to UTC."""
    if not value:
        return None
    text = str(value)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return text
    if parsed.tzinfo is not None:
        return format_utc(parsed)
    offset = parse_gmt_offset(gmt_offset)
    if offset is None:
        return text
    return format_utc(parsed.replace(tzinfo=timezone.utc) - offset)


def derive_stream_start_utc(records):
    """UTC instant of stream elapsed 00:00:00, from a feed whose payloads carry Utc (Heartbeat).

    Stream elapsed timestamps count from when the Livetiming recording began
    (well before the scheduled session start), so absolute dates must be
    anchored here rather than at the session's advertised start time.
    """
    for timestamp, payload in records or []:
        utc = parse_utc_datetime((payload or {}).get("Utc"))
        elapsed = elapsed_to_timedelta(timestamp)
        if utc is not None and elapsed is not None:
            return format_utc(utc - elapsed)
    return None


def derive_session_started_utc(records, stream_start_utc=None):
    """UTC instant the session went green (first SessionStatus 'Started' record)."""
    for timestamp, payload in records or []:
        if (payload or {}).get("Status") == "Started":
            return date_from_elapsed(timestamp, stream_start_utc)
    return None


def normalize_utc_value(value):
    parsed = parse_utc_datetime(value)
    return format_utc(parsed) if parsed else None


def collection_items(payload, key):
    collection = (payload or {}).get(key)
    if isinstance(collection, list):
        return collection
    if isinstance(collection, dict):
        return list(collection.values())
    return []


def parse_gap_value(value):
    if value is None or value == "":
        return None
    numeric = to_float(value)
    if numeric is not None:
        return numeric
    return str(value).replace("+", "").strip()


def parse_duration_seconds(value):
    if isinstance(value, dict):
        value = value.get("Value")
    if value is None or value == "":
        return None
    text = str(value).strip()
    if ":" not in text:
        return to_float(text)
    parts = text.split(":")
    try:
        total = 0.0
        for part in parts:
            total = total * 60 + float(part)
        return round(total, 3)
    except ValueError:
        return None


def timing_section_value(line, section_name, key, value_name="Value"):
    section = line.get(section_name) or {}
    item = None
    if isinstance(section, list):
        try:
            item = section[int(key)]
        except (IndexError, ValueError, TypeError):
            item = None
    elif isinstance(section, dict):
        item = section.get(str(key)) or section.get(key)
    if isinstance(item, dict):
        return item.get(value_name)
    return None


def normalize_livetiming_sessions(year_index: dict, year: int):
    rows = []
    for meeting in year_index.get("Meetings") or []:
        country = meeting.get("Country") or {}
        circuit = meeting.get("Circuit") or {}
        for session in meeting.get("Sessions") or []:
            gmt_offset = session.get("GmtOffset")
            rows.append({
                "session_key": session.get("Key"),
                "meeting_key": meeting.get("Key"),
                "year": year,
                "location": meeting.get("Location"),
                "country_code": country.get("Code"),
                "country_name": country.get("Name"),
                "circuit_key": circuit.get("Key"),
                "circuit_short_name": circuit.get("ShortName"),
                "meeting_name": meeting.get("Name"),
                "session_name": session.get("Name"),
                "session_type": session.get("Type"),
                "date_start": local_session_date_to_utc(session.get("StartDate"), gmt_offset),
                "date_end": local_session_date_to_utc(session.get("EndDate"), gmt_offset),
                "gmt_offset": gmt_offset,
                "path": session.get("Path"),
                "is_cancelled": False,
            })
    return rows


def normalize_livetiming_meeting(meeting: dict, year: int):
    country = meeting.get("Country") or {}
    circuit = meeting.get("Circuit") or {}
    sessions = meeting.get("Sessions") or []
    starts = [
        local_session_date_to_utc(session.get("StartDate"), session.get("GmtOffset"))
        for session in sessions if session.get("StartDate")
    ]
    ends = [
        local_session_date_to_utc(session.get("EndDate"), session.get("GmtOffset"))
        for session in sessions if session.get("EndDate")
    ]
    offsets = [session.get("GmtOffset") for session in sessions if session.get("GmtOffset")]
    return {
        "meeting_key": meeting.get("Key"),
        "meeting_name": meeting.get("Name"),
        "meeting_official_name": meeting.get("OfficialName"),
        "year": year,
        "location": meeting.get("Location"),
        "country_code": country.get("Code"),
        "country_name": country.get("Name"),
        "circuit_key": circuit.get("Key"),
        "circuit_short_name": circuit.get("ShortName"),
        "circuit_type": circuit.get("Type"),
        "gmt_offset": offsets[0] if offsets else None,
        "date_start": min(starts) if starts else None,
        "date_end": max(ends) if ends else None,
    }


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
        if not isinstance(driver, dict):
            continue
        driver_number = to_int(driver.get("RacingNumber")) or to_int(key)
        if driver_number is None:
            continue
        first_name, last_name = split_full_name(driver.get("FullName"))
        rows.append({
            "driver_number": driver_number,
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


def normalize_livetiming_weather(records, stream_start_utc=None, session_key=None):
    rows = []
    for timestamp, weather in records or []:
        if not isinstance(weather, dict):
            continue
        rows.append({
            "session_key": session_key,
            "date": date_from_elapsed(timestamp, stream_start_utc),
            "air_temperature": to_float(weather.get("AirTemp")),
            "humidity": to_float(weather.get("Humidity")),
            "pressure": to_float(weather.get("Pressure")),
            "rainfall": to_float(weather.get("Rainfall")),
            "track_temperature": to_float(weather.get("TrackTemp")),
            "wind_direction": to_int(weather.get("WindDirection")),
            "wind_speed": to_float(weather.get("WindSpeed")),
        })
    return rows


def normalize_livetiming_race_control(records, session_key=None, stream_start_utc=None):
    rows = []
    for timestamp, payload in records or []:
        fallback_date = date_from_elapsed(timestamp, stream_start_utc)
        for message in collection_items(payload, "Messages"):
            if not isinstance(message, dict):
                continue
            text = message.get("Message")
            driver_number = to_int(message.get("RacingNumber"))
            if driver_number is None and text:
                match = re.search(r"\bCAR\s+(\d+)\b", str(text), flags=re.IGNORECASE)
                if match:
                    driver_number = int(match.group(1))
            rows.append({
                "session_key": session_key,
                "date": normalize_utc_value(message.get("Utc")) or fallback_date,
                "lap_number": to_int(message.get("Lap")),
                "category": message.get("Category"),
                "flag": message.get("Flag"),
                "scope": message.get("Scope"),
                "message": text,
                "driver_number": driver_number,
            })
    return rows


def normalize_livetiming_session_status(records, session_key=None, stream_start_utc=None):
    """Flatten SessionData StatusSeries into track/session status rows.

    StatusSeries carries the authoritative track-state transitions (Yellow,
    SCDeployed, VSCDeployed, Red, AllClear) and session-state transitions
    (Started, Finished, Finalised) with UTC timestamps. Keyframes hold plain
    lists; stream deltas address entries as index-keyed dicts —
    collection_items() accepts both.
    """
    rows = []
    for timestamp, payload in records or []:
        fallback_date = date_from_elapsed(timestamp, stream_start_utc)
        for item in collection_items(payload, "StatusSeries"):
            if not isinstance(item, dict):
                continue
            track_status = item.get("TrackStatus")
            session_status = item.get("SessionStatus")
            if track_status is None and session_status is None:
                continue
            rows.append({
                "session_key": session_key,
                "date": normalize_utc_value(item.get("Utc")) or fallback_date,
                "track_status": track_status,
                "session_status": session_status,
            })
    return sorted(rows, key=lambda row: row["date"] or "")


def normalize_livetiming_team_radio(records, session_path, session_key=None, stream_start_utc=None):
    rows = []
    session_base = urljoin(LIVETIMING_STATIC_BASE, session_path)
    for timestamp, payload in records or []:
        fallback_date = date_from_elapsed(timestamp, stream_start_utc)
        for capture in collection_items(payload, "Captures"):
            if not isinstance(capture, dict):
                continue
            rows.append({
                "session_key": session_key,
                "date": normalize_utc_value(capture.get("Utc")) or fallback_date,
                "driver_number": to_int(capture.get("RacingNumber")),
                "recording_url": urljoin(session_base, capture.get("Path") or ""),
            })
    return rows


def iter_timing_lines(records, stream_start_utc=None):
    for timestamp, payload in records or []:
        date = date_from_elapsed(timestamp, stream_start_utc)
        lines = (payload or {}).get("Lines") or {}
        if not isinstance(lines, dict):
            continue
        for driver_number, line in lines.items():
            # Stream deltas can carry deletion markers ("_deleted") or other
            # non-numeric keys alongside driver lines
            number = to_int(driver_number)
            if number is None or not isinstance(line, dict):
                continue
            yield date, number, line


def normalize_livetiming_position(records, session_key=None, stream_start_utc=None):
    rows = []
    for date, driver_number, line in iter_timing_lines(records, stream_start_utc):
        position = to_int(line.get("Position"))
        if position is None:
            continue
        rows.append({
            "session_key": session_key,
            "driver_number": driver_number,
            "position": position,
            "date": date,
        })
    return sorted(rows, key=lambda row: (row["date"] or "", row["position"], row["driver_number"]))


def normalize_livetiming_intervals(records, session_key=None, stream_start_utc=None):
    """TimingData is a partial-update stream: a delta only produces a row when
    it touches a gap field, and the other field carries forward per driver —
    otherwise position-only deltas would emit null gaps that overwrite real
    ones in latest-row-per-driver consumers (live timing, replay context)."""
    rows = []
    known_by_driver = {}
    for date, driver_number, line in iter_timing_lines(records, stream_start_utc):
        interval_section = line.get("IntervalToPositionAhead")
        has_interval = isinstance(interval_section, dict) and "Value" in interval_section
        has_gap = "GapToLeader" in line
        known = known_by_driver.setdefault(
            driver_number, {"interval": None, "gap_to_leader": None, "position": 999}
        )
        position = to_int(line.get("Position"))
        if position is not None:
            known["position"] = position
        if has_interval:
            known["interval"] = parse_gap_value(interval_section.get("Value"))
        if has_gap:
            known["gap_to_leader"] = parse_gap_value(line.get("GapToLeader"))
        if not has_interval and not has_gap:
            continue
        rows.append({
            "session_key": session_key,
            "driver_number": driver_number,
            "interval": known["interval"],
            "gap_to_leader": known["gap_to_leader"],
            "date": date,
            "_position": known["position"],
        })
    rows.sort(key=lambda row: (row["date"] or "", row["_position"], row["driver_number"]))
    for row in rows:
        row.pop("_position", None)
    return rows


def normalize_livetiming_stints(records, session_key=None, stream_start_utc=None):
    rows = []
    for timestamp, payload in records or []:
        date = date_from_elapsed(timestamp, stream_start_utc)
        stints_by_driver = (payload or {}).get("Stints") or {}
        if not isinstance(stints_by_driver, dict):
            continue
        for driver_number, stints in stints_by_driver.items():
            if to_int(driver_number) is None:
                continue
            if isinstance(stints, list):
                iterable = enumerate(stints)
            elif isinstance(stints, dict):
                iterable = sorted(stints.items(), key=lambda item: to_int(item[0]) or 0)
            else:
                continue
            completed_laps = 0
            for stint_index, stint in iterable:
                if not isinstance(stint, dict):
                    continue
                start_laps = to_int(stint.get("StartLaps")) or 0
                total_laps = to_int(stint.get("TotalLaps"))
                if total_laps is None:
                    continue
                stint_laps = total_laps - start_laps
                if stint_laps <= 0:
                    continue
                lap_start = completed_laps + 1
                completed_laps += stint_laps
                rows.append({
                    "session_key": session_key,
                    "driver_number": int(driver_number),
                    "stint_number": int(stint_index) + 1,
                    "lap_start": lap_start,
                    "lap_end": completed_laps,
                    "compound": stint.get("Compound"),
                    "tyre_age_at_start": start_laps,
                    "date": date,
                    "new": str(stint.get("New", "")).lower() == "true",
                })
    return sorted(rows, key=lambda row: (row["driver_number"], row["stint_number"], row["lap_start"]))


def align_stints_with_lap_runs(stints, laps):
    """Realign stint lap ranges to the runs visible in the lap stream.

    TyreStintSeries carries per-stint lap counts from the timing lap counter,
    which drifts from the lap records in qualifying-style sessions (the first
    out-lap is never counted), landing every stint boundary one lap early and
    leaving the final lap uncovered. The lap stream knows the real run
    boundaries — a run starts at lap 1 or at a pit-out lap — so when a
    driver's stint count matches their run count, each stint takes its run's
    lap range. Drivers whose counts disagree keep the accumulated ranges.
    """
    runs_by_driver = {}
    run_has_timed_lap = {}
    ordered_laps = sorted(
        (lap for lap in (laps if isinstance(laps, list) else []) if isinstance(lap, dict)),
        key=lambda lap: (to_int(lap.get("driver_number")) or 0, to_int(lap.get("lap_number")) or 0),
    )
    for lap in ordered_laps:
        driver_number = to_int(lap.get("driver_number"))
        lap_number = to_int(lap.get("lap_number"))
        if driver_number is None or lap_number is None:
            continue
        runs = runs_by_driver.setdefault(driver_number, [])
        # A pit-out lap starts a new run — except when the run so far is only
        # the counter-initialization phantom (date-less lap 1): the first
        # out-lap belongs with it so stint 1 stays anchored at lap 1.
        starts_new_run = bool(lap.get("is_pit_out_lap")) and run_has_timed_lap.get(driver_number, False)
        if not runs or starts_new_run:
            runs.append([lap_number, lap_number])
            run_has_timed_lap[driver_number] = False
        else:
            runs[-1][1] = max(runs[-1][1], lap_number)
        if lap.get("date_start") is not None:
            run_has_timed_lap[driver_number] = True

    rows = [dict(stint) if isinstance(stint, dict) else stint for stint in (stints if isinstance(stints, list) else [])]
    stints_by_driver = {}
    for row in rows:
        if isinstance(row, dict):
            stints_by_driver.setdefault(to_int(row.get("driver_number")), []).append(row)

    for driver_number, driver_rows in stints_by_driver.items():
        runs = runs_by_driver.get(driver_number)
        if not runs or len(runs) != len(driver_rows):
            continue
        driver_rows.sort(key=lambda row: (row.get("stint_number") or 0, row.get("lap_start") or 0))
        for row, (run_start, run_end) in zip(driver_rows, runs):
            row["lap_start"] = run_start
            row["lap_end"] = run_end
    return rows


def normalize_livetiming_pit(records, session_key=None, stream_start_utc=None):
    rows = []
    for timestamp, payload in records or []:
        date = date_from_elapsed(timestamp, stream_start_utc)
        pit_times = (payload or {}).get("PitTimes") or {}
        for driver_key, pit in pit_times.items():
            if driver_key == "_deleted" or not isinstance(pit, dict):
                continue
            rows.append({
                "session_key": session_key,
                "driver_number": to_int(pit.get("RacingNumber") or driver_key),
                "lap_number": to_int(pit.get("Lap")),
                "pit_duration": to_float(pit.get("Duration")),
                "date": normalize_utc_value(pit.get("Utc")) or normalize_utc_value(pit.get("Timestamp")) or date,
            })
    return rows


def normalize_livetiming_results(records, session_key=None, stream_start_utc=None):
    latest_by_driver = {}
    for date, driver_number, line in iter_timing_lines(records, stream_start_utc):
        latest_by_driver[driver_number] = (date, line)

    rows = []
    for driver_number, (date, line) in latest_by_driver.items():
        best_lap_times = line.get("BestLapTimes")
        qualifying_durations = None
        qualifying_gaps = None
        if isinstance(best_lap_times, list):
            qualifying_durations = [
                parse_duration_seconds(best_lap_times[index]) if index < len(best_lap_times) else None
                for index in range(3)
            ]
            stats = line.get("Stats") if isinstance(line.get("Stats"), list) else []
            qualifying_gaps = [
                parse_gap_value(stats[index].get("TimeDiffToFastest")) if index < len(stats) and isinstance(stats[index], dict) else None
                for index in range(3)
            ]

        gap = qualifying_gaps if qualifying_gaps is not None else parse_gap_value(line.get("GapToLeader"))
        retired = bool(line.get("Retired"))
        stopped = bool(line.get("Stopped"))
        rows.append({
            "session_key": session_key,
            "driver_number": driver_number,
            "position": to_int(line.get("Position")),
            "number_of_laps": to_int(line.get("NumberOfLaps")),
            "duration": qualifying_durations if qualifying_durations is not None else None,
            "gap_to_leader": gap,
            "status": "Retired" if retired else ("Stopped" if stopped else None),
            "dnf": retired,
            "dns": False,
            "dsq": False,
            "points": None,
            "date": date,
        })
    return sorted(rows, key=lambda row: (row["position"] is None, row["position"] or 999, row["driver_number"]))


def merge_timing_delta(state, delta):
    """Deep-merge a TimingData stream delta into accumulated per-driver state.

    Keyframe payloads carry list sections (e.g. Sectors) while stream deltas
    address the same items as index-keyed dicts, so lists are stored as dicts
    keyed by their stringified index.
    """
    for key, value in (delta or {}).items():
        if isinstance(value, list):
            value = {str(index): item for index, item in enumerate(value)}
        if isinstance(value, dict):
            node = state.get(key)
            if not isinstance(node, dict):
                node = {}
                state[key] = node
            merge_timing_delta(node, value)
        else:
            state[key] = value


def normalize_livetiming_laps(records, session_key=None, stream_start_utc=None, race_start_utc=None):
    """Rebuild OpenF1-style lap rows from the TimingData delta stream.

    TimingData is a partial-update stream: sector times, speeds, position and
    the lap counter arrive in separate records, so state is accumulated per
    driver and a lap row is emitted when NumberOfLaps increments (a line
    crossing). Lap 1 carries no LastLapTime upstream; for races its start is
    the green-light time (race_start_utc) and its duration falls back to the
    crossing-to-crossing wall clock.
    """
    stream_anchor = parse_utc_datetime(stream_start_utc)
    race_start = parse_utc_datetime(race_start_utc)
    states = {}
    trackers = {}
    rows = []
    for timestamp, payload in records or []:
        elapsed = elapsed_to_timedelta(timestamp)
        event_time = stream_anchor + elapsed if stream_anchor is not None and elapsed is not None else None
        for driver_key, delta in ((payload or {}).get("Lines") or {}).items():
            if not isinstance(delta, dict):
                continue
            driver_number = to_int(driver_key)
            if driver_number is None:
                continue
            state = states.setdefault(driver_number, {})
            tracker = trackers.setdefault(driver_number, {"lap": 0, "completed_at": None, "pit_out": False})
            merge_timing_delta(state, delta)
            pit_out_here = bool(delta.get("PitOut"))
            lap_count = to_int(state.get("NumberOfLaps"))
            if lap_count is None or lap_count <= tracker["lap"]:
                if pit_out_here:
                    tracker["pit_out"] = True
                continue

            # The driver just completed lap `lap_count` at `event_time`.
            # Only trust LastLapTime delivered with this crossing; the merged
            # state would report the previous lap's time.
            lap_duration = parse_duration_seconds(delta.get("LastLapTime")) if "LastLapTime" in delta else None
            date_start = None
            if lap_count == tracker["lap"] + 1 and tracker["completed_at"] is not None:
                date_start = tracker["completed_at"]
            elif lap_count == 1 and race_start is not None:
                date_start = race_start
            elif event_time is not None and lap_duration is not None:
                date_start = event_time - timedelta(seconds=lap_duration)
            if date_start is not None and event_time is not None:
                # After a garage stay, upstream LastLapTime is measured from
                # pit entry — before this lap's start at pit exit — so it
                # overshoots the crossing-to-crossing wall clock and makes the
                # lap window overlap the next lap. The wall clock wins then.
                wall_clock = round((event_time - date_start).total_seconds(), 3)
                overshoots = lap_duration is not None and lap_duration > wall_clock + LAP_DURATION_OVERSHOOT_SECONDS
                if wall_clock > 0 and (lap_duration is None or overshoots):
                    lap_duration = wall_clock

            rows.append({
                "session_key": session_key,
                "driver_number": driver_number,
                "lap_number": lap_count,
                "date_start": format_utc(date_start) if date_start is not None else None,
                "lap_duration": lap_duration,
                "duration_sector_1": parse_duration_seconds(timing_section_value(state, "Sectors", 0)),
                "duration_sector_2": parse_duration_seconds(timing_section_value(state, "Sectors", 1)),
                "duration_sector_3": parse_duration_seconds(timing_section_value(state, "Sectors", 2)),
                "i1_speed": to_int(timing_section_value(state, "Speeds", "I1")),
                "i2_speed": to_int(timing_section_value(state, "Speeds", "I2")),
                "st_speed": to_int(timing_section_value(state, "Speeds", "ST")),
                "position": to_int(state.get("Position")),
                "is_pit_out_lap": tracker["pit_out"] and lap_count > 1,
            })
            tracker["lap"] = lap_count
            tracker["completed_at"] = event_time
            # A PitOut delivered with the crossing itself marks this event as
            # the pit exit (quali garage exits bump the lap counter with the
            # PitOut delta), so the lap *starting* here is the out-lap.
            tracker["pit_out"] = pit_out_here
    return sorted(rows, key=lambda row: (row["driver_number"], row["lap_number"]))


CHANNEL_MAP = {
    "0": "rpm",
    "2": "speed",
    "3": "n_gear",
    "4": "throttle",
    "5": "brake",
    "45": "drs",
}


def flatten_car_data_z(records, session_key=None):
    for _stream_ts, payload in records or []:
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
                row.update({
                    target: channels.get(source)
                    for source, target in CHANNEL_MAP.items()
                })
                yield row


def flatten_position_z(records, session_key=None):
    for _stream_ts, payload in records or []:
        decoded = decode_z_payload(payload)
        for position_entry in decoded.get("Position") or []:
            date = position_entry.get("Timestamp")
            for driver_number, entry in (position_entry.get("Entries") or {}).items():
                yield {
                    "session_key": session_key,
                    "date": date,
                    "driver_number": int(driver_number),
                    "status": entry.get("Status"),
                    "x": entry.get("X"),
                    "y": entry.get("Y"),
                    "z": entry.get("Z"),
                }
