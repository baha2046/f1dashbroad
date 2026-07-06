// Session Replay race-context side panel: running order, gaps, lap chip,
// and pit status keyed from the single replay absolute time source.
const REPLAY_CONTEXT_TICK_MS = 250;
const REPLAY_INTERVAL_MAX_AGE_MS = 20000;
const REPLAY_PIT_WINDOW_PAD_SECONDS = 5;
// Suppress row flashes when the playhead jumped more than this between ticks
// (seeks, lap switches) so a scrub doesn't fire a flash storm
const REPLAY_ROW_FLASH_MAX_JUMP_MS = 5000;
// Telemetry-strip readouts go blank when the nearest sample is older than this
const REPLAY_TELEMETRY_MAX_GAP_SECONDS = 4;
const REPLAY_TYRE_COMPOUND_LABELS = {
    SOFT: 'S',
    MEDIUM: 'M',
    HARD: 'H',
    INTERMEDIATE: 'I',
    WET: 'W',
    UNKNOWN: '?'
};

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
            // OpenF1 pit `date` marks the pit-lane exit, so the lane transit
            // (`pit_duration`) extends backwards from it.
            const laneMs = Number.isFinite(durationSeconds) && durationSeconds > 0
                ? durationSeconds * 1000
                : padMs;
            startMs = dateMs - laneMs - padMs;
            endMs = dateMs + padMs;
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

function buildReplayStintIndex(stints) {
    const index = new Map();
    (Array.isArray(stints) ? stints : []).forEach(stint => {
        const driverNumber = Number(stint && stint.driver_number);
        const lapStart = Number(stint && stint.lap_start);
        const lapEnd = Number(stint && stint.lap_end);
        if (!Number.isFinite(driverNumber) || !Number.isFinite(lapStart)) return;

        if (!index.has(driverNumber)) index.set(driverNumber, []);
        index.get(driverNumber).push({
            ...stint,
            driverNumber,
            lapStart,
            lapEnd: Number.isFinite(lapEnd) ? lapEnd : Infinity
        });
    });

    index.forEach(records => {
        records.sort((a, b) => (
            a.lapStart - b.lapStart ||
            a.lapEnd - b.lapEnd
        ));
    });
    return index;
}

function stintForDriverLap(stintIndex, driverNumber, lapNumber) {
    if (!(stintIndex instanceof Map) || !Number.isFinite(Number(lapNumber))) return null;
    const stints = stintIndex.get(Number(driverNumber));
    if (!Array.isArray(stints)) return null;

    const lap = Number(lapNumber);
    return stints.find(stint => lap >= stint.lapStart && lap <= stint.lapEnd) || null;
}

function formatReplayTyreCompound(compound) {
    const normalized = String(compound || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!normalized) return null;

    const label = REPLAY_TYRE_COMPOUND_LABELS[normalized] || normalized.slice(0, 3);
    return {
        label,
        title: normalized.replace(/_/g, ' '),
        className: `compound-${normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    };
}

// 'flash-up' when a driver gained places since the previous tick,
// 'flash-down' when they lost places, null otherwise
function replayPositionFlashClass(previousPosition, currentPosition) {
    // Explicit null/undefined checks: Number(null) is 0, which would read as P0
    if (previousPosition === null || previousPosition === undefined) return null;
    if (currentPosition === null || currentPosition === undefined) return null;

    const previous = Number(previousPosition);
    const current = Number(currentPosition);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === current) return null;
    return current < previous ? 'flash-up' : 'flash-down';
}

function applyReplayRowFlash(rowElement, flashClass) {
    if (!rowElement || !flashClass) return;
    rowElement.classList.remove('flash-up', 'flash-down');
    void rowElement.offsetWidth; // restart the animation when re-flashing mid-animation
    rowElement.classList.add(flashClass);
}

// Latest telemetry sample at-or-before t (seconds within the lap window);
// null in data gaps. Mirrors interpolateReplaySample's leading-edge snap.
function replayTelemetryAtT(samples, t, maxGapSeconds = REPLAY_TELEMETRY_MAX_GAP_SECONDS) {
    if (!Array.isArray(samples) || samples.length === 0 || !Number.isFinite(t)) return null;

    const first = samples[0];
    if (t < first.t) {
        return (first.t - t) <= maxGapSeconds ? first : null;
    }

    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (samples[mid].t <= t) lo = mid;
        else hi = mid - 1;
    }

    const sample = samples[lo];
    return (t - sample.t) <= maxGapSeconds ? sample : null;
}

function formatReplayGear(gear) {
    // Missing readings show as an em dash; Number(null) would masquerade as neutral
    if (gear === null || gear === undefined || gear === '') return '—';
    const value = Number(gear);
    if (!Number.isFinite(value)) return '—';
    return value <= 0 ? 'N' : String(value);
}

function normalizeReplayDriverSet(driverNumbers) {
    if (driverNumbers instanceof Set) {
        return new Set([...driverNumbers].map(Number).filter(Number.isFinite));
    }
    if (Array.isArray(driverNumbers)) {
        return new Set(driverNumbers.map(Number).filter(Number.isFinite));
    }
    return null;
}

function raceControlRecordMentionsShownDriver(record, shownDrivers) {
    const drivers = normalizeReplayDriverSet(shownDrivers);
    if (!(drivers instanceof Set) || drivers.size === 0) return false;

    const directDriver = Number(record && record.driver_number);
    if (Number.isFinite(directDriver) && drivers.has(directDriver)) return true;

    const message = String(record && record.message ? record.message : '').toUpperCase();
    const patterns = [
        /CAR(?:S)?\s+(\d+)/g,
        /\b(\d+)\s*\([A-Z]{3}\)/g
    ];
    for (const pattern of patterns) {
        for (const match of message.matchAll(pattern)) {
            const driverNumber = Number(match[1]);
            if (Number.isFinite(driverNumber) && drivers.has(driverNumber)) return true;
        }
    }
    return false;
}

function isHighSignalReplayRaceControl(record, shownDrivers = null) {
    if (!record || !record.date) return false;

    const message = String(record.message || '').toUpperCase();
    const flag = String(record.flag || '').toUpperCase();
    const category = String(record.category || '').toUpperCase();
    const type = typeof getRaceControlType === 'function'
        ? String(getRaceControlType(record)).toUpperCase()
        : flag;

    if (flag === 'BLUE' || type === 'BLUE') return false;
    if (['YELLOW', 'DOUBLE YELLOW', 'RED', 'GREEN', 'CLEAR', 'CHEQUERED'].includes(flag)) return true;
    if (category === 'SAFETYCAR' || type.includes('SAFETY CAR')) return true;
    if (message.includes('SAFETY CAR') || message.includes('VSC') || message.includes('VIRTUAL SAFETY')) return true;

    const isDriverSpecificIncident = (
        message.includes('PENALTY') ||
        message.includes('INVESTIGAT') ||
        message.includes('INCIDENT')
    );
    return isDriverSpecificIncident && raceControlRecordMentionsShownDriver(record, shownDrivers);
}

function latestReplayRaceControlAt(records, ms, shownDrivers = null) {
    if (!Array.isArray(records) || !Number.isFinite(ms)) return null;

    let latest = null;
    records.forEach(record => {
        const dateMs = record && record.date ? new Date(record.date).getTime() : NaN;
        if (!Number.isFinite(dateMs) || dateMs > ms) return;
        if (!isHighSignalReplayRaceControl(record, shownDrivers)) return;
        if (!latest || dateMs >= latest.dateMs) {
            latest = {
                ...record,
                dateMs
            };
        }
    });
    return latest;
}

function resetReplaySpeedToggle() {
    if (!DOM.replaySpeedToggle) return;
    DOM.replaySpeedToggle.querySelectorAll('button[data-speed]').forEach(button => {
        button.classList.toggle('active', button.dataset.speed === '1');
    });
}

function clearReplayRaceControlTicker() {
    if (DOM.replayRaceControlTicker) {
        DOM.replayRaceControlTicker.hidden = true;
    }
    if (DOM.replayRaceControlTickerType) {
        DOM.replayRaceControlTickerType.textContent = 'Race Control';
    }
    if (DOM.replayRaceControlTickerMessage) {
        DOM.replayRaceControlTickerMessage.textContent = '';
    }
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
    clearReplayRaceControlTicker();
    if (state.replay) {
        state.replay.contextRows = {};
        state.replay.positionIndex = null;
        state.replay.intervalIndex = null;
        state.replay.stintIndex = null;
        state.replay.pitWindows = null;
        state.replay.highlightedDriverNumber = null;
        state.replay.lastContextTickMs = 0;
        state.replay.lastContextAbsMs = null;
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
    state.replay.stintIndex = buildReplayStintIndex(state.stints);
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

async function ensureReplayAllSessionLapsLoaded() {
    if (!state.selectedSession || !replaySupportsFullRace() || Array.isArray(state.allSessionLaps)) return null;

    const sessionKey = state.selectedSession.session_key;
    try {
        const laps = await fetchAllSessionLaps(sessionKey);
        if (!state.selectedSession || state.selectedSession.session_key !== sessionKey) return null;
        if (Array.isArray(laps)) {
            updateReplayRaceContext(true);
        }
        return laps;
    } catch (error) {
        console.error('Error fetching replay lap memo:', error);
    }
    return null;
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
    row.addEventListener('animationend', (event) => {
        if (String(event.animationName).startsWith('replay-row-flash')) {
            row.classList.remove('flash-up', 'flash-down');
        }
    });

    const pos = document.createElement('span');
    pos.className = 'replay-tower-pos';
    row.appendChild(pos);

    const color = document.createElement('span');
    color.className = 'replay-tower-color';
    row.appendChild(color);

    const driver = document.createElement('span');
    driver.className = 'replay-tower-driver';
    row.appendChild(driver);

    const tyre = document.createElement('span');
    tyre.className = 'replay-tower-tyre';
    row.appendChild(tyre);

    const status = document.createElement('span');
    status.className = 'replay-tower-status';
    row.appendChild(status);

    const gap = document.createElement('span');
    gap.className = 'replay-tower-gap';
    row.appendChild(gap);

    DOM.replayTowerBody.appendChild(row);
    state.replay.contextRows[driverNumber] = { row, pos, color, driver, tyre, status, gap };
    return state.replay.contextRows[driverNumber];
}

function updateReplayRaceControlTicker(absoluteMs, shownDrivers) {
    if (!DOM.replayRaceControlTicker || !DOM.replayRaceControlTickerType || !DOM.replayRaceControlTickerMessage) return;

    const record = latestReplayRaceControlAt(state.raceControl, absoluteMs, shownDrivers);
    if (!record) {
        clearReplayRaceControlTicker();
        return;
    }

    const typeLabel = typeof getRaceControlType === 'function'
        ? getRaceControlType(record)
        : (record.flag || record.category || 'Race Control');
    const typeClass = typeof getRaceControlClass === 'function' ? getRaceControlClass(typeLabel) : '';
    DOM.replayRaceControlTicker.hidden = false;
    DOM.replayRaceControlTicker.className = `replay-race-control-ticker ${typeClass}`.trim();
    DOM.replayRaceControlTickerType.textContent = `${formatRaceControlTime(record.date)} - ${typeLabel}`;
    DOM.replayRaceControlTickerMessage.textContent = record.message || 'Race control notice';
}

function applyReplayHighlight() {
    if (!state.replay) return;
    const highlighted = Number(state.replay.highlightedDriverNumber);
    const hasHighlight = Number.isFinite(highlighted);

    Object.entries(state.replay.carNodes || {}).forEach(([driverNumber, node]) => {
        if (node && node.group) {
            node.group.classList.toggle('highlighted', hasHighlight && Number(driverNumber) === highlighted);
        }
    });

    Object.entries(state.replay.contextRows || {}).forEach(([driverNumber, row]) => {
        if (row && row.row) {
            row.row.classList.toggle('highlighted', hasHighlight && Number(driverNumber) === highlighted);
        }
    });
}

function highlightReplayDriver(driverNumber) {
    if (!state.replay) return;
    const normalized = Number(driverNumber);
    if (!Number.isFinite(normalized)) return;

    state.replay.highlightedDriverNumber = state.replay.highlightedDriverNumber === normalized ? null : normalized;
    applyReplayHighlight();
}

function onReplayDriverHighlightClick(event) {
    const target = event && event.target ? event.target.closest('[data-driver-number]') : null;
    if (!target) return;

    const driverNumber = Number(target.dataset ? target.dataset.driverNumber : target.getAttribute('data-driver-number'));
    if (!Number.isFinite(driverNumber)) return;

    event.preventDefault();
    highlightReplayDriver(driverNumber);
}

function updateReplayRaceContext(force = false) {
    updateReplayLapChip();
    if (!DOM.replayRaceContext || !DOM.replayTowerBody) return;

    if (!replayRaceContextAvailable() || !state.replay.data) {
        DOM.replayRaceContext.hidden = true;
        clearReplayRaceControlTicker();
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

    const previousAbsoluteMs = state.replay.lastContextAbsMs;
    state.replay.lastContextAbsMs = absoluteMs;
    const allowRowFlash = Number.isFinite(previousAbsoluteMs) &&
        Math.abs(absoluteMs - previousAbsoluteMs) <= REPLAY_ROW_FLASH_MAX_JUMP_MS;

    const positionIndex = state.replay.positionIndex || buildDriverDateIndex(state.position);
    const intervalIndex = state.replay.intervalIndex || buildDriverDateIndex(state.intervals);
    const stintIndex = state.replay.stintIndex || buildReplayStintIndex(state.stints);
    const pitWindows = state.replay.pitWindows || buildReplayPitWindows(state.pitStops, state.replay.timeline);
    state.replay.positionIndex = positionIndex;
    state.replay.intervalIndex = intervalIndex;
    state.replay.stintIndex = stintIndex;
    state.replay.pitWindows = pitWindows;

    const order = buildReplayRaceOrder(positionIndex, absoluteMs);
    if (order.length === 0) {
        DOM.replayRaceContext.hidden = true;
        clearReplayRaceControlTicker();
        return;
    }

    DOM.replayRaceContext.hidden = false;
    const activeDrivers = new Set(order.map(row => String(row.driverNumber)));
    const shownDrivers = new Set(order.map(row => Number(row.driverNumber)));
    updateReplayRaceControlTicker(absoluteMs, shownDrivers);

    order.forEach((raceRow, index) => {
        const row = ensureReplayTowerRow(raceRow.driverNumber);
        if (!row) return;

        // Flash only rows that were already on screen with a known position:
        // rows appearing (tab entry, un-hide) must not fire a bogus flash
        const wasVisible = !row.row.hidden;
        if (allowRowFlash && wasVisible) {
            applyReplayRowFlash(row.row, replayPositionFlashClass(row.lastPosition, raceRow.position));
        }
        row.lastPosition = raceRow.position;

        const driver = getReplayDriver(raceRow.driverNumber);
        const intervalRecord = valueAtMs(intervalIndex.get(raceRow.driverNumber), absoluteMs, REPLAY_INTERVAL_MAX_AGE_MS);
        const lapRecord = deriveDriverLapAt(state.allSessionLaps, absoluteMs, raceRow.driverNumber);
        const stint = lapRecord ? stintForDriverLap(stintIndex, raceRow.driverNumber, lapRecord.lapNumber) : null;
        const tyre = formatReplayTyreCompound(stint && stint.compound);
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
        row.tyre.textContent = tyre ? tyre.label : '';
        row.tyre.title = tyre ? tyre.title : '';
        row.tyre.className = tyre ? `replay-tower-tyre ${tyre.className}` : 'replay-tower-tyre';
        row.status.textContent = inPit ? 'PIT' : (!visible ? 'OUT' : '');
        row.status.className = inPit ? 'replay-tower-status replay-tower-pit' : 'replay-tower-status';
        row.gap.textContent = (!visible && !inPit)
            ? '\u2014'
            : formatReplayGap(intervalRecord && intervalRecord.gap_to_leader, isLeader);
    });

    Object.entries(state.replay.contextRows || {}).forEach(([driverNumber, row]) => {
        row.row.hidden = !activeDrivers.has(driverNumber);
    });
    applyReplayHighlight();
}

// ===== Reference-driver telemetry strip (speed / gear / DRS) =====
// Driver mode only: the reference driver's car_data shares the replay's lap
// window (both come from build_lap_telemetry_window), so sample.t aligns with
// state.replay.t directly. Full-race mode has no reference driver — hidden.

let replayTelemetryFetchPromises = {};

function clearReplayTelemetryStrip() {
    replayTelemetryFetchPromises = {};
    if (DOM.replayTelemetryStrip) {
        DOM.replayTelemetryStrip.hidden = true;
    }
}

// Fetch and memoize a lap's car telemetry; shares state.telemetryCache (and
// its key format) with the Laps tab so neither fetches what the other has.
function fetchReplayTelemetryPayload(sessionKey, driverNumber, lapNumber) {
    const cacheKey = `${sessionKey}_${driverNumber}_${lapNumber}`;
    if (state.telemetryCache[cacheKey]) return Promise.resolve(state.telemetryCache[cacheKey]);

    if (!replayTelemetryFetchPromises[cacheKey]) {
        replayTelemetryFetchPromises[cacheKey] = (async () => {
            try {
                const response = await customFetch(
                    `/api/car_telemetry?session_key=${sessionKey}&driver_number=${driverNumber}&lap_number=${lapNumber}`
                );
                if (!response.ok) return null;
                const payload = await response.json();
                if (!payload || !Array.isArray(payload.telemetry) || payload.telemetry.length === 0) return null;
                state.telemetryCache[cacheKey] = payload;
                return payload;
            } catch (error) {
                console.error('Error fetching replay telemetry:', error);
                return null;
            } finally {
                delete replayTelemetryFetchPromises[cacheKey];
            }
        })();
    }
    return replayTelemetryFetchPromises[cacheKey];
}

async function ensureReplayTelemetryLoaded() {
    updateReplayTelemetryStrip(true); // hide immediately while the mode/lap has no samples
    if (!state.selectedSession) return;

    const driverNumber = state.replay.driverNumber;
    const lapNumber = state.replay.lapNumber;
    if (driverNumber === REPLAY_FULL_RACE || !Number.isFinite(Number(driverNumber)) || !Number.isFinite(lapNumber)) return;

    const sessionKey = state.selectedSession.session_key;
    const cacheKey = `${sessionKey}_${driverNumber}_${lapNumber}`;
    const payload = await fetchReplayTelemetryPayload(sessionKey, driverNumber, lapNumber);

    // The user may have moved on while telemetry was loading
    if (!state.selectedSession || state.selectedSession.session_key !== sessionKey) return;
    if (state.replay.loadedKey !== cacheKey) return;

    state.replay.telemetrySamples = payload ? payload.telemetry : null;
    state.replay.telemetryKey = payload ? cacheKey : null;
    updateReplayTelemetryStrip(true);
}

function updateReplayTelemetryStrip(force = false) {
    if (!DOM.replayTelemetryStrip) return;

    const available = (
        state.replay.driverNumber !== REPLAY_FULL_RACE &&
        state.replay.data &&
        state.replay.telemetryKey === state.replay.loadedKey &&
        Array.isArray(state.replay.telemetrySamples) &&
        state.replay.telemetrySamples.length > 0
    );
    if (!available) {
        if (!DOM.replayTelemetryStrip.hidden) DOM.replayTelemetryStrip.hidden = true;
        return;
    }

    const now = getReplayContextNowMs();
    if (!force && state.replay.lastTelemetryTickMs && now - state.replay.lastTelemetryTickMs < REPLAY_CONTEXT_TICK_MS) {
        return;
    }
    state.replay.lastTelemetryTickMs = now;

    const sample = replayTelemetryAtT(state.replay.telemetrySamples, state.replay.t);
    const speed = sample ? Number(sample.speed) : NaN;
    const drsActive = !!(sample && typeof isTelemetryDrsActive === 'function' && isTelemetryDrsActive(sample.drs));

    DOM.replayTelemetryStrip.hidden = false;
    if (DOM.replayTelemetryDriver) {
        DOM.replayTelemetryDriver.textContent = getReplayDriverCode(state.replay.driverNumber);
    }
    if (DOM.replayTelemetrySpeed) {
        DOM.replayTelemetrySpeed.textContent = Number.isFinite(speed) ? String(Math.round(speed)) : '—';
    }
    if (DOM.replayTelemetryGear) {
        DOM.replayTelemetryGear.textContent = formatReplayGear(sample && sample.gear);
    }
    if (DOM.replayTelemetryDrs) {
        DOM.replayTelemetryDrs.classList.toggle('active', drsActive);
    }
}

// ===== Team radio ticker =====
// Shows the latest radio clip at-or-before the playhead (within a freshness
// window): the reference driver's radio in driver mode, any driver's in
// full-race mode. Playback is manual — the ticker's play button drives the
// shared team radio player (autoplay policies make synced auto-play
// unreliable).
const REPLAY_TEAM_RADIO_MAX_AGE_MS = 120000;

function latestReplayTeamRadioAt(radioIndex, ms, driverNumber = null) {
    if (!(radioIndex instanceof Map) || !Number.isFinite(ms)) return null;

    if (driverNumber !== null) {
        return valueAtMs(radioIndex.get(Number(driverNumber)), ms, REPLAY_TEAM_RADIO_MAX_AGE_MS);
    }

    let latest = null;
    radioIndex.forEach(records => {
        const record = valueAtMs(records, ms, REPLAY_TEAM_RADIO_MAX_AGE_MS);
        if (record && (!latest || record.dateMs > latest.dateMs)) latest = record;
    });
    return latest;
}

function clearReplayTeamRadioTicker() {
    if (DOM.replayTeamRadioTicker) {
        DOM.replayTeamRadioTicker.hidden = true;
    }
    if (DOM.replayTeamRadioPlayBtn) {
        DOM.replayTeamRadioPlayBtn.dataset.radioUrl = '';
    }
    if (DOM.replayTeamRadioMeta) {
        DOM.replayTeamRadioMeta.textContent = '';
    }
}

function updateReplayTeamRadioTicker(force = false) {
    if (!DOM.replayTeamRadioTicker || !DOM.replayTeamRadioPlayBtn || !DOM.replayTeamRadioMeta) return;

    if (!state.replay.data || !Array.isArray(state.teamRadio) || state.teamRadio.length === 0) {
        if (!DOM.replayTeamRadioTicker.hidden) clearReplayTeamRadioTicker();
        return;
    }

    const now = getReplayContextNowMs();
    if (!force && state.replay.lastTeamRadioTickMs && now - state.replay.lastTeamRadioTickMs < REPLAY_CONTEXT_TICK_MS) {
        return;
    }
    state.replay.lastTeamRadioTickMs = now;

    const absoluteMs = getReplayAbsoluteMs(state.replay.t);
    if (!Number.isFinite(absoluteMs)) {
        clearReplayTeamRadioTicker();
        return;
    }

    const radioIndex = state.replay.teamRadioIndex || buildDriverDateIndex(state.teamRadio);
    state.replay.teamRadioIndex = radioIndex;

    const referenceDriver = state.replay.driverNumber === REPLAY_FULL_RACE
        ? null
        : Number(state.replay.driverNumber);
    const record = latestReplayTeamRadioAt(radioIndex, absoluteMs, referenceDriver);
    if (!record || !isPlayableTeamRadioUrl(record.recording_url)) {
        clearReplayTeamRadioTicker();
        return;
    }

    DOM.replayTeamRadioTicker.hidden = false;
    if (DOM.replayTeamRadioPlayBtn.dataset.radioUrl !== record.recording_url) {
        DOM.replayTeamRadioPlayBtn.dataset.radioUrl = record.recording_url;
        DOM.replayTeamRadioMeta.textContent = `${formatRaceControlTime(record.date)} - ${getReplayDriverCode(record.driverNumber)}`;
        syncTeamRadioPlayingButtons();
    }
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
