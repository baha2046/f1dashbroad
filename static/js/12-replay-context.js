// Session Replay race-context side panel: running order, gaps, lap chip,
// and pit status keyed from the single replay absolute time source.
const REPLAY_CONTEXT_TICK_MS = 250;
const REPLAY_INTERVAL_MAX_AGE_MS = 20000;
const REPLAY_PIT_WINDOW_PAD_SECONDS = 5;

function buildDriverDateIndex(records) {
    const index = new Map();
    (Array.isArray(records) ? records : []).forEach(record => {
        const driverNumber = Number(record && record.driver_number);
        const dateMs = record && record.date ? new Date(record.date).getTime() : NaN;
        if (!Number.isFinite(driverNumber) || !Number.isFinite(dateMs)) return;

        if (!index.has(driverNumber)) index.set(driverNumber, []);
        index.get(driverNumber).push({
            ...record,
            driverNumber,
            dateMs
        });
    });

    index.forEach(recordsForDriver => {
        recordsForDriver.sort((a, b) => a.dateMs - b.dateMs);
    });
    return index;
}

function valueAtMs(records, ms, maxAgeMs = null) {
    if (!Array.isArray(records) || records.length === 0 || !Number.isFinite(ms)) return null;

    let lo = 0;
    let hi = records.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const dateMs = Number(records[mid].dateMs);
        if (Number.isFinite(dateMs) && dateMs <= ms) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    if (found < 0) return null;
    const record = records[found];
    if (Number.isFinite(maxAgeMs) && ms - record.dateMs > maxAgeMs) return null;
    return record;
}

function buildReplayRaceOrder(positionIndex, ms) {
    if (!(positionIndex instanceof Map) || !Number.isFinite(ms)) return [];

    const rows = [];
    positionIndex.forEach((records, driverNumber) => {
        const seed = records[0];
        if (!seed) return;

        const current = valueAtMs(records, ms) || seed;
        const position = Number(current.position !== undefined ? current.position : seed.position);
        const seedPosition = Number(seed.position);
        if (!Number.isFinite(position)) return;

        rows.push({
            driverNumber: Number(driverNumber),
            position,
            seedPosition: Number.isFinite(seedPosition) ? seedPosition : position,
            record: current
        });
    });

    return rows.sort((a, b) => (
        a.position - b.position ||
        a.seedPosition - b.seedPosition ||
        a.driverNumber - b.driverNumber
    ));
}

function deriveDriverLapAt(laps, ms, driverNumber = null) {
    if (!Array.isArray(laps) || !Number.isFinite(ms)) return null;

    let current = null;
    laps.forEach(lap => {
        if (!lap || lap.date_start === null || lap.date_start === undefined) return;
        if (driverNumber !== null && Number(lap.driver_number) !== Number(driverNumber)) return;

        const startMs = new Date(lap.date_start).getTime();
        if (!Number.isFinite(startMs) || startMs > ms) return;
        if (!current || startMs > current.startMs) {
            current = {
                ...lap,
                lapNumber: Number(lap.lap_number),
                startMs
            };
        }
    });
    return current;
}

function buildReplayPitWindows(pitStops, timeline) {
    const windowsByDriver = new Map();
    const segmentsByLap = new Map();
    (timeline && Array.isArray(timeline.segments) ? timeline.segments : []).forEach(segment => {
        segmentsByLap.set(Number(segment.lapNumber), segment);
    });

    (Array.isArray(pitStops) ? pitStops : []).forEach(pitStop => {
        const driverNumber = Number(pitStop && pitStop.driver_number);
        const lapNumber = Number(pitStop && pitStop.lap_number);
        if (!Number.isFinite(driverNumber)) return;

        const dateMs = pitStop && pitStop.date ? new Date(pitStop.date).getTime() : NaN;
        const durationSeconds = Number(pitStop && pitStop.pit_duration);
        const padMs = REPLAY_PIT_WINDOW_PAD_SECONDS * 1000;
        let startMs = null;
        let endMs = null;

        if (Number.isFinite(dateMs)) {
            startMs = dateMs - padMs;
            endMs = dateMs + (Number.isFinite(durationSeconds) && durationSeconds > 0
                ? durationSeconds * 1000
                : padMs) + padMs;
        } else if (Number.isFinite(lapNumber) && segmentsByLap.has(lapNumber)) {
            const segment = segmentsByLap.get(lapNumber);
            startMs = segment.startMs;
            endMs = segment.endMs;
        }

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
        if (!windowsByDriver.has(driverNumber)) windowsByDriver.set(driverNumber, []);
        windowsByDriver.get(driverNumber).push({
            startMs,
            endMs,
            lapNumber,
            pitStop
        });
    });

    windowsByDriver.forEach(windows => windows.sort((a, b) => a.startMs - b.startMs));
    return windowsByDriver;
}

function isDriverInPitAtMs(windowsByDriver, driverNumber, ms) {
    if (!(windowsByDriver instanceof Map) || !Number.isFinite(ms)) return false;
    const windows = windowsByDriver.get(Number(driverNumber));
    if (!Array.isArray(windows)) return false;
    return windows.some(window => ms >= window.startMs && ms < window.endMs);
}

function resetReplaySpeedToggle() {
    if (!DOM.replaySpeedToggle) return;
    DOM.replaySpeedToggle.querySelectorAll('button[data-speed]').forEach(button => {
        button.classList.toggle('active', button.dataset.speed === '1');
    });
}

function clearReplayRaceContext() {
    if (DOM.replayLapChip) {
        DOM.replayLapChip.hidden = true;
        DOM.replayLapChip.textContent = 'Lap -- / --';
    }
    if (DOM.replayRaceContext) {
        DOM.replayRaceContext.hidden = true;
    }
    if (DOM.replayTowerBody) {
        DOM.replayTowerBody.innerHTML = '';
    }
    if (state.replay) {
        state.replay.contextRows = {};
        state.replay.positionIndex = null;
        state.replay.intervalIndex = null;
        state.replay.pitWindows = null;
        state.replay.lastContextTickMs = 0;
    }
}

function getReplayContextNowMs() {
    return typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
}

function getReplayDriver(driverNumber) {
    return (Array.isArray(state.drivers) ? state.drivers : [])
        .find(driver => Number(driver.driver_number) === Number(driverNumber)) || null;
}

function getReplayDriverCode(driverNumber) {
    const driver = getReplayDriver(driverNumber);
    return (driver && (driver.name_acronym || driver.broadcast_name || driver.last_name)) || `#${driverNumber}`;
}

function updateReplayLapChip() {
    if (!DOM.replayLapChip) return;

    const timeline = state.replay.timeline;
    const segments = timeline && Array.isArray(timeline.segments) ? timeline.segments : [];
    if (segments.length === 0 || !Number.isFinite(state.replay.lapNumber)) {
        DOM.replayLapChip.hidden = true;
        return;
    }

    const total = Number(segments[segments.length - 1].lapNumber);
    const suffix = state.replay.driverNumber === REPLAY_FULL_RACE
        ? ''
        : ` - ${getReplayDriverCode(state.replay.driverNumber)}`;
    DOM.replayLapChip.hidden = false;
    DOM.replayLapChip.textContent = `Lap ${state.replay.lapNumber} / ${total}${suffix}`;
}

function prepareReplayRaceContext() {
    if (!state.replay) return;
    state.replay.positionIndex = buildDriverDateIndex(state.position);
    state.replay.intervalIndex = buildDriverDateIndex(state.intervals);
    state.replay.pitWindows = buildReplayPitWindows(state.pitStops, state.replay.timeline);
    state.replay.lastContextTickMs = 0;
    updateReplayLapChip();
}

function replayRaceContextAvailable() {
    return replaySupportsFullRace() && state.replay.timeline && state.replay.timeline.segments.length > 0;
}

async function ensureReplayIntervalsLoaded() {
    if (!state.selectedSession || !replaySupportsFullRace()) return null;
    if (typeof isLiveSessionNow === 'function' && isLiveSessionNow(state.selectedSession)) return null;
    if (state.replay.intervalsSessionKey === state.selectedSession.session_key) return null;
    if (state.replay.intervalsLoading) return state.replay.intervalsLoading;

    const sessionKey = state.selectedSession.session_key;
    state.replay.intervalsLoading = (async () => {
        try {
            const response = await customFetch(`/api/intervals?session_key=${state.selectedSession.session_key}`);
            if (!state.selectedSession || state.selectedSession.session_key !== sessionKey) return;
            if (response.ok) {
                const intervals = await response.json();
                state.intervals = Array.isArray(intervals) ? intervals : [];
                state.replay.intervalsSessionKey = sessionKey;
                state.replay.intervalIndex = buildDriverDateIndex(state.intervals);
                updateReplayRaceContext(true);
            }
        } catch (error) {
            console.error('Error fetching replay intervals:', error);
        } finally {
            if (state.replay && state.replay.intervalsLoading) {
                state.replay.intervalsLoading = null;
            }
        }
    })();

    return state.replay.intervalsLoading;
}

function formatReplayGap(value, isLeader) {
    if (isLeader) return 'Leader';
    if (value === null || value === undefined || value === '') return '\u2014';
    if (typeof value === 'number' && Number.isFinite(value)) return `+${value.toFixed(3)}s`;
    return String(value);
}

function isReplayCarVisible(driverNumber) {
    const node = state.replay.carNodes && state.replay.carNodes[driverNumber];
    return !!(node && node.group && node.group.style.display !== 'none');
}

function ensureReplayTowerRow(driverNumber) {
    if (!DOM.replayTowerBody) return null;
    if (!state.replay.contextRows) state.replay.contextRows = {};
    if (state.replay.contextRows[driverNumber]) return state.replay.contextRows[driverNumber];

    const row = document.createElement('div');
    row.className = 'replay-tower-row';
    row.dataset.driverNumber = String(driverNumber);

    const pos = document.createElement('span');
    pos.className = 'replay-tower-pos';
    row.appendChild(pos);

    const color = document.createElement('span');
    color.className = 'replay-tower-color';
    row.appendChild(color);

    const driver = document.createElement('span');
    driver.className = 'replay-tower-driver';
    row.appendChild(driver);

    const status = document.createElement('span');
    status.className = 'replay-tower-status';
    row.appendChild(status);

    const gap = document.createElement('span');
    gap.className = 'replay-tower-gap';
    row.appendChild(gap);

    DOM.replayTowerBody.appendChild(row);
    state.replay.contextRows[driverNumber] = { row, pos, color, driver, status, gap };
    return state.replay.contextRows[driverNumber];
}

function updateReplayRaceContext(force = false) {
    updateReplayLapChip();
    if (!DOM.replayRaceContext || !DOM.replayTowerBody) return;

    if (!replayRaceContextAvailable() || !state.replay.data) {
        DOM.replayRaceContext.hidden = true;
        return;
    }

    const now = getReplayContextNowMs();
    if (!force && state.replay.lastContextTickMs && now - state.replay.lastContextTickMs < REPLAY_CONTEXT_TICK_MS) {
        return;
    }
    state.replay.lastContextTickMs = now;

    const absoluteMs = getReplayAbsoluteMs(state.replay.t);
    if (!Number.isFinite(absoluteMs)) {
        DOM.replayRaceContext.hidden = true;
        return;
    }

    const positionIndex = state.replay.positionIndex || buildDriverDateIndex(state.position);
    const intervalIndex = state.replay.intervalIndex || buildDriverDateIndex(state.intervals);
    const pitWindows = state.replay.pitWindows || buildReplayPitWindows(state.pitStops, state.replay.timeline);
    state.replay.positionIndex = positionIndex;
    state.replay.intervalIndex = intervalIndex;
    state.replay.pitWindows = pitWindows;

    const order = buildReplayRaceOrder(positionIndex, absoluteMs);
    if (order.length === 0) {
        DOM.replayRaceContext.hidden = true;
        return;
    }

    DOM.replayRaceContext.hidden = false;
    const activeDrivers = new Set(order.map(row => String(row.driverNumber)));

    order.forEach((raceRow, index) => {
        const row = ensureReplayTowerRow(raceRow.driverNumber);
        if (!row) return;

        const driver = getReplayDriver(raceRow.driverNumber);
        const intervalRecord = valueAtMs(intervalIndex.get(raceRow.driverNumber), absoluteMs, REPLAY_INTERVAL_MAX_AGE_MS);
        const inPit = isDriverInPitAtMs(pitWindows, raceRow.driverNumber, absoluteMs);
        const visible = isReplayCarVisible(raceRow.driverNumber);
        const isLeader = index === 0;
        const teamHex = getDriverTeamHex(driver);

        row.row.hidden = false;
        row.row.style.order = String(index);
        row.row.classList.toggle('out', !visible && !inPit);
        row.row.classList.toggle('in-pit', inPit);
        row.color.style.background = `#${teamHex}`;
        row.pos.textContent = String(raceRow.position);
        row.driver.textContent = getReplayDriverCode(raceRow.driverNumber);
        row.status.textContent = inPit ? 'PIT' : (!visible ? 'OUT' : '');
        row.status.className = inPit ? 'replay-tower-status replay-tower-pit' : 'replay-tower-status';
        row.gap.textContent = (!visible && !inPit)
            ? '\u2014'
            : formatReplayGap(intervalRecord && intervalRecord.gap_to_leader, isLeader);
    });

    Object.entries(state.replay.contextRows || {}).forEach(([driverNumber, row]) => {
        row.row.hidden = !activeDrivers.has(driverNumber);
    });
}

function appendReplayPitMarkers(container, segment) {
    if (!container || !segment || state.replay.driverNumber === REPLAY_FULL_RACE) return;
    if (state.replay.driverNumber !== REPLAY_FULL_RACE) {
        const driverNumber = Number(state.replay.driverNumber);
        const lapNumber = Number(segment.lapNumber);
        const hasPitIn = (Array.isArray(state.pitStops) ? state.pitStops : []).some(pitStop => (
            Number(pitStop && pitStop.driver_number) === driverNumber &&
            Number(pitStop && pitStop.lap_number) === lapNumber
        ));
        if (!hasPitIn) return;

        const marker = document.createElement('span');
        marker.className = 'replay-timeline-pit-marker';
        marker.textContent = 'P';
        marker.title = `PIT IN - Lap ${lapNumber}`;
        marker.setAttribute('aria-label', `PIT IN Lap ${lapNumber}`);
        container.appendChild(marker);
    }
}
