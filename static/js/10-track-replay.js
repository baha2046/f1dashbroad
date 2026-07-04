// ===== Track Position Replay (location data on the circuit map) =====
// Single-lap replay: a reference driver + lap defines the time window and the
// whole field's positions are animated over it (see doc/2026-07-04-track-replay-design.md).

// Hide a car when the gap between its bracketing samples exceeds this (garage/retirement)
const REPLAY_SAMPLE_GAP_SECONDS = 4;

function resetReplay() {
    if (state.replay && state.replay.rafId !== null) {
        cancelAnimationFrame(state.replay.rafId);
    }
    state.replay = createReplayState();
    state.replayCache = {};

    if (DOM.replayPlayBtn) {
        DOM.replayPlayBtn.disabled = true;
        setReplayPlayIcon(false);
    }
    if (DOM.replayScrubber) {
        DOM.replayScrubber.disabled = true;
        DOM.replayScrubber.value = 0;
    }
    if (DOM.replayTimeLabel) {
        DOM.replayTimeLabel.textContent = '0.0s / 0.0s';
    }
    if (DOM.replayLapSelect) {
        DOM.replayLapSelect.innerHTML = '';
    }
    renderReplayMessage('Select a session to replay track positions.');
}

function setReplayPlayIcon(playing) {
    if (!DOM.replayPlayBtn) return;
    const icon = DOM.replayPlayBtn.querySelector('.material-icons-round');
    if (icon) icon.textContent = playing ? 'pause' : 'play_arrow';
}

function renderReplayMessage(text) {
    if (DOM.replayMapContent) {
        DOM.replayMapContent.innerHTML = `<div class="replay-message">${escapeHtml(text)}</div>`;
    }
}

function setupReplaySection() {
    if (!DOM.replayCard || !DOM.replayDriverSelect) return;

    if (!Array.isArray(state.drivers) || state.drivers.length === 0) {
        DOM.replayDriverSelect.innerHTML = '';
        renderReplayMessage('No drivers available for this session.');
        return;
    }

    const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    DOM.replayDriverSelect.innerHTML = sortedDrivers.map(d => {
        const label = d.full_name || d.broadcast_name || `Driver ${d.driver_number}`;
        return `<option value="${d.driver_number}">${escapeHtml(label)} (#${d.driver_number})</option>`;
    }).join('');

    renderReplayMessage('Replay loads when the Circuit Details tab is open.');
    populateReplayLapSelect().then(() => maybeAutoLoadReplay());
}

async function populateReplayLapSelect() {
    if (!DOM.replayLapSelect || !DOM.replayDriverSelect || !state.selectedSession) return;

    const driverNumber = Number(DOM.replayDriverSelect.value);
    if (!Number.isFinite(driverNumber)) return;

    DOM.replayLapSelect.innerHTML = '<option value="">Loading laps...</option>';
    const laps = await fetchDriverLaps(state.selectedSession.session_key, driverNumber);

    // The user may have changed driver while laps were loading
    if (Number(DOM.replayDriverSelect.value) !== driverNumber) return;

    const selectable = (Array.isArray(laps) ? laps : []).filter(lap => lap && lap.date_start);
    if (selectable.length === 0) {
        DOM.replayLapSelect.innerHTML = '';
        renderReplayMessage('No laps with timing data recorded for this driver.');
        return;
    }

    const fastest = selectable.reduce((best, lap) => {
        if (!lap.lap_duration) return best;
        return (!best || lap.lap_duration < best.lap_duration) ? lap : best;
    }, null);

    DOM.replayLapSelect.innerHTML = selectable.map(lap => {
        const isFastest = fastest && lap.lap_number === fastest.lap_number;
        const timeLabel = lap.lap_duration ? formatLapTime(lap.lap_duration) : 'no time';
        return `<option value="${lap.lap_number}"${isFastest ? ' selected' : ''}>` +
               `Lap ${lap.lap_number} — ${timeLabel}${isFastest ? ' ★' : ''}</option>`;
    }).join('');
}

// Session load lands on the Drivers tab; defer location fetches until the
// Circuit Details tab is actually visible.
function maybeAutoLoadReplay() {
    if (state.currentTab !== 'circuit-view') return;
    loadSelectedReplay();
}

function loadSelectedReplay() {
    if (!DOM.replayDriverSelect || !DOM.replayLapSelect || !state.selectedSession) return;
    const driverNumber = Number(DOM.replayDriverSelect.value);
    const lapNumber = Number(DOM.replayLapSelect.value);
    if (!Number.isFinite(driverNumber) || !Number.isFinite(lapNumber) || DOM.replayLapSelect.value === '') return;
    loadTrackReplay(driverNumber, lapNumber);
}

async function loadTrackReplay(driverNumber, lapNumber) {
    const sessionKey = state.selectedSession.session_key;
    const cacheKey = `${sessionKey}_${driverNumber}_${lapNumber}`;

    stopReplayPlayback();
    if (state.replay.loadedKey === cacheKey && state.replay.data) return;

    const isCurrentSelection = () => (
        Number(DOM.replayDriverSelect && DOM.replayDriverSelect.value) === Number(driverNumber) &&
        Number(DOM.replayLapSelect && DOM.replayLapSelect.value) === Number(lapNumber)
    );

    const cached = state.replayCache[cacheKey];
    if (cached) {
        buildReplayScene(cached, cacheKey);
        return;
    }

    renderReplayMessage('Loading track positions for the whole field...');
    if (DOM.replayPlayBtn) DOM.replayPlayBtn.disabled = true;
    if (DOM.replayScrubber) DOM.replayScrubber.disabled = true;

    try {
        const response = await customFetch(
            `/api/track_replay?session_key=${sessionKey}&driver_number=${driverNumber}&lap_number=${lapNumber}`
        );
        if (!isCurrentSelection()) return;
        if (!response.ok) {
            renderReplayMessage('No track position data available for this lap.');
            return;
        }
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.drivers) || payload.drivers.length === 0) {
            renderReplayMessage('No track position data recorded for this lap.');
            return;
        }
        state.replayCache[cacheKey] = payload;
        if (!isCurrentSelection()) return;
        buildReplayScene(payload, cacheKey);
    } catch (e) {
        console.error('Error loading track replay:', e);
        if (isCurrentSelection()) {
            renderReplayMessage('Failed to load track position data.');
        }
    }
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

function buildReplayScene(payload, cacheKey) {
    if (!DOM.replayMapContent) return;

    stopReplayPlayback();
    state.replay.data = payload;
    state.replay.loadedKey = cacheKey;
    state.replay.t = 0;
    state.replay.carNodes = {};

    const viewBoxSize = 1000;
    const padding = 100;

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
        renderReplayMessage('Not enough position data to draw the track.');
        return;
    }

    // Bounds cover the track and every car sample so nothing clips off-screen
    const bounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
    const extend = (x, y) => {
        if (x < bounds.xMin) bounds.xMin = x;
        if (x > bounds.xMax) bounds.xMax = x;
        if (y < bounds.yMin) bounds.yMin = y;
        if (y > bounds.yMax) bounds.yMax = y;
    };
    trackPoints.forEach(([x, y]) => extend(x, y));
    payload.drivers.forEach(driver => driver.samples.forEach(s => extend(s[1], s[2])));

    const { mapX, mapY } = buildReplayProjection(bounds, viewBoxSize, padding);

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", `0 0 ${viewBoxSize} ${viewBoxSize}`);
    svg.setAttribute("xmlns", svgNamespace);

    const trackPath = document.createElementNS(svgNamespace, "path");
    const pathD = trackPoints
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${mapX(x).toFixed(1)} ${mapY(y).toFixed(1)}`)
        .join(' ') + (closePath ? ' Z' : '');
    trackPath.setAttribute("d", pathD);
    trackPath.setAttribute("class", "replay-track-path");
    svg.appendChild(trackPath);

    // Reference driver drawn last so it stays on top
    const orderedDrivers = [...payload.drivers].sort((a, b) => (
        (a.driver_number === payload.driver_number) - (b.driver_number === payload.driver_number)
    ));

    orderedDrivers.forEach(driverSeries => {
        if (!Array.isArray(driverSeries.samples) || driverSeries.samples.length === 0) return;

        const driver = state.drivers.find(d => Number(d.driver_number) === Number(driverSeries.driver_number));
        const teamHex = getDriverTeamHex(driver);
        const acronym = (driver && driver.name_acronym) || `#${driverSeries.driver_number}`;
        const isReference = driverSeries.driver_number === payload.driver_number;

        const group = document.createElementNS(svgNamespace, "g");
        group.style.display = 'none';

        if (isReference) {
            const ring = document.createElementNS(svgNamespace, "circle");
            ring.setAttribute("r", 22);
            ring.setAttribute("class", "replay-car-highlight");
            group.appendChild(ring);
        }

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

        // Pre-project samples so per-frame interpolation stays in view space
        state.replay.carNodes[driverSeries.driver_number] = {
            group,
            samples: driverSeries.samples.map(s => [s[0], mapX(s[1]), mapY(s[2])])
        };
    });

    DOM.replayMapContent.innerHTML = '';
    DOM.replayMapContent.appendChild(svg);

    if (DOM.replayPlayBtn) DOM.replayPlayBtn.disabled = false;
    if (DOM.replayScrubber) DOM.replayScrubber.disabled = false;
    renderReplayFrame(0);
}

// Interpolated [x, y] at time t, or null when t falls outside the series or in a data gap
function interpolateReplaySample(samples, t) {
    if (samples.length === 0) return null;
    if (t < samples[0][0] || t > samples[samples.length - 1][0]) return null;

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

function renderReplayFrame(t) {
    state.replay.t = t;
    const windowSeconds = getReplayWindowSeconds();

    Object.values(state.replay.carNodes).forEach(node => {
        const pos = interpolateReplaySample(node.samples, t);
        if (!pos) {
            node.group.style.display = 'none';
            return;
        }
        node.group.style.display = '';
        node.group.setAttribute('transform', `translate(${pos[0].toFixed(1)}, ${pos[1].toFixed(1)})`);
    });

    if (DOM.replayScrubber && windowSeconds > 0) {
        const max = Number(DOM.replayScrubber.max) || 1000;
        DOM.replayScrubber.value = Math.round((t / windowSeconds) * max);
    }
    if (DOM.replayTimeLabel) {
        DOM.replayTimeLabel.textContent = `${t.toFixed(1)}s / ${windowSeconds.toFixed(1)}s`;
    }
}

function replayLoop(frameTs) {
    if (!state.replay.playing) return;

    if (state.replay.lastFrameTs === null) {
        state.replay.lastFrameTs = frameTs;
    }
    const dt = (frameTs - state.replay.lastFrameTs) / 1000;
    state.replay.lastFrameTs = frameTs;

    const windowSeconds = getReplayWindowSeconds();
    let t = state.replay.t + dt * state.replay.speed;

    if (t >= windowSeconds) {
        renderReplayFrame(windowSeconds);
        stopReplayPlayback();
        return;
    }

    renderReplayFrame(t);
    state.replay.rafId = requestAnimationFrame(replayLoop);
}

function toggleReplayPlayback() {
    if (!state.replay.data) return;

    if (state.replay.playing) {
        stopReplayPlayback();
        return;
    }

    if (state.replay.t >= getReplayWindowSeconds()) {
        state.replay.t = 0;
    }
    state.replay.playing = true;
    state.replay.lastFrameTs = null;
    setReplayPlayIcon(true);
    state.replay.rafId = requestAnimationFrame(replayLoop);
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
