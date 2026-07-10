// ===== Session Replay (location data on the circuit map) =====
// Lap-window replay on a session timeline: the reference driver's laps define
// per-lap time windows, the whole field's positions animate over them, and
// playback auto-advances across laps (see
// doc/2026-07-05-session-replay-tab-design.md and the original single-lap
// design in doc/2026-07-04-track-replay-design.md). Race/Sprint sessions add
// a driver-less "Full race" mode whose windows follow the race leader
// (doc/2026-07-05-full-race-replay-design.md); Qualifying adds a driver-less
// "Full qualifying" mode whose windows slice the Q1/Q2/Q3 session phases
// (doc/2026-07-07-full-qualifying-replay-design.md).

// Hide a car when the gap between its bracketing samples exceeds this (garage/retirement)
const REPLAY_SAMPLE_GAP_SECONDS = 4;
// Start prefetching the next lap's payload this many seconds before the window ends
const REPLAY_PREFETCH_LEAD_SECONDS = 15;
// Cap a timeline segment's rendered width at this multiple of the median lap
// window so out-laps / red-flag gaps don't dwarf flying laps
const REPLAY_TIMELINE_WIDTH_CAP = 3;
const REPLAY_KEYBOARD_SEEK_SECONDS = 5;

// Sentinel select value / state.replay.driverNumber for full-race mode:
// the backend serves leader-based race-lap windows when driver_number is omitted
const REPLAY_FULL_RACE = 'race';

// Sentinel for full-session mode (Qualifying): quali lap numbers are
// per-driver, so the timeline slices the Q1/Q2/Q3 session phases into fixed
// windows and the backend serves each slice as an explicit start/end window
// (doc/2026-07-07-full-qualifying-replay-design.md)
const REPLAY_FULL_SESSION = 'session';
// Target duration of one full-session timeline slice
const REPLAY_SESSION_SLICE_SECONDS = 120;
// Cooldown appended after each qualifying phase's Finished so the replay
// covers drivers finishing their final flying lap and returning to the pits
const REPLAY_PHASE_COOLDOWN_MS = 180000;

// Map projection: square viewBox shared by the 2D and 3D views
const REPLAY_VIEWBOX_SIZE = 1000;
const REPLAY_MAP_PADDING = 100;

// 3D view: the depth axis is foreshortened by this factor (cos of the fixed
// camera tilt), drags rotate this many degrees per pixel, and the extruded
// track base sits this many view units below the outline
const REPLAY_3D_DEPTH_SCALE = 0.52;
const REPLAY_3D_YAW_PER_PIXEL = 0.4;
const REPLAY_3D_BASE_DROP = 24;
// Drags travelling further than this swallow the release click so rotating
// doesn't toggle a car's focus highlight
const REPLAY_3D_DRAG_CLICK_THRESHOLD_PX = 4;

// Circuit-state precedence when periods overlap (e.g. sector yellows under SC)
const REPLAY_STATE_PRIORITY = ['red', 'sc', 'vsc', 'yellow'];

const REPLAY_STATE_LABELS = {
    green: 'Green',
    yellow: 'Yellow',
    sc: 'Safety Car',
    vsc: 'Virtual SC',
    red: 'Red Flag',
    chequered: 'Finished'
};

const REPLAY_PERIOD_LABELS = {
    yellow: 'Yellow flag',
    sc: 'Safety car',
    vsc: 'Virtual safety car',
    red: 'Red flag'
};

// Merge overlapping yellow spans into union bands so a burst of sector
// yellows renders as one strip instead of a stack of near-duplicates.
function mergeYellowPeriods(periods) {
    const yellows = periods.filter(p => p.type === 'yellow').sort((a, b) => a.startMs - b.startMs);
    const others = periods.filter(p => p.type !== 'yellow');

    const merged = [];
    yellows.forEach(period => {
        const last = merged[merged.length - 1];
        if (last && period.startMs <= last.endMs) {
            last.endMs = Math.max(last.endMs, period.endMs);
        } else {
            merged.push({ ...period, label: REPLAY_PERIOD_LABELS.yellow });
        }
    });

    return others.concat(merged).sort((a, b) => a.startMs - b.startMs);
}

// Parse circuit-state periods (red / SC / VSC / yellows) and the chequered
// flag out of race control messages. Message shapes are grounded in real
// F1 Livetiming-compatible payloads (doc/2026-07-05-replay-race-control-timeline-design.md):
// races signal red as "RED FLAG - RACE SUSPENDED" with flag=None, SC/VSC end
// with a track-scope CLEAR ("TRACK CLEAR"), quali reds end at the GREEN
// pit-exit reopen.
function extractCircuitStatePeriods(records) {
    const sorted = (Array.isArray(records) ? records : [])
        .map(record => ({ record, ms: record && record.date ? new Date(record.date).getTime() : NaN }))
        .filter(item => Number.isFinite(item.ms))
        .sort((a, b) => a.ms - b.ms);

    const periods = [];
    let chequeredMs = null;
    let red = null;            // startMs of an open red flag
    let car = null;            // { type: 'sc'|'vsc', startMs } of an open (V)SC
    const yellows = new Map(); // 'track' | sector number string -> startMs

    const closeYellows = (endMs) => {
        yellows.forEach(startMs => {
            periods.push({ type: 'yellow', startMs, endMs, label: REPLAY_PERIOD_LABELS.yellow });
        });
        yellows.clear();
    };
    const closeCar = (endMs) => {
        if (car === null) return;
        periods.push({ type: car.type, startMs: car.startMs, endMs, label: REPLAY_PERIOD_LABELS[car.type] });
        car = null;
    };
    const closeRed = (endMs) => {
        if (red === null) return;
        periods.push({ type: 'red', startMs: red, endMs, label: REPLAY_PERIOD_LABELS.red });
        red = null;
    };

    sorted.forEach(({ record, ms }) => {
        const message = (record.message || '').toUpperCase();
        const flag = (record.flag || '').toUpperCase();
        const scope = (record.scope || '').toUpperCase();
        const sector = record.sector !== null && record.sector !== undefined ? String(record.sector) : null;

        if (flag === 'CHEQUERED') {
            // Quali waves a chequered flag at the end of each Q segment; the
            // session's flag is the last one still standing (a track-scope
            // green — the next segment's pit-exit reopen — clears it below)
            chequeredMs = ms;
            return;
        }
        // startsWith: steward notes like "INCIDENT ... - RED FLAG INFRINGEMENT"
        // mention the red flag without raising one
        if (flag === 'RED' || message.startsWith('RED FLAG')) {
            closeYellows(ms);
            closeCar(ms);
            if (red === null) red = ms;
            return;
        }
        if (message.includes('SAFETY CAR DEPLOYED') && !message.includes('VIRTUAL')) {
            closeCar(ms);
            car = { type: 'sc', startMs: ms };
            return;
        }
        if (message.includes('VSC DEPLOYED') || message.includes('VIRTUAL SAFETY CAR DEPLOYED')) {
            closeCar(ms);
            car = { type: 'vsc', startMs: ms };
            return;
        }
        if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') {
            const key = scope === 'SECTOR' && sector !== null ? sector : 'track';
            if (!yellows.has(key)) yellows.set(key, ms);
            return;
        }
        if (flag === 'CLEAR' || flag === 'GREEN') {
            if (scope === 'SECTOR' && sector !== null) {
                if (yellows.has(sector)) {
                    periods.push({ type: 'yellow', startMs: yellows.get(sector), endMs: ms, label: REPLAY_PERIOD_LABELS.yellow });
                    yellows.delete(sector);
                }
                return;
            }
            // Track-scope GREEN / "TRACK CLEAR" ends every open period; the
            // session is running again, so any earlier chequered flag (a
            // finished quali segment) no longer stands
            closeYellows(ms);
            closeCar(ms);
            closeRed(ms);
            chequeredMs = null;
        }
    });

    // Anything still open (live session, feed gap) runs to the timeline edge;
    // the renderer clamps Infinity to the visible range.
    closeYellows(Infinity);
    closeCar(Infinity);
    closeRed(Infinity);

    return { periods: mergeYellowPeriods(periods), chequeredMs };
}

// Per-sector yellow spans from race control messages ("YELLOW IN TRACK
// SECTOR 8" ... sector-scope CLEAR), keeping the sector identity that
// extractCircuitStatePeriods merges away — the map's marshal-sector
// highlights need to know *which* sector is yellow. Closure rules mirror
// extractCircuitStatePeriods: a sector-scope CLEAR/GREEN ends that sector,
// a track-scope CLEAR/GREEN or a red flag ends every open sector yellow.
function extractSectorYellowPeriods(records) {
    const sorted = (Array.isArray(records) ? records : [])
        .map(record => ({ record, ms: record && record.date ? new Date(record.date).getTime() : NaN }))
        .filter(item => Number.isFinite(item.ms))
        .sort((a, b) => a.ms - b.ms);

    const periods = [];
    const open = new Map(); // sector number -> { startMs, double }

    const closeSector = (sector, endMs) => {
        const entry = open.get(sector);
        if (!entry) return;
        periods.push({ sector, double: entry.double, startMs: entry.startMs, endMs });
        open.delete(sector);
    };
    const closeAll = (endMs) => {
        [...open.keys()].forEach(sector => closeSector(sector, endMs));
    };

    // The sector number rides on the record when the normalizer kept it;
    // older cached rows only carry it in the message text ("... TRACK SECTOR 8")
    const sectorOf = (record, message) => {
        // Number(null) is 0, so a missing field must not look like sector 0
        const fromField = record.sector === null || record.sector === undefined
            ? NaN
            : Number(record.sector);
        if (Number.isFinite(fromField)) return fromField;
        const match = message.match(/TRACK SECTOR (\d+)/);
        return match ? Number(match[1]) : NaN;
    };

    sorted.forEach(({ record, ms }) => {
        const message = (record.message || '').toUpperCase();
        const flag = (record.flag || '').toUpperCase();
        const scope = (record.scope || '').toUpperCase();
        const sector = sectorOf(record, message);
        const isSectorScope = scope === 'SECTOR' && Number.isFinite(sector);

        if (flag === 'RED' || message.startsWith('RED FLAG')) {
            closeAll(ms);
            return;
        }
        if ((flag === 'YELLOW' || flag === 'DOUBLE YELLOW') && isSectorScope) {
            const double = flag === 'DOUBLE YELLOW';
            const existing = open.get(sector);
            if (!existing) {
                open.set(sector, { startMs: ms, double });
            } else if (double && !existing.double) {
                // Escalation: the single yellow ends where the double begins
                closeSector(sector, ms);
                open.set(sector, { startMs: ms, double: true });
            }
            return;
        }
        if (flag === 'CLEAR' || flag === 'GREEN') {
            if (isSectorScope) {
                closeSector(sector, ms);
                return;
            }
            closeAll(ms);
        }
    });

    // Sectors still yellow (live session, feed gap) run to the timeline edge
    closeAll(Infinity);
    return periods;
}

// SessionData StatusSeries track-status values mapped to replay band types.
// TrackStatus is a single track-wide state machine: each value replaces the
// previous one, and the *Ending values keep the same band open until AllClear.
const REPLAY_TRACK_STATUS_TYPES = {
    'YELLOW': 'yellow',
    'SCDEPLOYED': 'sc',
    'SCENDING': 'sc',
    'VSCDEPLOYED': 'vsc',
    'VSCENDING': 'vsc',
    'RED': 'red'
};

// Build circuit-state periods from /api/session_status rows (Livetiming
// SessionData StatusSeries) — authoritative track-status transitions with UTC
// timestamps, unlike the text heuristics over race control messages above.
function extractCircuitStatePeriodsFromStatus(rows) {
    const sorted = (Array.isArray(rows) ? rows : [])
        .map(row => ({ row, ms: row && row.date ? new Date(row.date).getTime() : NaN }))
        .filter(item => Number.isFinite(item.ms))
        .sort((a, b) => a.ms - b.ms);

    const periods = [];
    let open = null; // { type, startMs } of the current non-green track state
    let chequeredMs = null;
    let started = false;

    const closeOpen = (endMs) => {
        if (!open) return;
        periods.push({ type: open.type, startMs: open.startMs, endMs, label: REPLAY_PERIOD_LABELS[open.type] });
        open = null;
    };

    sorted.forEach(({ row, ms }) => {
        const sessionStatus = (row.session_status || '').toUpperCase();
        if (sessionStatus) {
            if (sessionStatus === 'STARTED') {
                started = true;
                // Running again: an earlier chequered flag (a finished quali
                // segment) no longer stands, so the session's flag ends up
                // being the last Finished
                chequeredMs = null;
            } else if (started && sessionStatus === 'FINISHED') {
                chequeredMs = ms;
            } else if (started && chequeredMs === null && sessionStatus === 'FINALISED') {
                // Finalised covers feeds that never emit Finished
                chequeredMs = ms;
            }
            return;
        }

        const trackStatus = (row.track_status || '').toUpperCase();
        if (!trackStatus) return;
        const type = REPLAY_TRACK_STATUS_TYPES[trackStatus];
        if (!type) {
            // AllClear (or any unmapped green-ish status) ends the open period
            closeOpen(ms);
            return;
        }
        if (open && open.type === type) return; // e.g. SCDeployed → SCEnding stays one band
        closeOpen(ms);
        open = { type, startMs: ms };
    });

    // A state still open at feed end (live session) runs to the timeline edge
    closeOpen(Infinity);

    return { periods: mergeYellowPeriods(periods), chequeredMs };
}

// Circuit-state source for the replay: prefer the authoritative SessionData
// StatusSeries, fall back to race-control message parsing when a session has
// no usable status feed.
function getReplayCircuitStates() {
    // Sector-level yellows always come from race control — the StatusSeries
    // is a single track-wide state machine with no sector granularity.
    const sectorYellows = extractSectorYellowPeriods(state.raceControl);
    const fromStatus = extractCircuitStatePeriodsFromStatus(state.sessionStatusSeries);
    if (fromStatus.periods.length > 0 || fromStatus.chequeredMs !== null) {
        return { ...fromStatus, sectorYellows };
    }
    return { ...extractCircuitStatePeriods(state.raceControl), sectorYellows };
}

function resetReplay() {
    if (state.replay && state.replay.rafId !== null) {
        cancelAnimationFrame(state.replay.rafId);
    }
    state.replay = createReplayState();
    state.replayCache = {};
    replayFetchPromises = {};

    if (DOM.replayPlayBtn) {
        DOM.replayPlayBtn.disabled = true;
        setReplayPlayIcon(false);
    }
    if (DOM.replayScrubber) {
        DOM.replayScrubber.disabled = true;
        DOM.replayScrubber.value = 0;
        DOM.replayScrubber.setAttribute('aria-valuetext', '0.0 of 0.0 seconds');
    }
    if (DOM.replayTimeLabel) {
        DOM.replayTimeLabel.textContent = '0.0s / 0.0s';
    }
    resetReplaySpeedToggle();
    clearReplayRaceContext();
    clearReplayTelemetryStrip();
    clearReplayTeamRadioTicker();
    if (DOM.replayTimeline) {
        DOM.replayTimeline.innerHTML = '';
    }
    renderReplayMessage('Select a session to replay track positions.');
    updateReplayCircuitState();
}

// Full-race windows need field-wide lap numbering, which only Race/Sprint
// sessions have (the same gate as pit annotations)
function replaySupportsFullRace() {
    return isPitAnnotationSession(state.selectedSession);
}

// Full-session windows come from the session-status phases, which is how
// Qualifying is segmented (Q1/Q2/Q3); Race/Sprint keep the lap-based
// full-race mode instead
function replaySupportsFullSession() {
    return isQualifyingSession(state.selectedSession) && !replaySupportsFullRace();
}

// Whole-field selections replay every car with no reference driver
function isReplayWholeFieldSelection(value) {
    return value === REPLAY_FULL_RACE || value === REPLAY_FULL_SESSION;
}

// A replay selection is either a whole-field sentinel or a driver number
function normalizeReplaySelection(value) {
    return isReplayWholeFieldSelection(value) ? value : Number(value);
}

function isValidReplaySelection(value) {
    return isReplayWholeFieldSelection(value) || Number.isFinite(value);
}

function setReplayPlayIcon(playing) {
    if (!DOM.replayPlayBtn) return;
    const icon = DOM.replayPlayBtn.querySelector('.material-icons-round');
    if (icon) icon.textContent = playing ? 'pause' : 'play_arrow';
    DOM.replayPlayBtn.setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
}

function setReplayStageStatus(status, text) {
    if (DOM.replayStageStatus) DOM.replayStageStatus.dataset.state = status;
    if (DOM.replayStageStatusText) DOM.replayStageStatusText.textContent = text;
}

function renderReplayMessage(text, status = 'idle') {
    if (DOM.replayMapContent) {
        DOM.replayMapContent.innerHTML = `<div class="replay-message">${escapeHtml(text)}</div>`;
    }
    // The message replaced the SVG, so the scene's nodes are gone from the DOM
    if (state.replay) state.replay.scene = null;
    const statusText = {
        idle: 'Waiting for replay data',
        loading: 'Loading track positions',
        unavailable: 'Position data unavailable',
        error: 'Replay unavailable'
    }[status] || 'Waiting for replay data';
    setReplayStageStatus(status, statusText);
}

function setupReplaySection() {
    if (!DOM.replayCard || !DOM.replayDriverSelect) return;

    if (!Array.isArray(state.drivers) || state.drivers.length === 0) {
        DOM.replayDriverSelect.innerHTML = '';
        // No drivers, but race control can still describe the session
        state.replay.timeline = buildRaceControlTimeline();
        renderReplayTimeline();
        renderReplayMessage(state.replay.timeline
            ? 'No drivers available — the timeline shows race control track states.'
            : 'No drivers available for this session.', 'unavailable');
        return;
    }

    const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    const options = sortedDrivers.map(d => {
        const label = d.full_name || d.broadcast_name || `Driver ${d.driver_number}`;
        return `<option value="${escapeHtml(d.driver_number)}">${escapeHtml(label)} (#${escapeHtml(d.driver_number)})</option>`;
    });
    // Full race is the default view for Race/Sprint: no driver to pick,
    // playback starts from lap 1 of the whole field. Qualifying gets the
    // equivalent full-session view, starting from the Q1 green light.
    if (replaySupportsFullRace()) {
        options.unshift(`<option value="${REPLAY_FULL_RACE}">Full race — whole field</option>`);
    } else if (replaySupportsFullSession()) {
        options.unshift(`<option value="${REPLAY_FULL_SESSION}">Full qualifying — whole field</option>`);
    }
    DOM.replayDriverSelect.innerHTML = options.join('');

    renderReplayMessage('Replay loads when the Session Replay tab is open.');
    setupReplayTimeline().then(() => maybeAutoLoadReplay());
}

// Build the session timeline. The race-control timeline renders immediately
// (circuit states need no driver); lap data upgrades it to seekable segments
// when it arrives — the reference driver's laps preselecting the fastest lap,
// or in full-race mode the leader's race laps starting from lap 1.
async function setupReplayTimeline() {
    if (!DOM.replayTimeline || !DOM.replayDriverSelect || !state.selectedSession) return;

    const selection = normalizeReplaySelection(DOM.replayDriverSelect.value);
    if (!isValidReplaySelection(selection)) return;
    const isFullRace = selection === REPLAY_FULL_RACE;
    const isFullSession = selection === REPLAY_FULL_SESSION;

    state.replay.driverNumber = selection;
    state.replay.lapNumber = null;
    state.replay.timeline = buildRaceControlTimeline();
    if (state.replay.timeline) {
        renderReplayTimeline();
        prepareReplayRaceContext();
    } else {
        DOM.replayTimeline.innerHTML = '<span class="replay-timeline-loading">Loading laps...</span>';
    }

    let timeline;
    if (isFullSession) {
        // Full-session slices come from the status series, already loaded
        timeline = buildFullSessionTimeline();
    } else {
        const laps = isFullRace
            ? await fetchAllSessionLaps(state.selectedSession.session_key)
            : await fetchDriverLaps(state.selectedSession.session_key, selection);

        // The user may have changed the selection while laps were loading
        if (state.replay.driverNumber !== selection) return;

        timeline = isFullRace ? buildFullRaceTimeline(laps) : buildReplayTimeline(laps);
    }
    if (!timeline) {
        const subject = isFullRace || isFullSession ? 'this session' : 'this driver';
        const missing = isFullSession ? 'session phase data' : 'lap data';
        // Keep the race-control timeline: states stay visible, playback needs windows
        if (state.replay.timeline) {
            renderReplayMessage(`No ${missing} for ${subject} — the timeline shows race control track states.`, 'unavailable');
        } else {
            DOM.replayTimeline.innerHTML = '';
            renderReplayMessage(`No ${missing} recorded for ${subject}.`, 'unavailable');
        }
        return;
    }

    state.replay.timeline = timeline;
    // Full race replays from the start; a driver preselects their fastest lap
    const initial = timeline.segments.find(seg => seg.isFastest) || timeline.segments[0];
    state.replay.lapNumber = initial.lapNumber;
    prepareReplayRaceContext();
    renderReplayTimeline();
    updateReplayRaceContext(true);
}

// Absolute session-time range covered by race control and the status series
// (and the session's own start/end), independent of any driver's laps.
function getRaceControlRangeMs() {
    let min = null;
    let max = null;
    const trackDates = (records) => (Array.isArray(records) ? records : []).forEach(record => {
        if (!record || !record.date) return;
        const ms = new Date(record.date).getTime();
        if (!Number.isFinite(ms)) return;
        if (min === null || ms < min) min = ms;
        if (max === null || ms > max) max = ms;
    });
    trackDates(state.raceControl);
    trackDates(state.sessionStatusSeries);

    const session = state.selectedSession || {};
    const sessionStart = session.date_start ? new Date(session.date_start).getTime() : NaN;
    const sessionEnd = session.date_end ? new Date(session.date_end).getTime() : NaN;
    if (Number.isFinite(sessionStart)) min = min === null ? sessionStart : Math.min(min, sessionStart);
    if (Number.isFinite(sessionEnd)) max = max === null ? sessionEnd : Math.max(max, sessionEnd);

    if (min === null || max === null || max <= min) return null;
    return { rangeStartMs: min, rangeEndMs: max };
}

// Driver-less timeline: a session-time bar derived from race control (and the
// session start/end) carrying only the circuit-state bands. Rendered before
// lap data arrives and kept when no usable laps exist.
function buildRaceControlTimeline() {
    const range = getRaceControlRangeMs();
    if (!range) return null;
    return {
        segments: [],
        displayTotal: 0,
        rangeStartMs: range.rangeStartMs,
        rangeEndMs: range.rangeEndMs,
        states: getReplayCircuitStates()
    };
}

// Clip circuit-state periods to [startMs, endMs] and express them as
// fractions of that span, for a container that covers exactly that range.
function stateBandsForRange(states, startMs, endMs) {
    if (!states || !Array.isArray(states.periods)) return [];
    const span = endMs - startMs;
    if (!(span > 0)) return [];

    const bands = [];
    states.periods.forEach(period => {
        const clampedStart = Math.max(period.startMs, startMs);
        const clampedEnd = Math.min(period.endMs, endMs);
        if (clampedEnd <= clampedStart) return;
        bands.push({
            type: period.type,
            label: period.label,
            startMs: clampedStart,
            endMs: clampedEnd,
            leftFrac: (clampedStart - startMs) / span,
            widthFrac: (clampedEnd - clampedStart) / span
        });
    });
    return bands;
}

// Frontend mirror of the backend's build_lap_telemetry_window: a lap's window
// is lap_duration when > 0, else the gap to the next lap's later date_start.
// Laps without a derivable window are excluded — the backend cannot serve them.
function buildReplayTimeline(laps) {
    const ordered = (Array.isArray(laps) ? laps : [])
        .filter(lap => lap && lap.lap_number !== null && lap.lap_number !== undefined)
        .sort((a, b) => Number(a.lap_number) - Number(b.lap_number));

    const segments = [];
    ordered.forEach((lap, index) => {
        const start = lap.date_start ? new Date(lap.date_start).getTime() : NaN;
        if (!Number.isFinite(start)) return;

        const duration = Number(lap.lap_duration);
        const hasTime = Number.isFinite(duration) && duration > 0;
        let seconds = hasTime ? duration : null;
        if (seconds === null) {
            for (let j = index + 1; j < ordered.length; j++) {
                const nextStart = ordered[j].date_start ? new Date(ordered[j].date_start).getTime() : NaN;
                if (Number.isFinite(nextStart) && nextStart > start) {
                    seconds = (nextStart - start) / 1000;
                    break;
                }
            }
        }
        if (!Number.isFinite(seconds) || seconds <= 0) return;

        segments.push({
            lapNumber: Number(lap.lap_number),
            startMs: start,
            endMs: start + seconds * 1000,
            seconds,
            hasTime,
            isFastest: false
        });
    });

    if (segments.length === 0) return null;

    // add time to last segment endMs
    const last = segments[segments.length - 1];
    if (last) {
        const range = getRaceControlRangeMs();
        if (range && range.rangeEndMs > last.endMs) last.endMs = range.rangeEndMs;
    }

    let fastest = null;
    segments.forEach(seg => {
        if (seg.hasTime && (!fastest || seg.seconds < fastest.seconds)) fastest = seg;
    });
    if (fastest) fastest.isFastest = true;

    return finalizeReplayTimeline(segments);
}

// Frontend mirror of the backend's build_race_lap_window: race lap N opens
// when the first driver starts lap N (the race leader) and closes when the
// first driver starts a later lap; the final lap closes at the latest lap end
// across the field so every car reaches the flag. No fastest-lap star — a
// window here is leader pace, not any single driver's lap time.
function buildFullRaceTimeline(allLaps) {
    const startsByLap = new Map();
    const completedLaps = new Set(); // lap numbers some driver has a duration for
    let latestEndMs = null;

    (Array.isArray(allLaps) ? allLaps : []).forEach(lap => {
        if (!lap || lap.lap_number === null || lap.lap_number === undefined) return;
        const lapNumber = Number(lap.lap_number);
        const start = lap.date_start ? new Date(lap.date_start).getTime() : NaN;
        if (!Number.isFinite(lapNumber) || !Number.isFinite(start)) return;

        const existing = startsByLap.get(lapNumber);
        if (existing === undefined || start < existing) startsByLap.set(lapNumber, start);

        const duration = Number(lap.lap_duration);
        if (Number.isFinite(duration) && duration > 0) {
            completedLaps.add(lapNumber);
            const end = start + duration * 1000;
            if (latestEndMs === null || end > latestEndMs) latestEndMs = end;
        }
    });

    const ordered = [...startsByLap.entries()].sort((a, b) => a[0] - b[0]);
    const segments = [];
    ordered.forEach(([lapNumber, startMs], index) => {
        let endMs = null;
        for (let j = index + 1; j < ordered.length; j++) {
            if (ordered[j][1] > startMs) {
                endMs = ordered[j][1];
                break;
            }
        }
        // Final lap closes at the latest lap end only once someone completed
        // it; a live in-progress lap gets no segment (mirrors the backend)
        if (endMs === null && completedLaps.has(lapNumber) && latestEndMs !== null && latestEndMs > startMs) {
            endMs = latestEndMs;
        }
        if (endMs === null) return;

        segments.push({
            lapNumber,
            startMs,
            endMs,
            seconds: (endMs - startMs) / 1000,
            hasTime: false,
            isFastest: false
        });
    });

    if (segments.length === 0) return null;
    return finalizeReplayTimeline(segments);
}

// Sprint Qualifying phases are conventionally SQ1..SQ3, plain Qualifying Q1..Q3
function qualifyingPhasePrefix() {
    const session = state.selectedSession || {};
    const name = String(session.session_name || '').toLowerCase();
    return name.includes('sprint') || name.includes('shootout') ? 'SQ' : 'Q';
}

// Qualifying phases (Q1/Q2/Q3) from the SessionData StatusSeries: a phase
// opens at Started and closes at Finished. Aborted (red flag) pauses the
// clock without ending the phase — the next Started resumes the same phase,
// so each phase spans first green to Finished including red-flag gaps.
function extractQualifyingPhases() {
    const rows = (Array.isArray(state.sessionStatusSeries) ? state.sessionStatusSeries : [])
        .map(row => ({
            status: String((row && row.session_status) || '').toUpperCase(),
            ms: row && row.date ? new Date(row.date).getTime() : NaN
        }))
        .filter(item => item.status && Number.isFinite(item.ms))
        .sort((a, b) => a.ms - b.ms);

    const prefix = qualifyingPhasePrefix();
    const phases = [];
    let openStartMs = null;
    rows.forEach(({ status, ms }) => {
        if (status === 'STARTED') {
            if (openStartMs === null) openStartMs = ms;
            return;
        }
        if (status === 'FINISHED' || status === 'FINALISED' || status === 'ENDS') {
            if (openStartMs !== null && ms > openStartMs) {
                phases.push({ label: `${prefix}${phases.length + 1}`, startMs: openStartMs, endMs: ms + REPLAY_PHASE_COOLDOWN_MS });
            }
            openStartMs = null;
        }
        // Aborted (or any other status) leaves the phase open
    });

    // A phase still open (live session) runs to the latest known session time
    if (openStartMs !== null) {
        const range = getRaceControlRangeMs();
        if (range && range.rangeEndMs > openStartMs) {
            phases.push({ label: `${prefix}${phases.length + 1}`, startMs: openStartMs, endMs: range.rangeEndMs });
        }
    }
    return phases;
}

// Tag timeline segments with the qualifying phase they belong to so the
// renderer can label the Q1/Q2/Q3 regions. A segment belongs to the latest
// phase started at-or-before it: in-laps completed after a phase's chequered
// flag still count to that phase.
function annotateQualifyingPhases(segments) {
    if (!isQualifyingSession(state.selectedSession)) return;
    const phases = extractQualifyingPhases();
    if (phases.length === 0) return;

    let previousLabel = null;
    segments.forEach(seg => {
        let phase = null;
        for (const candidate of phases) {
            if (seg.startMs >= candidate.startMs) phase = candidate;
            else break;
        }
        seg.phase = phase ? phase.label : null;
        seg.phaseStart = seg.phase !== null && seg.phase !== previousLabel;
        if (seg.phase !== null) previousLabel = seg.phase;
    });
}

// Driver-less qualifying timeline: each Q phase sliced into near-equal windows
// of about REPLAY_SESSION_SLICE_SECONDS. Slice indices act as the timeline's
// "lap" numbers; the backend serves each slice via explicit start/end params.
function buildFullSessionTimeline() {
    const phases = extractQualifyingPhases();

    const segments = [];
    phases.forEach(phase => {
        const durationMs = phase.endMs - phase.startMs;
        if (!(durationMs > 0)) return;
        const sliceCount = Math.max(1, Math.round(durationMs / (REPLAY_SESSION_SLICE_SECONDS * 1000)));
        const sliceMs = durationMs / sliceCount;
        for (let i = 0; i < sliceCount; i++) {
            const startMs = phase.startMs + i * sliceMs;
            const endMs = i === sliceCount - 1 ? phase.endMs : phase.startMs + (i + 1) * sliceMs;
            segments.push({
                lapNumber: segments.length + 1,
                startMs,
                endMs,
                seconds: (endMs - startMs) / 1000,
                hasTime: false,
                isFastest: false
            });
        }
    });

    if (segments.length === 0) return null;
    return finalizeReplayTimeline(segments);
}

// Shared timeline tail: capped display widths plus the race-control range/states.
// Display widths are capped so seeking stays precise on flying laps; the
// click-to-seek mapping uses each segment's real seconds, not its width.
function finalizeReplayTimeline(segments) {
    const sortedSeconds = segments.map(seg => seg.seconds).sort((a, b) => a - b);
    const median = sortedSeconds[Math.floor(sortedSeconds.length / 2)];
    const widthCap = median * REPLAY_TIMELINE_WIDTH_CAP;

    let displayTotal = 0;
    segments.forEach(seg => {
        seg.displayUnits = Math.min(seg.seconds, widthCap);
        seg.displayStart = displayTotal;
        displayTotal += seg.displayUnits;
    });

    annotateQualifyingPhases(segments);

    const range = getRaceControlRangeMs();
    return {
        segments,
        displayTotal,
        rangeStartMs: range ? Math.min(segments[0].startMs, range.rangeStartMs) : segments[0].startMs,
        rangeEndMs: range ? Math.max(segments[segments.length - 1].endMs, range.rangeEndMs) : segments[segments.length - 1].endMs,
        states: getReplayCircuitStates()
    };
}

// Append circuit-state strips (and the chequered marker) for the slice of
// session time a container covers. Strips are positioned as fractions of the
// container itself, so the flex gap between lap segments cannot misalign them.
function appendReplayStateBands(container, timeline, startMs, endMs) {
    stateBandsForRange(timeline.states, startMs, endMs).forEach(band => {
        const strip = document.createElement('span');
        strip.className = `replay-timeline-state state-${band.type}`;
        strip.style.left = `${(band.leftFrac * 100).toFixed(2)}%`;
        strip.style.width = `${(band.widthFrac * 100).toFixed(2)}%`;
        strip.title = `${band.label} · ${formatRaceControlTime(new Date(band.startMs))}–${formatRaceControlTime(new Date(band.endMs))}`;
        container.appendChild(strip);
    });

    const chequeredMs = timeline.states ? timeline.states.chequeredMs : null;
    if (chequeredMs !== null && chequeredMs >= startMs && chequeredMs <= endMs && endMs > startMs) {
        const marker = document.createElement('span');
        marker.className = 'replay-timeline-chequered';
        marker.style.left = `${(((chequeredMs - startMs) / (endMs - startMs)) * 100).toFixed(2)}%`;
        marker.title = `Chequered flag · ${formatRaceControlTime(new Date(chequeredMs))}`;
        container.appendChild(marker);
    }
}

function renderReplayTimeline() {
    if (!DOM.replayTimeline) return;
    const timeline = state.replay.timeline;
    if (!timeline) {
        DOM.replayTimeline.innerHTML = '';
        return;
    }

    // Label roughly every Nth lap so long races stay readable
    const labelStep = Math.max(1, Math.ceil(timeline.segments.length / 16));
    // Full-session slices are time windows, not laps: clock tooltips, no lap numbers
    const isFullSession = state.replay.driverNumber === REPLAY_FULL_SESSION;

    DOM.replayTimeline.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'replay-timeline-track';

    timeline.segments.forEach((seg, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'replay-timeline-segment';
        if (seg.isFastest) btn.classList.add('fastest');
        if (seg.lapNumber === state.replay.lapNumber) btn.classList.add('active');
        if (seg.phaseStart) btn.classList.add('phase-start');
        btn.dataset.lap = seg.lapNumber;
        btn.style.flexGrow = String(seg.displayUnits);
        const clockRange = `${formatRaceControlTime(new Date(seg.startMs))}–${formatRaceControlTime(new Date(seg.endMs))}`;
        if (isFullSession) {
            btn.title = `${seg.phase || 'Session'} · ${clockRange}`;
        } else {
            const timeText = seg.hasTime ? ` — ${formatLapTime(seg.seconds)}` : '';
            const phaseText = seg.phase ? ` (${seg.phase})` : '';
            btn.title = `Lap ${seg.lapNumber}${timeText}${seg.isFastest ? ' ★' : ''}${phaseText}`;
        }
        btn.setAttribute('aria-label', btn.title);

        // A phase region label (Q1/Q2/Q3) takes precedence over the lap number
        if (seg.phaseStart) {
            const label = document.createElement('span');
            label.className = 'replay-timeline-label phase';
            label.textContent = seg.phase;
            btn.appendChild(label);
        } else if (!isFullSession && (index % labelStep === 0 || seg.isFastest)) {
            const label = document.createElement('span');
            label.className = 'replay-timeline-label';
            label.textContent = seg.lapNumber;
            btn.appendChild(label);
        }
        appendReplayStateBands(btn, timeline, seg.startMs, seg.endMs);
        appendReplayPitMarkers(btn, seg);
        track.appendChild(btn);
    });

    // No lap segments: one session-spanning bar carrying the race-control
    // bands, bracketed by the session start/end clock times.
    if (timeline.segments.length === 0) {
        const base = document.createElement('div');
        base.className = 'replay-timeline-base';
        appendReplayStateBands(base, timeline, timeline.rangeStartMs, timeline.rangeEndMs);

        const startLabel = document.createElement('span');
        startLabel.className = 'replay-timeline-label';
        startLabel.textContent = formatRaceControlTime(new Date(timeline.rangeStartMs));
        base.appendChild(startLabel);

        const endLabel = document.createElement('span');
        endLabel.className = 'replay-timeline-label';
        endLabel.style.left = 'auto';
        endLabel.style.right = '4px';
        endLabel.textContent = formatRaceControlTime(new Date(timeline.rangeEndMs));
        base.appendChild(endLabel);

        track.appendChild(base);
    }

    const playhead = document.createElement('div');
    playhead.className = 'replay-timeline-playhead';
    track.appendChild(playhead);

    DOM.replayTimeline.appendChild(track);
    updateReplayTimelinePlayhead();
    updateReplayLapChip();
}

function getTimelineSegment(lapNumber) {
    const timeline = state.replay.timeline;
    if (!timeline) return null;
    return timeline.segments.find(seg => seg.lapNumber === lapNumber) || null;
}

function getNextTimelineSegment(lapNumber) {
    const timeline = state.replay.timeline;
    if (!timeline) return null;
    const index = timeline.segments.findIndex(seg => seg.lapNumber === lapNumber);
    return index >= 0 ? timeline.segments[index + 1] || null : null;
}

function getPreviousTimelineSegment(lapNumber) {
    const timeline = state.replay.timeline;
    if (!timeline) return null;
    const index = timeline.segments.findIndex(seg => seg.lapNumber === lapNumber);
    return index > 0 ? timeline.segments[index - 1] || null : null;
}

function updateReplayTimelineActive() {
    if (!DOM.replayTimeline) return;
    DOM.replayTimeline.querySelectorAll('.replay-timeline-segment').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.lap) === state.replay.lapNumber);
    });
}

function updateReplayTimelinePlayhead() {
    if (!DOM.replayTimeline) return;
    const playhead = DOM.replayTimeline.querySelector('.replay-timeline-playhead');
    const timeline = state.replay.timeline;
    if (!playhead) return;

    const seg = getTimelineSegment(state.replay.lapNumber);
    if (!timeline || timeline.displayTotal <= 0 || !seg) {
        playhead.style.display = 'none';
        return;
    }

    const windowSeconds = getReplayWindowSeconds() || seg.seconds;
    const fraction = windowSeconds > 0 ? Math.max(0, Math.min(1, state.replay.t / windowSeconds)) : 0;
    const left = (seg.displayStart + fraction * seg.displayUnits) / timeline.displayTotal;
    playhead.style.display = '';
    playhead.style.left = `${(left * 100).toFixed(3)}%`;
}

function onReplayTimelineClick(event) {
    const btn = event.target.closest('.replay-timeline-segment');
    if (!btn) return;
    const seg = getTimelineSegment(Number(btn.dataset.lap));
    if (!seg) return;

    const rect = btn.getBoundingClientRect();
    const fraction = rect.width > 0
        ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        : 0;
    seekReplayToTimelineFraction(seg, fraction);
}

// Seek to a point inside a timeline segment (fraction of that lap's window);
// playback state survives lap switches.
function seekReplayToTimelineFraction(segment, fraction) {
    const startT = segment.seconds * fraction;
    if (segment.lapNumber === state.replay.lapNumber && state.replay.data) {
        renderReplayFrame(Math.min(startT, getReplayWindowSeconds()));
        return;
    }

    const resume = state.replay.playing;
    stopReplayPlayback();
    state.replay.lapNumber = segment.lapNumber;
    updateReplayTimelineActive();
    loadTrackReplay(state.replay.driverNumber, segment.lapNumber, { startT, resume });
}

// Session load lands on the Drivers tab; defer location fetches until the
// Session Replay tab is actually visible.
function maybeAutoLoadReplay() {
    if (state.currentTab !== 'replay-view') return;
    ensureReplayIntervalsLoaded();
    ensureReplayAllSessionLapsLoaded();
    loadSelectedReplay();
}

function loadSelectedReplay() {
    if (!state.selectedSession) return;
    const { driverNumber, lapNumber } = state.replay;
    if (!isValidReplaySelection(driverNumber) || !Number.isFinite(lapNumber)) return;
    loadTrackReplay(driverNumber, lapNumber);
}

// Fetch and memoize a lap's replay payload; null when the lap has no data.
// In-flight requests are shared so a prefetch and a lap-advance load for the
// same lap never hit the network twice.
let replayFetchPromises = {};

function fetchReplayPayload(sessionKey, driverNumber, lapNumber) {
    const cacheKey = `${sessionKey}_${driverNumber}_${lapNumber}`;
    if (state.replayCache[cacheKey]) return Promise.resolve(state.replayCache[cacheKey]);

    if (!replayFetchPromises[cacheKey]) {
        replayFetchPromises[cacheKey] = (async () => {
            try {
                let query;
                if (driverNumber === REPLAY_FULL_SESSION) {
                    // Full-session slices are explicit time windows; the
                    // timeline segment carries the absolute bounds
                    const seg = getTimelineSegment(Number(lapNumber));
                    if (!seg) return null;
                    const start = encodeURIComponent(new Date(seg.startMs).toISOString());
                    const end = encodeURIComponent(new Date(seg.endMs).toISOString());
                    query = `session_key=${sessionKey}&start=${start}&end=${end}`;
                } else {
                    // Full-race mode omits driver_number: the backend then derives
                    // leader-based race-lap windows instead of one driver's laps
                    const driverParam = driverNumber === REPLAY_FULL_RACE ? '' : `&driver_number=${driverNumber}`;
                    query = `session_key=${sessionKey}${driverParam}&lap_number=${lapNumber}`;
                }
                query += sessionYearParam();
                const response = await customFetch(`/api/track_replay?${query}`);
                if (!response.ok) return null;
                const payload = await response.json();
                if (!payload || !Array.isArray(payload.drivers) || payload.drivers.length === 0) return null;
                state.replayCache[cacheKey] = payload;
                return payload;
            } finally {
                delete replayFetchPromises[cacheKey];
            }
        })();
    }
    return replayFetchPromises[cacheKey];
}

async function loadTrackReplay(driverNumber, lapNumber, options = {}) {
    const sessionKey = state.selectedSession.session_key;
    const cacheKey = `${sessionKey}_${driverNumber}_${lapNumber}`;

    stopReplayPlayback();
    state.replay.driverNumber = normalizeReplaySelection(driverNumber);
    state.replay.lapNumber = Number(lapNumber);

    if (state.replay.loadedKey === cacheKey && state.replay.data) {
        // Already showing this lap (e.g. tab re-entry): keep the position
        // unless the caller asked for a specific one.
        if (options.startT !== undefined) {
            renderReplayFrame(Math.max(0, Math.min(Number(options.startT) || 0, getReplayWindowSeconds())));
        }
        if (options.resume) startReplayPlayback();
        return;
    }

    const isCurrentSelection = () => (
        state.replay.driverNumber === normalizeReplaySelection(driverNumber) &&
        state.replay.lapNumber === Number(lapNumber)
    );

    const cached = state.replayCache[cacheKey];
    if (cached) {
        buildReplayScene(cached, cacheKey, options);
        return;
    }

    renderReplayMessage('Loading track positions for the whole field...', 'loading');
    if (DOM.replayPlayBtn) DOM.replayPlayBtn.disabled = true;
    if (DOM.replayScrubber) DOM.replayScrubber.disabled = true;

    try {
        const payload = await fetchReplayPayload(sessionKey, driverNumber, lapNumber);
        if (!isCurrentSelection()) return;
        if (!payload) {
            renderReplayMessage('No track position data available for this lap.', 'unavailable');
            return;
        }
        buildReplayScene(payload, cacheKey, options);
    } catch (e) {
        console.error('Error loading track replay:', e);
        if (isCurrentSelection()) {
            renderReplayMessage('Failed to load track position data.', 'error');
        }
    }
}

// Split the closed track polyline into per-marshal-sector segments. Each
// sector starts at the polyline point nearest its trackPosition and runs in
// polyline direction (wrapping past the start/finish line) to the next
// sector's start — MultiViewer orders both the polyline and the sector
// numbers in racing direction. Badge points sit just outside the racing line
// so the sector numbers don't cover the track.
function buildMarshalSectorSegments(trackPoints, marshalSectors) {
    const points = Array.isArray(trackPoints) ? trackPoints : [];
    const sectors = (Array.isArray(marshalSectors) ? marshalSectors : [])
        .filter(s => s && s.trackPosition)
        .map(s => ({ number: Number(s.number), x: Number(s.trackPosition.x), y: Number(s.trackPosition.y) }))
        .filter(s => Number.isFinite(s.number) && Number.isFinite(s.x) && Number.isFinite(s.y))
        .sort((a, b) => a.number - b.number);
    if (points.length < 4 || sectors.length < 2) return [];

    const nearestIndex = (x, y) => {
        let best = 0;
        let bestDist = Infinity;
        points.forEach(([px, py], i) => {
            const dist = (px - x) * (px - x) + (py - y) * (py - y);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        });
        return best;
    };

    // Loop orientation (signed area) decides which perpendicular points
    // off-track; badge offset scales with the track's own extent.
    let area = 0;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    points.forEach(([x, y], i) => {
        const [nx, ny] = points[(i + 1) % points.length];
        area += x * ny - nx * y;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
    });
    const orientation = area >= 0 ? 1 : -1;
    const badgeOffset = Math.max(xMax - xMin, yMax - yMin) * 0.05;

    const starts = sectors.map(sector => ({ number: sector.number, index: nearestIndex(sector.x, sector.y) }));
    return starts.map((sector, i) => {
        const next = starts[(i + 1) % starts.length];
        const segment = [points[sector.index]];
        for (let idx = sector.index; idx !== next.index;) {
            idx = (idx + 1) % points.length;
            segment.push(points[idx]);
        }

        const [px, py] = points[sector.index];
        const [ax, ay] = points[(sector.index - 1 + points.length) % points.length];
        const [bx, by] = points[(sector.index + 1) % points.length];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const badge = [
            px + orientation * (dy / len) * badgeOffset,
            py - orientation * (dx / len) * badgeOffset
        ];
        return { number: sector.number, points: segment, badge };
    });
}

// Sector number -> 'yellow' | 'double-yellow' for the sector yellows active
// at an absolute session time (double yellow wins when spans overlap).
function activeSectorYellowsAt(sectorYellows, ms) {
    const active = new Map();
    if (ms === null || !Number.isFinite(ms)) return active;
    (Array.isArray(sectorYellows) ? sectorYellows : []).forEach(period => {
        if (ms < period.startMs || ms >= period.endMs) return;
        if (period.double || !active.has(period.sector)) {
            active.set(period.sector, period.double ? 'double-yellow' : 'yellow');
        }
    });
    return active;
}

// Fit-to-bounds projection into a square viewBox (same math as renderCircuitTab)
function buildReplayProjection(bounds, viewBoxSize, padding) {
    const width = Math.max(bounds.xMax - bounds.xMin, 1);
    const height = Math.max(bounds.yMax - bounds.yMin, 1);
    const drawSize = viewBoxSize - 2 * padding;
    const scale = Math.min(drawSize / width, drawSize / height);
    const offsetX = padding + (drawSize - width * scale) / 2;
    const offsetY = padding + (drawSize - height * scale) / 2;
    return {
        mapX: (x) => (x - bounds.xMin) * scale + offsetX,
        mapY: (y) => (bounds.yMax - y) * scale + offsetY // invert Y like the circuit map
    };
}

// World → camera transform for the active view mode. The 3D view spins the
// circuit by the user's yaw and foreshortens the depth axis like a TV
// helicopter shot; 2D is the identity, so one projection path serves both.
// Fit-to-bounds runs after this, so the rotation needs no explicit pivot.
function replayViewTransform() {
    if (state.replayMapView.mode !== '3d') return (x, y) => [x, y];
    const yaw = (Number(state.replayMapView.yawDeg) || 0) * Math.PI / 180;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    return (x, y) => [
        x * cosYaw - y * sinYaw,
        (x * sinYaw + y * cosYaw) * REPLAY_3D_DEPTH_SCALE
    ];
}

// Project the scene's world-space geometry into the viewBox for the active
// view mode and rewrite node geometry in place. Runs at scene build and again
// on every 2D/3D switch or 3D rotation, so node identity (focus highlights,
// lit sectors) and playback state survive view changes.
function applyReplayMapProjection() {
    const scene = state.replay.scene;
    if (!scene) return;

    const view = replayViewTransform();

    // Bounds cover the track and every car sample so nothing clips off-screen.
    // FIA cars are excluded: they stream (0,0) while parked between
    // deployments, which would drag the bounds off the circuit.
    const bounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
    const extend = ([x, y]) => {
        if (x < bounds.xMin) bounds.xMin = x;
        if (x > bounds.xMax) bounds.xMax = x;
        if (y < bounds.yMin) bounds.yMin = y;
        if (y > bounds.yMax) bounds.yMax = y;
    };
    scene.trackPoints.forEach(([x, y]) => extend(view(x, y)));
    scene.cars.forEach(car => {
        if (car.fia) return;
        car.samples.forEach(s => extend(view(s[1], s[2])));
    });

    const { mapX, mapY } = buildReplayProjection(bounds, REPLAY_VIEWBOX_SIZE, REPLAY_MAP_PADDING);
    const toView = (x, y) => {
        const [vx, vy] = view(x, y);
        return [mapX(vx), mapY(vy)];
    };
    const pathFrom = (points, close) => points
        .map(([x, y], i) => {
            const [px, py] = toView(x, y);
            return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
        })
        .join(' ') + (close ? ' Z' : '');

    const trackD = pathFrom(scene.trackPoints, scene.closePath);
    scene.trackPath.setAttribute('d', trackD);
    scene.trackBasePath.setAttribute('d', trackD);

    scene.marshalSegments.forEach(({ segment, path, badge }) => {
        path.setAttribute('d', pathFrom(segment.points, false));
        const [badgeX, badgeY] = toView(segment.badge[0], segment.badge[1]);
        badge.setAttribute('transform', `translate(${badgeX.toFixed(1)}, ${badgeY.toFixed(1)})`);
    });

    if (scene.startFinish) {
        const [startX, startY] = toView(scene.trackPoints[0][0], scene.trackPoints[0][1]);
        const [nextX, nextY] = toView(scene.trackPoints[1][0], scene.trackPoints[1][1]);
        const tangentX = nextX - startX;
        const tangentY = nextY - startY;
        const tangentLength = Math.hypot(tangentX, tangentY) || 1;
        const normalX = -(tangentY / tangentLength) * 30;
        const normalY = (tangentX / tangentLength) * 30;
        scene.startFinish.line.setAttribute('x1', (startX - normalX).toFixed(1));
        scene.startFinish.line.setAttribute('y1', (startY - normalY).toFixed(1));
        scene.startFinish.line.setAttribute('x2', (startX + normalX).toFixed(1));
        scene.startFinish.line.setAttribute('y2', (startY + normalY).toFixed(1));
        scene.startFinish.marker.setAttribute('cx', startX.toFixed(1));
        scene.startFinish.marker.setAttribute('cy', startY.toFixed(1));
    }

    // Pre-project samples so per-frame interpolation stays in view space
    scene.cars.forEach(car => {
        const node = state.replay.carNodes[car.driverNumber];
        if (!node) return;
        node.samples = car.samples.map(s => {
            const [px, py] = toView(s[1], s[2]);
            return [s[0], px, py];
        });
    });
}

// Switch the track map between the flat 2D projection and the rotatable 3D
// view. Reprojects the already-built scene in place, so it works mid-playback;
// with no scene loaded the next build simply uses the new mode.
function setReplayMapViewMode(mode) {
    const next = mode === '3d' ? '3d' : '2d';
    if (state.replayMapView.mode === next) return;
    state.replayMapView.mode = next;
    updateReplayMapViewControls();
    applyReplayMapProjection();
    if (state.replay.scene && state.replay.data) renderReplayFrame(state.replay.t);
}

function updateReplayMapViewControls() {
    const mode = state.replayMapView.mode;
    if (DOM.replayViewToggle) {
        DOM.replayViewToggle.querySelectorAll('button[data-map-view]').forEach(btn => {
            const isActive = btn.dataset.mapView === mode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    }
    if (DOM.replayMapContent) {
        DOM.replayMapContent.dataset.viewMode = mode;
    }
}

// Drag-to-rotate for the 3D view: horizontal drags spin the circuit around
// its vertical axis. Reprojection is coalesced to one per animation frame,
// and a drag past the click threshold swallows the release click so rotating
// doesn't toggle a car's focus highlight.
function setupReplayMapRotation() {
    const content = DOM.replayMapContent;
    if (!content) return;

    let drag = null;
    let swallowNextClick = false;
    let reprojectQueued = false;

    const reproject = () => {
        reprojectQueued = false;
        applyReplayMapProjection();
        // Playback repaints every frame anyway; repaint manually while paused
        if (state.replay.data && !state.replay.playing) renderReplayFrame(state.replay.t);
    };

    content.addEventListener('pointerdown', (event) => {
        swallowNextClick = false;
        if (state.replayMapView.mode !== '3d' || !state.replay.scene) return;
        if (event.button !== 0) return;
        drag = { pointerId: event.pointerId, lastX: event.clientX, travel: 0 };
        content.classList.add('is-rotating');
        if (content.setPointerCapture) content.setPointerCapture(event.pointerId);
    });

    content.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.lastX;
        if (dx === 0) return;
        drag.lastX = event.clientX;
        drag.travel += Math.abs(dx);
        state.replayMapView.yawDeg = ((Number(state.replayMapView.yawDeg) || 0) + dx * REPLAY_3D_YAW_PER_PIXEL) % 360;
        if (!reprojectQueued) {
            reprojectQueued = true;
            requestAnimationFrame(reproject);
        }
    });

    const endDrag = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        swallowNextClick = drag.travel > REPLAY_3D_DRAG_CLICK_THRESHOLD_PX;
        drag = null;
        content.classList.remove('is-rotating');
    };
    content.addEventListener('pointerup', endDrag);
    content.addEventListener('pointercancel', endDrag);

    content.addEventListener('click', (event) => {
        if (!swallowNextClick) return;
        swallowNextClick = false;
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

function buildReplayScene(payload, cacheKey, options = {}) {
    if (!DOM.replayMapContent) return;

    stopReplayPlayback();
    state.replay.data = payload;
    state.replay.loadedKey = cacheKey;
    state.replay.t = 0;
    state.replay.carNodes = {};
    state.replay.scene = null;

    // Track outline: prefer the circuit_info map so the layout matches the
    // Circuit tab; fall back to the reference driver's own racing line.
    const info = state.currentMeeting && state.currentMeeting.circuit_info;
    let trackPoints = null;
    let closePath = false;
    if (info && Array.isArray(info.x) && info.x.length > 0 && Array.isArray(info.y)) {
        trackPoints = info.x.map((x, i) => [x, info.y[i]]);
        closePath = true;
    } else {
        const reference = payload.drivers.find(d => d.driver_number === payload.driver_number) || payload.drivers[0];
        trackPoints = (reference ? reference.samples : []).map(s => [s[1], s[2]]);
    }

    if (!trackPoints || trackPoints.length < 2) {
        renderReplayMessage('Not enough position data to draw the track.', 'error');
        return;
    }

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", `0 0 ${REPLAY_VIEWBOX_SIZE} ${REPLAY_VIEWBOX_SIZE}`);
    svg.setAttribute("xmlns", svgNamespace);

    // World-space geometry + node refs; applyReplayMapProjection() turns this
    // into viewBox coordinates for the active view mode, and again on every
    // 2D/3D switch or 3D rotation without rebuilding the nodes.
    const scene = {
        trackPoints,
        closePath,
        trackPath: null,
        trackBasePath: null,
        marshalSegments: [],
        startFinish: null,
        cars: []
    };

    // 3D depth cue: a darker copy of the outline dropped below the track.
    // Present in both modes; CSS shows it only in the 3D view.
    const trackBasePath = document.createElementNS(svgNamespace, "path");
    trackBasePath.setAttribute("class", "replay-track-base");
    trackBasePath.setAttribute("transform", `translate(0, ${REPLAY_3D_BASE_DROP})`);
    svg.appendChild(trackBasePath);
    scene.trackBasePath = trackBasePath;

    const trackPath = document.createElementNS(svgNamespace, "path");
    trackPath.setAttribute("class", "replay-track-path");
    svg.appendChild(trackPath);
    scene.trackPath = trackPath;

    // Marshal-sector overlay: a per-sector copy of the racing line plus a
    // numbered badge, lit by updateReplayCircuitState while race control has
    // a yellow in that track sector (the map mirror of "YELLOW IN TRACK
    // SECTOR n"). Only the circuit_info outline knows the sector geometry —
    // the racing-line fallback draws no overlay.
    state.replay.sectorNodes = {};
    const marshalSegments = closePath && info
        ? buildMarshalSectorSegments(trackPoints, info.marshalSectors)
        : [];
    marshalSegments.forEach(segment => {
        if (segment.points.length < 2) return;
        const sectorPath = document.createElementNS(svgNamespace, "path");
        sectorPath.setAttribute("class", "replay-sector-path");
        sectorPath.setAttribute("data-sector", String(segment.number));
        svg.appendChild(sectorPath);

        const badge = document.createElementNS(svgNamespace, "g");
        badge.setAttribute("class", "replay-sector-badge");
        badge.setAttribute("data-sector", String(segment.number));
        const box = document.createElementNS(svgNamespace, "rect");
        box.setAttribute("x", -17);
        box.setAttribute("y", -13);
        box.setAttribute("width", 34);
        box.setAttribute("height", 26);
        box.setAttribute("rx", 6);
        badge.appendChild(box);
        const number = document.createElementNS(svgNamespace, "text");
        number.setAttribute("dy", 5.5);
        number.textContent = String(segment.number);
        badge.appendChild(number);
        svg.appendChild(badge);

        scene.marshalSegments.push({ segment, path: sectorPath, badge });
        state.replay.sectorNodes[segment.number] = { path: sectorPath, badge };
    });

    // Start/finish line at the first outline point, mirroring the Circuit tab.
    // Only drawn for the circuit_info outline — the racing-line fallback
    // starts wherever the reference driver's samples begin, not at the line.
    if (closePath) {
        const startFinish = document.createElementNS(svgNamespace, "g");
        startFinish.setAttribute("class", "replay-start-finish");
        startFinish.setAttribute("aria-label", "Start finish line");
        const startLine = document.createElementNS(svgNamespace, "line");
        startFinish.appendChild(startLine);
        const startMarker = document.createElementNS(svgNamespace, "circle");
        startMarker.setAttribute("r", 8);
        startFinish.appendChild(startMarker);
        svg.appendChild(startFinish);
        scene.startFinish = { line: startLine, marker: startMarker };
    }

    // Reference driver drawn last so it stays on top
    const orderedDrivers = [...payload.drivers].sort((a, b) => (
        (a.driver_number === payload.driver_number) - (b.driver_number === payload.driver_number)
    ));

    orderedDrivers.forEach(driverSeries => {
        const fiaCar = getFiaCarInfo(driverSeries.driver_number);
        // FIA cars stream (0,0) while parked; keep only real fixes so the
        // safety/medical car is drawn only while it is actually out.
        const samples = (Array.isArray(driverSeries.samples) ? driverSeries.samples : [])
            .filter(s => !fiaCar || s[1] !== 0 || s[2] !== 0);
        if (samples.length === 0) return;

        const driver = state.drivers.find(d => Number(d.driver_number) === Number(driverSeries.driver_number));
        const teamHex = fiaCar ? fiaCar.hex : getDriverTeamHex(driver);
        const acronym = fiaCar ? fiaCar.code : ((driver && driver.name_acronym) || `#${driverSeries.driver_number}`);
        const isReference = driverSeries.driver_number === payload.driver_number;

        const group = document.createElementNS(svgNamespace, "g");
        group.setAttribute("class", `replay-car-group${isReference ? ' reference' : ''}${fiaCar ? ' fia-car' : ''}`);
        if (fiaCar) {
            group.setAttribute('aria-label', `${fiaCar.name} on track`);
        } else {
            group.setAttribute("data-driver-number", String(driverSeries.driver_number));
            group.setAttribute('role', 'button');
            group.setAttribute('tabindex', '0');
            group.setAttribute('aria-label', `Focus ${acronym} in replay`);
            group.setAttribute('aria-pressed', 'false');
        }
        group.style.display = 'none';

        const ring = document.createElementNS(svgNamespace, "circle");
        ring.setAttribute("r", 22);
        ring.setAttribute("class", "replay-car-highlight");
        group.appendChild(ring);

        const dot = document.createElementNS(svgNamespace, "circle");
        dot.setAttribute("r", isReference ? 15 : 12);
        dot.setAttribute("class", "replay-car-dot");
        dot.setAttribute("fill", `#${teamHex}`);
        group.appendChild(dot);

        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("x", 20);
        label.setAttribute("y", 7);
        label.setAttribute("class", "replay-car-label");
        label.textContent = acronym;
        group.appendChild(label);

        svg.appendChild(group);

        scene.cars.push({ driverNumber: driverSeries.driver_number, group, samples, fia: Boolean(fiaCar) });
        // Samples stay in world space here; applyReplayMapProjection() fills
        // the view-space copies that per-frame interpolation reads.
        state.replay.carNodes[driverSeries.driver_number] = { group, samples: [] };
    });

    state.replay.scene = scene;
    applyReplayMapProjection();

    DOM.replayMapContent.innerHTML = '';
    DOM.replayMapContent.appendChild(svg);
    setReplayStageStatus('ready', 'Timeline synchronized');
    applyReplayHighlight();

    if (DOM.replayPlayBtn) DOM.replayPlayBtn.disabled = false;
    if (DOM.replayScrubber) DOM.replayScrubber.disabled = false;
    updateReplayTimelineActive();
    ensureReplayTelemetryLoaded();

    const windowSeconds = Number(payload.window_seconds) || 0;
    renderReplayFrame(Math.max(0, Math.min(Number(options.startT) || 0, windowSeconds)));
    if (options.resume) startReplayPlayback();
}

// Interpolated [x, y] at time t, or null when t falls outside the series or in a data gap
function interpolateReplaySample(samples, t) {
    if (samples.length === 0) return null;

    // Samples rarely start exactly at t=0 (or end exactly at the window edge);
    // snap to the nearest edge sample instead of hiding the car there.
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (t < first[0]) {
        return (first[0] - t) <= REPLAY_SAMPLE_GAP_SECONDS ? [first[1], first[2]] : null;
    }
    if (t > last[0]) {
        return (t - last[0]) <= REPLAY_SAMPLE_GAP_SECONDS ? [last[1], last[2]] : null;
    }

    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (samples[mid][0] <= t) lo = mid;
        else hi = mid - 1;
    }

    const before = samples[lo];
    const after = samples[Math.min(lo + 1, samples.length - 1)];
    const span = after[0] - before[0];
    if (span > REPLAY_SAMPLE_GAP_SECONDS) return null;
    if (span <= 0) return [before[1], before[2]];

    const ratio = (t - before[0]) / span;
    return [
        before[1] + (after[1] - before[1]) * ratio,
        before[2] + (after[2] - before[2]) * ratio
    ];
}

function getReplayWindowSeconds() {
    const data = state.replay.data;
    return data ? Number(data.window_seconds) || 0 : 0;
}

// Absolute session time (ms) of a replay offset: the backend replay window
// starts at the active lap's date_start, which is the segment's startMs.
function getReplayAbsoluteMs(t) {
    const seg = getTimelineSegment(state.replay.lapNumber);
    if (!seg || !Number.isFinite(seg.startMs)) return null;
    return seg.startMs + t * 1000;
}

// Circuit state at an absolute session time, respecting overlap precedence;
// 'green' when nothing is active, 'chequered' once the flag has fallen.
function circuitStateAt(states, ms) {
    if (!states || ms === null || !Number.isFinite(ms)) return null;

    const active = new Set();
    (states.periods || []).forEach(period => {
        if (ms >= period.startMs && ms < period.endMs) active.add(period.type);
    });
    for (const type of REPLAY_STATE_PRIORITY) {
        if (active.has(type)) return type;
    }
    if (states.chequeredMs !== null && ms >= states.chequeredMs) return 'chequered';
    return 'green';
}

// Reflect the circuit state at the playhead on the chip and the track tint
function updateReplayCircuitState() {
    const timeline = state.replay.timeline;
    const ms = state.replay.data ? getReplayAbsoluteMs(state.replay.t) : null;
    const stateType = timeline ? circuitStateAt(timeline.states, ms) : null;

    // Light the marshal-sector overlay for sector-scope yellows at the playhead
    const activeSectors = timeline && timeline.states
        ? activeSectorYellowsAt(timeline.states.sectorYellows, ms)
        : new Map();

    if (DOM.replayStateChip) {
        DOM.replayStateChip.hidden = !stateType;
        DOM.replayStateChip.textContent = stateType ? (REPLAY_STATE_LABELS[stateType] || stateType) : '';
        DOM.replayStateChip.className = stateType ? `replay-state-chip state-${stateType}` : 'replay-state-chip';
    }
    // A yellow with known sectors lights only those sectors (like the F1 app);
    // the track-wide tint is kept for yellows with no sector info and for
    // SC/VSC/red, which really do cover the whole circuit.
    const suppressTrackTint = stateType === 'yellow'
        && activeSectors.size > 0
        && Object.keys(state.replay.sectorNodes || {}).length > 0;
    if (DOM.replayMapContent) {
        if (stateType && !suppressTrackTint) {
            DOM.replayMapContent.dataset.circuitState = stateType;
        } else {
            delete DOM.replayMapContent.dataset.circuitState;
        }
    }
    Object.entries(state.replay.sectorNodes || {}).forEach(([sector, node]) => {
        const level = activeSectors.get(Number(sector));
        node.path.classList.toggle('sector-yellow', level === 'yellow');
        node.path.classList.toggle('sector-double-yellow', level === 'double-yellow');
        node.badge.classList.toggle('sector-yellow', level === 'yellow');
        node.badge.classList.toggle('sector-double-yellow', level === 'double-yellow');
    });
}

// Live mode refreshed state.raceControl: recompute the bands and re-render
// the timeline without disturbing playback.
function refreshReplayCircuitStates() {
    const timeline = state.replay.timeline;
    if (!timeline) return;

    timeline.states = getReplayCircuitStates();
    const range = getRaceControlRangeMs();
    if (range) {
        if (timeline.segments.length === 0) {
            timeline.rangeStartMs = range.rangeStartMs;
            timeline.rangeEndMs = range.rangeEndMs;
        } else {
            timeline.rangeStartMs = Math.min(timeline.rangeStartMs, range.rangeStartMs);
            timeline.rangeEndMs = Math.max(timeline.rangeEndMs, range.rangeEndMs);
        }
    }
    renderReplayTimeline();
    updateReplayCircuitState();
}

function renderReplayFrame(t) {
    state.replay.t = t;
    const windowSeconds = getReplayWindowSeconds();
    const absoluteMs = getReplayAbsoluteMs(t);
    const positionIndex = state.replay.positionIndex || buildDriverDateIndex(state.position);
    state.replay.positionIndex = positionIndex;

    Object.entries(state.replay.carNodes).forEach(([driverNumber, node]) => {
        const pos = interpolateReplaySample(node.samples, t);
        const driverStatus = getReplayDriverStatusAtMs(
            driverNumber,
            absoluteMs,
            positionIndex.get(Number(driverNumber))
        );
        if (!pos || !driverStatus.markerVisible) {
            node.group.style.display = 'none';
            return;
        }
        node.group.style.display = '';
        node.group.setAttribute('transform', `translate(${pos[0].toFixed(1)}, ${pos[1].toFixed(1)})`);
    });

    if (DOM.replayScrubber && windowSeconds > 0) {
        const max = Number(DOM.replayScrubber.max) || 1000;
        DOM.replayScrubber.value = Math.round((t / windowSeconds) * max);
        DOM.replayScrubber.setAttribute('aria-valuetext', `${t.toFixed(1)} of ${windowSeconds.toFixed(1)} seconds`);
    }
    if (DOM.replayTimeLabel) {
        DOM.replayTimeLabel.textContent = `${t.toFixed(1)}s / ${windowSeconds.toFixed(1)}s`;
    }
    updateReplayTimelinePlayhead();
    updateReplayCircuitState();
    updateReplayRaceContext();
    updateReplayTelemetryStrip();
    updateReplayTeamRadioTicker();
}

// Warm the cache for the next timeline lap so the lap handoff is seamless
function prefetchNextReplayLap() {
    if (!state.selectedSession) return;
    const next = getNextTimelineSegment(state.replay.lapNumber);
    if (!next) return;

    fetchReplayPayload(state.selectedSession.session_key, state.replay.driverNumber, next.lapNumber)
        .catch(e => console.error('Error prefetching replay lap:', e));
    // Warm the telemetry strip for the lap handoff too (driver mode only)
    if (!isReplayWholeFieldSelection(state.replay.driverNumber)) {
        fetchReplayTelemetryPayload(state.selectedSession.session_key, state.replay.driverNumber, next.lapNumber);
    }
}

// Continuous playback: carry leftover time into the next timeline lap, or
// stop at the end of the session.
function advanceReplayToNextLap(leftover) {
    const next = getNextTimelineSegment(state.replay.lapNumber);
    if (!next) {
        renderReplayFrame(getReplayWindowSeconds());
        stopReplayPlayback();
        return;
    }

    state.replay.lapNumber = next.lapNumber;
    updateReplayTimelineActive();
    loadTrackReplay(state.replay.driverNumber, next.lapNumber, {
        startT: Math.max(0, leftover),
        resume: true
    });
}

function replayLoop(frameTs) {
    if (!state.replay.playing) return;

    if (state.replay.lastFrameTs === null) {
        state.replay.lastFrameTs = frameTs;
    }
    const dt = (frameTs - state.replay.lastFrameTs) / 1000;
    state.replay.lastFrameTs = frameTs;

    const windowSeconds = getReplayWindowSeconds();
    const t = state.replay.t + dt * state.replay.speed;

    if (windowSeconds - t <= REPLAY_PREFETCH_LEAD_SECONDS) {
        prefetchNextReplayLap();
    }

    if (t >= windowSeconds) {
        advanceReplayToNextLap(t - windowSeconds);
        return;
    }

    renderReplayFrame(t);
    state.replay.rafId = requestAnimationFrame(replayLoop);
}

function startReplayPlayback() {
    if (!state.replay.data || state.replay.playing) return;

    // Restarting from the end of the last timeline lap replays that lap
    if (state.replay.t >= getReplayWindowSeconds() && !getNextTimelineSegment(state.replay.lapNumber)) {
        state.replay.t = 0;
    }
    state.replay.playing = true;
    state.replay.lastFrameTs = null;
    setReplayPlayIcon(true);
    state.replay.rafId = requestAnimationFrame(replayLoop);
}

function toggleReplayPlayback() {
    if (!state.replay.data) return;

    if (state.replay.playing) {
        stopReplayPlayback();
        return;
    }
    startReplayPlayback();
}

function stopReplayPlayback() {
    if (state.replay.rafId !== null) {
        cancelAnimationFrame(state.replay.rafId);
        state.replay.rafId = null;
    }
    state.replay.playing = false;
    state.replay.lastFrameTs = null;
    setReplayPlayIcon(false);
}

function scrubReplayToFraction(fraction) {
    if (!state.replay.data) return;
    const windowSeconds = getReplayWindowSeconds();
    const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
    renderReplayFrame(clamped * windowSeconds);
}

function seekReplayBySeconds(deltaSeconds) {
    if (!state.replay.data) return;
    const delta = Number(deltaSeconds);
    if (!Number.isFinite(delta) || delta === 0) return;

    const windowSeconds = getReplayWindowSeconds();
    if (!(windowSeconds > 0)) return;

    const targetT = state.replay.t + delta;
    if (targetT >= 0 && targetT <= windowSeconds) {
        renderReplayFrame(Math.max(0, Math.min(targetT, windowSeconds)));
        return;
    }

    if (targetT > windowSeconds) {
        const leftover = targetT - windowSeconds;
        const next = getNextTimelineSegment(state.replay.lapNumber);
        if (!next) {
            renderReplayFrame(windowSeconds);
            stopReplayPlayback();
            return;
        }
        if (state.replay.playing) {
            advanceReplayToNextLap(leftover);
            return;
        }
        const fraction = next.seconds > 0 ? leftover / next.seconds : 0;
        seekReplayToTimelineFraction(next, fraction);
        return;
    }

    const previous = getPreviousTimelineSegment(state.replay.lapNumber);
    if (!previous) {
        renderReplayFrame(0);
        return;
    }
    const previousT = Math.max(0, previous.seconds + targetT);
    const fraction = previous.seconds > 0 ? previousT / previous.seconds : 0;
    seekReplayToTimelineFraction(previous, fraction);
}

function selectAdjacentReplayLap(direction) {
    const timeline = state.replay.timeline;
    const segments = timeline && Array.isArray(timeline.segments) ? timeline.segments : [];
    if (segments.length === 0) return;

    const currentIndex = segments.findIndex(seg => seg.lapNumber === state.replay.lapNumber);
    if (currentIndex < 0) return;

    const targetIndex = currentIndex + (direction < 0 ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= segments.length) return;

    seekReplayToTimelineFraction(segments[targetIndex], 0);
}

function isReplayKeyboardShortcutTarget(target) {
    if (!target) return false;
    const tagName = String(target.tagName || '').toUpperCase();
    return (
        tagName === 'INPUT' ||
        tagName === 'SELECT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'BUTTON' ||
        (typeof target.getAttribute === 'function' && target.getAttribute('role') === 'button') ||
        target.isContentEditable
    );
}

function onReplayKeyboardShortcut(event) {
    if (state.currentTab !== 'replay-view') return;
    if (isReplayKeyboardShortcutTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        toggleReplayPlayback();
        return;
    }
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekReplayBySeconds(-REPLAY_KEYBOARD_SEEK_SECONDS);
        return;
    }
    if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekReplayBySeconds(REPLAY_KEYBOARD_SEEK_SECONDS);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectAdjacentReplayLap(-1);
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectAdjacentReplayLap(1);
    }
}
