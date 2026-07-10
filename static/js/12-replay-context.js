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

// Qualifying "running order": each driver's best lap completed at-or-before
// the playhead, ranked phase-aware like the broadcast tower — any time set in
// a later phase outranks times carried from earlier phases, so the Q1 order
// seeds Q2 until Q2 laps land. Pit-out laps never count as times.
function buildReplayQualiOrder(laps, phases, ms) {
    const phaseList = Array.isArray(phases) ? phases : [];
    const phaseIndexAt = (t) => {
        let index = -1;
        for (let i = 0; i < phaseList.length; i++) {
            if (t >= phaseList[i].startMs) index = i;
            else break;
        }
        return index;
    };

    const best = new Map(); // driverNumber -> { phaseIndex, seconds }
    (Array.isArray(laps) ? laps : []).forEach(lap => {
        const driverNumber = Number(lap && lap.driver_number);
        const duration = Number(lap && lap.lap_duration);
        const startMs = lap && lap.date_start ? new Date(lap.date_start).getTime() : NaN;
        if (!Number.isFinite(driverNumber) || !Number.isFinite(startMs)) return;
        if (!Number.isFinite(duration) || duration <= 0) return;
        if (lap.is_pit_out_lap === true) return;
        if (!Number.isFinite(ms) || startMs + duration * 1000 > ms) return;

        // A lap belongs to the phase it started in: flying laps crossing the
        // line after a phase's chequered flag still count to that phase
        const phaseIndex = phaseIndexAt(startMs);
        const current = best.get(driverNumber);
        if (!current ||
            phaseIndex > current.phaseIndex ||
            (phaseIndex === current.phaseIndex && duration < current.seconds)) {
            best.set(driverNumber, { phaseIndex, seconds: duration });
        }
    });

    const rows = [];
    best.forEach((entry, driverNumber) => {
        rows.push({
            driverNumber,
            phaseIndex: entry.phaseIndex,
            phaseLabel: entry.phaseIndex >= 0 && phaseList[entry.phaseIndex]
                ? phaseList[entry.phaseIndex].label
                : null,
            seconds: entry.seconds
        });
    });

    rows.sort((a, b) => (
        b.phaseIndex - a.phaseIndex ||
        a.seconds - b.seconds ||
        a.driverNumber - b.driverNumber
    ));
    rows.forEach((row, index) => {
        row.position = index + 1;
    });
    return rows;
}

// Leader shows the absolute best time; same-phase rivals show their deficit;
// times carried from an earlier phase show absolute again (cross-phase gaps
// are meaningless); no time yet is an em dash.
function formatReplayQualiGap(row, leader) {
    if (!row || !Number.isFinite(row.seconds)) return '—';
    if (!leader || row.position === 1 || row.phaseIndex !== leader.phaseIndex) {
        return formatLapTime(row.seconds);
    }
    return `+${(row.seconds - leader.seconds).toFixed(3)}`;
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
            // The compatibility pit `date` marks the pit-lane exit, so the lane transit
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
        const isActive = button.dataset.speed === '1';
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
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
        DOM.replayTowerBody.classList.remove('has-driver-highlight');
    }
    if (DOM.replayMapContent) DOM.replayMapContent.classList.remove('has-driver-highlight');
    clearReplayRaceControlTicker();
    if (state.replay) {
        state.replay.contextRows = {};
        state.replay.positionIndex = null;
        state.replay.intervalIndex = null;
        state.replay.stintIndex = null;
        state.replay.pitWindows = null;
        state.replay.qualiPhases = null;
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
    const fiaCar = getFiaCarInfo(driverNumber);
    if (fiaCar) return fiaCar.code;
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

    const segment = segments.find(seg => seg.lapNumber === state.replay.lapNumber) || null;

    // Full-session slices are not laps: show the phase and the playhead clock
    if (state.replay.driverNumber === REPLAY_FULL_SESSION) {
        const absoluteMs = state.replay.data
            ? getReplayAbsoluteMs(state.replay.t)
            : (segment ? segment.startMs : null);
        const phase = segment && segment.phase ? segment.phase : 'Session';
        const clock = Number.isFinite(absoluteMs) ? ` · ${formatRaceControlTime(new Date(absoluteMs))}` : '';
        DOM.replayLapChip.hidden = false;
        DOM.replayLapChip.textContent = `${phase}${clock}`;
        return;
    }

    const total = Number(segments[segments.length - 1].lapNumber);
    const phasePrefix = segment && segment.phase ? `${segment.phase} · ` : '';
    const suffix = state.replay.driverNumber === REPLAY_FULL_RACE
        ? ''
        : ` - ${getReplayDriverCode(state.replay.driverNumber)}`;
    DOM.replayLapChip.hidden = false;
    DOM.replayLapChip.textContent = `${phasePrefix}Lap ${state.replay.lapNumber} / ${total}${suffix}`;
}

function prepareReplayRaceContext() {
    if (!state.replay) return;
    state.replay.positionIndex = buildDriverDateIndex(state.position);
    state.replay.intervalIndex = buildDriverDateIndex(state.intervals);
    state.replay.stintIndex = buildReplayStintIndex(state.stints);
    state.replay.pitWindows = buildReplayPitWindows(state.pitStops, state.replay.timeline);
    state.replay.qualiPhases = replayContextSessionMode() === 'quali' && typeof extractQualifyingPhases === 'function'
        ? extractQualifyingPhases()
        : null;
    state.replay.lastContextTickMs = 0;
    updateReplayLapChip();
}

// Which side-tower the session gets: 'race' towers follow the position
// stream, 'quali' towers rank drivers by current best lap time
function replayContextSessionMode() {
    if (replaySupportsFullRace()) return 'race';
    if (typeof isQualifyingSession === 'function' && isQualifyingSession(state.selectedSession)) return 'quali';
    return null;
}

function replayRaceContextAvailable() {
    return replayContextSessionMode() !== null &&
        state.replay.timeline && state.replay.timeline.segments.length > 0;
}

function setReplayTowerHeadings(orderText, valueText) {
    if (DOM.replayTowerOrderHeading && DOM.replayTowerOrderHeading.textContent !== orderText) {
        DOM.replayTowerOrderHeading.textContent = orderText;
    }
    if (DOM.replayTowerValueHeading && DOM.replayTowerValueHeading.textContent !== valueText) {
        DOM.replayTowerValueHeading.textContent = valueText;
    }
}

async function ensureReplayIntervalsLoaded() {
    if (!state.selectedSession || !replaySupportsFullRace()) return null;
    if (typeof isLiveSessionNow === 'function' && isLiveSessionNow(state.selectedSession)) return null;
    if (state.replay.intervalsSessionKey === state.selectedSession.session_key) return null;
    if (state.replay.intervalsLoading) return state.replay.intervalsLoading;

    const sessionKey = state.selectedSession.session_key;
    state.replay.intervalsLoading = (async () => {
        try {
            const response = await customFetch(`/api/intervals?session_key=${state.selectedSession.session_key}${sessionYearParam()}`);
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
    if (!state.selectedSession || replayContextSessionMode() === null || Array.isArray(state.allSessionLaps)) return null;

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

function hasReplayGapValue(value) {
    return value !== null && value !== undefined && value !== '';
}

function replayGapValueAtMs(records, ms, maxAgeMs = null) {
    const current = valueAtMs(records, ms, maxAgeMs);
    if (current && hasReplayGapValue(current.gap_to_leader)) return current.gap_to_leader;
    if (!Array.isArray(records) || !Number.isFinite(ms)) return null;

    for (let index = records.length - 1; index >= 0; index--) {
        const record = records[index];
        const dateMs = Number(record && record.dateMs);
        if (!Number.isFinite(dateMs) || dateMs > ms) continue;
        if (hasReplayGapValue(record.gap_to_leader)) return record.gap_to_leader;
    }
    return null;
}

function getReplayDriverResult(driverNumber) {
    return (Array.isArray(state.results) ? state.results : [])
        .find(item => Number(item && item.driver_number) === Number(driverNumber)) || null;
}

function isReplayDriverDidNotStart(driverNumber) {
    const result = getReplayDriverResult(driverNumber);
    if (!result) return false;

    const status = String(result.status || '').trim().toUpperCase();
    return result.dns === true || status === 'DNS' || status === 'DID NOT START';
}

function isReplayDriverRetiredAtMs(driverNumber, ms, positionRecords) {
    const result = getReplayDriverResult(driverNumber);
    if (!result) return false;

    const status = String(result.status || '').trim().toUpperCase();
    const retired = result.dnf === true ||
        status === 'RETIRED' ||
        status === 'DNF' ||
        status === 'DID NOT FINISH';
    if (!retired) return false;

    if (Array.isArray(positionRecords) && Number.isFinite(ms)) {
        return !positionRecords.some(record => Number(record && record.dateMs) > ms);
    }
    return true;
}

function getReplayDriverStatusAtMs(driverNumber, ms, positionRecords) {
    const didNotStart = isReplayDriverDidNotStart(driverNumber);
    const retired = !didNotStart && isReplayDriverRetiredAtMs(driverNumber, ms, positionRecords);
    return {
        didNotStart,
        retired,
        markerVisible: !didNotStart && !retired,
        label: didNotStart ? 'DNS' : (retired ? 'OUT' : '')
    };
}

function formatReplayGap(value, isLeader) {
    if (isLeader) return 'Leader';
    if (!hasReplayGapValue(value)) return '';
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
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Focus ${getReplayDriverCode(driverNumber)} in replay`);
    row.setAttribute('aria-pressed', 'false');
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

function updateReplayTowerRowAccessibleName(row) {
    if (!row || !row.row) return;
    const position = String(row.pos.textContent || '').trim();
    const driver = String(row.driver.textContent || '').trim();
    const tyre = String(row.tyre.title || '').trim();
    const status = String(row.status.textContent || '').trim();
    const gap = String(row.gap.textContent || '').trim();
    const details = [
        position ? `Position ${position}` : '',
        driver,
        tyre ? `${tyre.toLowerCase()} tyre` : '',
        status,
        gap
    ].filter(Boolean);
    row.row.setAttribute('aria-label', `${details.join(', ')}. Activate to focus this driver.`);
}

function placeReplayTowerRow(rowElement, index) {
    if (!DOM.replayTowerBody || !rowElement) return;
    const currentAtIndex = DOM.replayTowerBody.children[index] || null;
    if (currentAtIndex !== rowElement) {
        DOM.replayTowerBody.insertBefore(rowElement, currentAtIndex);
    }
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
    const highlightValue = state.replay.highlightedDriverNumber;
    const highlighted = highlightValue === null || highlightValue === undefined
        ? NaN
        : Number(highlightValue);
    const hasHighlight = Number.isFinite(highlighted);

    if (DOM.replayMapContent) DOM.replayMapContent.classList.toggle('has-driver-highlight', hasHighlight);
    if (DOM.replayTowerBody) DOM.replayTowerBody.classList.toggle('has-driver-highlight', hasHighlight);

    Object.entries(state.replay.carNodes || {}).forEach(([driverNumber, node]) => {
        if (node && node.group) {
            const isHighlighted = hasHighlight && Number(driverNumber) === highlighted;
            node.group.classList.toggle('highlighted', isHighlighted);
            if (node.group.getAttribute('role') === 'button') {
                node.group.setAttribute('aria-pressed', String(isHighlighted));
            }
        }
    });

    Object.entries(state.replay.contextRows || {}).forEach(([driverNumber, row]) => {
        if (row && row.row) {
            const isHighlighted = hasHighlight && Number(driverNumber) === highlighted;
            row.row.classList.toggle('highlighted', isHighlighted);
            row.row.setAttribute('aria-pressed', String(isHighlighted));
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

function onReplayDriverHighlightKeydown(event) {
    if (!event || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    onReplayDriverHighlightClick(event);
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

    if (replayContextSessionMode() === 'quali') {
        updateReplayQualiTower(absoluteMs, allowRowFlash);
        return;
    }
    setReplayTowerHeadings('Running Order', 'Gaps');

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
        const intervalRecords = intervalIndex.get(raceRow.driverNumber);
        const positionRecords = positionIndex.get(raceRow.driverNumber);
        const gapValue = replayGapValueAtMs(intervalRecords, absoluteMs, REPLAY_INTERVAL_MAX_AGE_MS);
        const lapRecord = deriveDriverLapAt(state.allSessionLaps, absoluteMs, raceRow.driverNumber);
        const stint = lapRecord ? stintForDriverLap(stintIndex, raceRow.driverNumber, lapRecord.lapNumber) : null;
        const tyre = formatReplayTyreCompound(stint && stint.compound);
        const inPit = isDriverInPitAtMs(pitWindows, raceRow.driverNumber, absoluteMs);
        const driverStatus = getReplayDriverStatusAtMs(raceRow.driverNumber, absoluteMs, positionRecords);
        const inactive = driverStatus.didNotStart || driverStatus.retired;
        const isLeader = index === 0;
        const teamHex = getDriverTeamHex(driver);

        row.row.hidden = false;
        row.row.style.order = String(index);
        row.row.classList.toggle('out', driverStatus.didNotStart || (driverStatus.retired && !inPit));
        row.row.classList.toggle('in-pit', inPit);
        row.color.style.background = `#${teamHex}`;
        row.pos.textContent = String(raceRow.position);
        row.driver.textContent = getReplayDriverCode(raceRow.driverNumber);
        row.tyre.textContent = tyre ? tyre.label : '';
        row.tyre.title = tyre ? tyre.title : '';
        row.tyre.className = tyre ? `replay-tower-tyre ${tyre.className}` : 'replay-tower-tyre';
        row.status.textContent = driverStatus.didNotStart
            ? driverStatus.label
            : (inPit ? 'PIT' : driverStatus.label);
        row.status.className = inPit && !driverStatus.didNotStart
            ? 'replay-tower-status replay-tower-pit'
            : 'replay-tower-status';
        row.gap.textContent = inactive
            ? '\u2014'
            : formatReplayGap(gapValue, isLeader);
        updateReplayTowerRowAccessibleName(row);
        placeReplayTowerRow(row.row, index);
    });

    Object.entries(state.replay.contextRows || {}).forEach(([driverNumber, row]) => {
        row.row.hidden = !activeDrivers.has(driverNumber);
    });
    applyReplayHighlight();
}

// Qualifying side tower: rows rank by current best lap time instead of the
// position stream. Drivers yet to set a time hold the tower's tail so the
// field is visible from the green light; times carried from an earlier phase
// are tagged with that phase's label (Q1/Q2) in the status column.
function updateReplayQualiTower(absoluteMs, allowRowFlash) {
    const phases = state.replay.qualiPhases ||
        (typeof extractQualifyingPhases === 'function' ? extractQualifyingPhases() : []);
    state.replay.qualiPhases = phases;
    const stintIndex = state.replay.stintIndex || buildReplayStintIndex(state.stints);
    state.replay.stintIndex = stintIndex;

    const order = buildReplayQualiOrder(state.allSessionLaps, phases, absoluteMs);
    const timedDrivers = new Set(order.map(row => row.driverNumber));
    (Array.isArray(state.drivers) ? state.drivers : [])
        .map(driver => Number(driver.driver_number))
        .filter(driverNumber => Number.isFinite(driverNumber) && !timedDrivers.has(driverNumber))
        .sort((a, b) => a - b)
        .forEach(driverNumber => {
            order.push({
                driverNumber,
                position: order.length + 1,
                phaseIndex: -1,
                phaseLabel: null,
                seconds: null
            });
        });

    if (order.length === 0) {
        DOM.replayRaceContext.hidden = true;
        clearReplayRaceControlTicker();
        return;
    }

    DOM.replayRaceContext.hidden = false;
    setReplayTowerHeadings('Best Times', 'Time');
    const activeDrivers = new Set(order.map(row => String(row.driverNumber)));
    const shownDrivers = new Set(order.map(row => Number(row.driverNumber)));
    updateReplayRaceControlTicker(absoluteMs, shownDrivers);

    const leader = order[0] && Number.isFinite(order[0].seconds) ? order[0] : null;
    order.forEach((qualiRow, index) => {
        const row = ensureReplayTowerRow(qualiRow.driverNumber);
        if (!row) return;

        const wasVisible = !row.row.hidden;
        if (allowRowFlash && wasVisible) {
            applyReplayRowFlash(row.row, replayPositionFlashClass(row.lastPosition, qualiRow.position));
        }
        row.lastPosition = qualiRow.position;

        const driver = getReplayDriver(qualiRow.driverNumber);
        const lapRecord = deriveDriverLapAt(state.allSessionLaps, absoluteMs, qualiRow.driverNumber);
        const stint = lapRecord ? stintForDriverLap(stintIndex, qualiRow.driverNumber, lapRecord.lapNumber) : null;
        const tyre = formatReplayTyreCompound(stint && stint.compound);
        // A best time carried over from an earlier phase gets that phase's tag
        const stalePhase = leader && Number.isFinite(qualiRow.seconds) && qualiRow.phaseIndex < leader.phaseIndex;

        row.row.hidden = false;
        row.row.style.order = String(index);
        row.row.classList.remove('out', 'in-pit');
        row.color.style.background = `#${getDriverTeamHex(driver)}`;
        row.pos.textContent = String(qualiRow.position);
        row.driver.textContent = getReplayDriverCode(qualiRow.driverNumber);
        row.tyre.textContent = tyre ? tyre.label : '';
        row.tyre.title = tyre ? tyre.title : '';
        row.tyre.className = tyre ? `replay-tower-tyre ${tyre.className}` : 'replay-tower-tyre';
        row.status.textContent = stalePhase ? (qualiRow.phaseLabel || '') : '';
        row.status.className = 'replay-tower-status';
        row.gap.textContent = formatReplayQualiGap(qualiRow, leader);
        row.gap.title = Number.isFinite(qualiRow.seconds) ? formatLapTime(qualiRow.seconds) : 'No time set';
        updateReplayTowerRowAccessibleName(row);
        placeReplayTowerRow(row.row, index);
    });

    Object.entries(state.replay.contextRows || {}).forEach(([driverNumber, row]) => {
        row.row.hidden = !activeDrivers.has(driverNumber);
    });
    applyReplayHighlight();
}

// ===== Reference-driver telemetry strip (speed / gear / DRS) =====
// Driver mode only: the reference driver's car_data shares the replay's lap
// window (both come from build_lap_telemetry_window), so sample.t aligns with
// state.replay.t directly. Whole-field modes have no reference driver — hidden.

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
    if (isReplayWholeFieldSelection(driverNumber) || !Number.isFinite(Number(driverNumber)) || !Number.isFinite(lapNumber)) return;

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
        !isReplayWholeFieldSelection(state.replay.driverNumber) &&
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

    const referenceDriver = isReplayWholeFieldSelection(state.replay.driverNumber)
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
    if (!container || !segment || isReplayWholeFieldSelection(state.replay.driverNumber)) return;

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
