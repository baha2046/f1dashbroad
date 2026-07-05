// ===== Session Replay (location data on the circuit map) =====
// Lap-window replay on a session timeline: the reference driver's laps define
// per-lap time windows, the whole field's positions animate over them, and
// playback auto-advances across laps (see
// doc/2026-07-05-session-replay-tab-design.md and the original single-lap
// design in doc/2026-07-04-track-replay-design.md).

// Hide a car when the gap between its bracketing samples exceeds this (garage/retirement)
const REPLAY_SAMPLE_GAP_SECONDS = 4;
// Start prefetching the next lap's payload this many seconds before the window ends
const REPLAY_PREFETCH_LEAD_SECONDS = 15;
// Cap a timeline segment's rendered width at this multiple of the median lap
// window so out-laps / red-flag gaps don't dwarf flying laps
const REPLAY_TIMELINE_WIDTH_CAP = 3;

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
    }
    if (DOM.replayTimeLabel) {
        DOM.replayTimeLabel.textContent = '0.0s / 0.0s';
    }
    if (DOM.replayTimeline) {
        DOM.replayTimeline.innerHTML = '';
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
        if (DOM.replayTimeline) DOM.replayTimeline.innerHTML = '';
        renderReplayMessage('No drivers available for this session.');
        return;
    }

    const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    DOM.replayDriverSelect.innerHTML = sortedDrivers.map(d => {
        const label = d.full_name || d.broadcast_name || `Driver ${d.driver_number}`;
        return `<option value="${d.driver_number}">${escapeHtml(label)} (#${d.driver_number})</option>`;
    }).join('');

    renderReplayMessage('Replay loads when the Session Replay tab is open.');
    setupReplayTimeline().then(() => maybeAutoLoadReplay());
}

// Build the session timeline from the reference driver's laps; the fastest
// lap is preselected as the starting point.
async function setupReplayTimeline() {
    if (!DOM.replayTimeline || !DOM.replayDriverSelect || !state.selectedSession) return;

    const driverNumber = Number(DOM.replayDriverSelect.value);
    if (!Number.isFinite(driverNumber)) return;

    state.replay.driverNumber = driverNumber;
    state.replay.lapNumber = null;
    state.replay.timeline = null;
    DOM.replayTimeline.innerHTML = '<span class="replay-timeline-loading">Loading laps...</span>';

    const laps = await fetchDriverLaps(state.selectedSession.session_key, driverNumber);

    // The user may have changed driver while laps were loading
    if (state.replay.driverNumber !== driverNumber) return;

    const timeline = buildReplayTimeline(laps);
    if (!timeline) {
        DOM.replayTimeline.innerHTML = '';
        renderReplayMessage('No laps with timing data recorded for this driver.');
        return;
    }

    state.replay.timeline = timeline;
    const fastest = timeline.segments.find(seg => seg.isFastest) || timeline.segments[0];
    state.replay.lapNumber = fastest.lapNumber;
    renderReplayTimeline();
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
            seconds,
            hasTime,
            isFastest: false
        });
    });

    if (segments.length === 0) return null;

    let fastest = null;
    segments.forEach(seg => {
        if (seg.hasTime && (!fastest || seg.seconds < fastest.seconds)) fastest = seg;
    });
    if (fastest) fastest.isFastest = true;

    // Display widths are capped so seeking stays precise on flying laps; the
    // click-to-seek mapping uses each segment's real seconds, not its width.
    const sortedSeconds = segments.map(seg => seg.seconds).sort((a, b) => a - b);
    const median = sortedSeconds[Math.floor(sortedSeconds.length / 2)];
    const widthCap = median * REPLAY_TIMELINE_WIDTH_CAP;

    let displayTotal = 0;
    segments.forEach(seg => {
        seg.displayUnits = Math.min(seg.seconds, widthCap);
        seg.displayStart = displayTotal;
        displayTotal += seg.displayUnits;
    });

    return { segments, displayTotal };
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

    DOM.replayTimeline.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'replay-timeline-track';

    timeline.segments.forEach((seg, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'replay-timeline-segment';
        if (seg.isFastest) btn.classList.add('fastest');
        if (seg.lapNumber === state.replay.lapNumber) btn.classList.add('active');
        btn.dataset.lap = seg.lapNumber;
        btn.style.flexGrow = String(seg.displayUnits);
        const timeText = seg.hasTime ? ` — ${formatLapTime(seg.seconds)}` : '';
        btn.title = `Lap ${seg.lapNumber}${timeText}${seg.isFastest ? ' ★' : ''}`;
        btn.setAttribute('aria-label', btn.title);

        if (index % labelStep === 0 || seg.isFastest) {
            const label = document.createElement('span');
            label.className = 'replay-timeline-label';
            label.textContent = seg.lapNumber;
            btn.appendChild(label);
        }
        track.appendChild(btn);
    });

    const playhead = document.createElement('div');
    playhead.className = 'replay-timeline-playhead';
    track.appendChild(playhead);

    DOM.replayTimeline.appendChild(track);
    updateReplayTimelinePlayhead();
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
    loadSelectedReplay();
}

function loadSelectedReplay() {
    if (!state.selectedSession) return;
    const { driverNumber, lapNumber } = state.replay;
    if (!Number.isFinite(driverNumber) || !Number.isFinite(lapNumber)) return;
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
                const response = await customFetch(
                    `/api/track_replay?session_key=${sessionKey}&driver_number=${driverNumber}&lap_number=${lapNumber}`
                );
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
    state.replay.driverNumber = Number(driverNumber);
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
        state.replay.driverNumber === Number(driverNumber) &&
        state.replay.lapNumber === Number(lapNumber)
    );

    const cached = state.replayCache[cacheKey];
    if (cached) {
        buildReplayScene(cached, cacheKey, options);
        return;
    }

    renderReplayMessage('Loading track positions for the whole field...');
    if (DOM.replayPlayBtn) DOM.replayPlayBtn.disabled = true;
    if (DOM.replayScrubber) DOM.replayScrubber.disabled = true;

    try {
        const payload = await fetchReplayPayload(sessionKey, driverNumber, lapNumber);
        if (!isCurrentSelection()) return;
        if (!payload) {
            renderReplayMessage('No track position data available for this lap.');
            return;
        }
        buildReplayScene(payload, cacheKey, options);
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

function buildReplayScene(payload, cacheKey, options = {}) {
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
    updateReplayTimelineActive();

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
        const lapPrefix = Number.isFinite(state.replay.lapNumber) ? `Lap ${state.replay.lapNumber} · ` : '';
        DOM.replayTimeLabel.textContent = `${lapPrefix}${t.toFixed(1)}s / ${windowSeconds.toFixed(1)}s`;
    }
    updateReplayTimelinePlayhead();
}

// Warm the cache for the next timeline lap so the lap handoff is seamless
function prefetchNextReplayLap() {
    if (!state.selectedSession) return;
    const next = getNextTimelineSegment(state.replay.lapNumber);
    if (!next) return;

    fetchReplayPayload(state.selectedSession.session_key, state.replay.driverNumber, next.lapNumber)
        .catch(e => console.error('Error prefetching replay lap:', e));
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
