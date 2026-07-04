// Live Mode: while the selected session is live, poll position/intervals/
// race-control, show a pulsing LIVE indicator with a refresh countdown, and
// render a live timing table (current order + gaps) on the Drivers tab.
const LIVE_REFRESH_SECONDS = 30;

// Mirrors the backend is_session_live rule; the 30-minute buffer covers
// sessions (especially races) that overrun their scheduled date_end.
function isLiveSessionNow(session, now = new Date()) {
    if (!session || session.is_cancelled === true) return false;
    const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const start = new Date(session.date_start).getTime();
    const end = new Date(session.date_end).getTime();
    if (!Number.isFinite(nowTime) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
    return nowTime >= start && nowTime <= end + 30 * 60 * 1000;
}

// Reduce the position/interval event streams to the latest record per driver
// and return rows sorted by current position.
function buildLiveTimingRows(positions, intervals) {
    const latestByDriver = (records) => {
        const map = new Map();
        (Array.isArray(records) ? records : []).forEach(record => {
            const driverNumber = Number(record && record.driver_number);
            if (!Number.isFinite(driverNumber)) return;
            const existing = map.get(driverNumber);
            if (!existing || String(record.date || '') >= String(existing.date || '')) {
                map.set(driverNumber, record);
            }
        });
        return map;
    };

    const latestPositions = latestByDriver(positions);
    const latestIntervals = latestByDriver(intervals);

    return Array.from(latestPositions.entries())
        .map(([driverNumber, record]) => {
            const interval = latestIntervals.get(driverNumber) || {};
            return {
                driver_number: driverNumber,
                position: Number(record.position),
                interval: interval.interval !== undefined ? interval.interval : null,
                gap_to_leader: interval.gap_to_leader !== undefined ? interval.gap_to_leader : null
            };
        })
        .filter(row => Number.isFinite(row.position))
        .sort((a, b) => a.position - b.position);
}

// Gaps arrive as seconds (1.234) or strings ("+1 LAP"); null means leader/unknown.
function formatLiveGap(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `+${value.toFixed(3)}s`;
    }
    return String(value);
}

function setupLiveMode() {
    stopLiveMode();
    const session = state.selectedSession;
    if (!session || !isLiveSessionNow(session)) return;

    state.live.active = true;
    state.live.sessionKey = session.session_key;
    if (DOM.liveIndicator) DOM.liveIndicator.classList.add('active');

    renderLiveTiming();
    refreshLiveData();
    state.live.refreshTimerId = setInterval(refreshLiveData, LIVE_REFRESH_SECONDS * 1000);
    state.live.countdownTimerId = setInterval(updateLiveCountdown, 1000);
}

function stopLiveMode() {
    if (state.live.refreshTimerId) clearInterval(state.live.refreshTimerId);
    if (state.live.countdownTimerId) clearInterval(state.live.countdownTimerId);
    state.live = createLiveState();
    if (DOM.liveIndicator) DOM.liveIndicator.classList.remove('active');
    if (DOM.liveCountdown) DOM.liveCountdown.textContent = '';
    if (DOM.liveTimingCard) DOM.liveTimingCard.style.display = 'none';
}

async function refreshLiveData() {
    if (!state.live.active || state.live.refreshing) return;
    const session = state.selectedSession;
    if (!session || session.session_key !== state.live.sessionKey) {
        stopLiveMode();
        return;
    }

    state.live.refreshing = true;
    state.live.nextRefreshAt = Date.now() + LIVE_REFRESH_SECONDS * 1000;
    updateLiveCountdown();

    const sessionKey = session.session_key;
    try {
        const [positionRes, intervalsRes, raceControlRes] = await Promise.all([
            customFetch(`/api/position?session_key=${sessionKey}`),
            customFetch(`/api/intervals?session_key=${sessionKey}`),
            customFetch(`/api/race_control?session_key=${sessionKey}`)
        ]);

        // Discard stale responses if the user switched sessions mid-flight
        if (!state.live.active || !state.selectedSession || state.selectedSession.session_key !== sessionKey) {
            return;
        }

        if (positionRes.ok) {
            const position = await positionRes.json();
            state.position = Array.isArray(position) ? position : [];
            state.positionByLap = buildPositionByLapMap();
        }
        if (intervalsRes.ok) {
            const intervals = await intervalsRes.json();
            state.intervals = Array.isArray(intervals) ? intervals : [];
        }
        if (raceControlRes.ok) {
            const raceControl = await raceControlRes.json();
            state.raceControl = Array.isArray(raceControl) ? raceControl : [];
            renderRaceControlFeed();
        }

        state.live.lastUpdated = new Date();
        renderLiveTiming();
        renderSessionHeader(); // refresh the Live/Past status badge
    } catch (error) {
        console.error('Live data refresh failed:', error);
    } finally {
        state.live.refreshing = false;
        updateLiveCountdown();
    }

    // Session over: stop polling but keep the final data on screen
    if (state.live.active && !isLiveSessionNow(state.selectedSession)) {
        stopLiveMode();
    }
}

function updateLiveCountdown() {
    if (!DOM.liveCountdown) return;
    if (!state.live.active) {
        DOM.liveCountdown.textContent = '';
        return;
    }
    if (state.live.refreshing) {
        DOM.liveCountdown.textContent = 'updating…';
        return;
    }
    const remaining = Math.max(0, Math.ceil(((state.live.nextRefreshAt || 0) - Date.now()) / 1000));
    DOM.liveCountdown.textContent = `next update in ${remaining}s`;
}

function renderLiveTiming() {
    if (!DOM.liveTimingCard || !DOM.liveTimingTableBody) return;

    const rows = state.live.active ? buildLiveTimingRows(state.position, state.intervals) : [];
    if (rows.length === 0) {
        DOM.liveTimingCard.style.display = 'none';
        DOM.liveTimingTableBody.innerHTML = '';
        return;
    }

    DOM.liveTimingCard.style.display = 'block';
    if (DOM.liveTimingUpdated) {
        DOM.liveTimingUpdated.textContent = state.live.lastUpdated
            ? `Updated ${state.live.lastUpdated.toLocaleTimeString()}`
            : '';
    }

    DOM.liveTimingTableBody.innerHTML = rows.map((row, index) => {
        const driver = state.drivers.find(d => Number(d.driver_number) === row.driver_number);
        const teamHex = getDriverTeamHex(driver);
        const name = driver
            ? `${driver.first_name || ''} ${driver.last_name || driver.broadcast_name || ''}`.trim()
            : `Car ${row.driver_number}`;
        const team = driver && driver.team_name ? driver.team_name : '';
        const isLeader = index === 0;
        return `
            <tr class="${isLeader ? 'live-timing-leader' : ''}">
                <td class="live-timing-pos">${row.position}</td>
                <td>
                    <div class="live-timing-driver-cell">
                        <span class="live-timing-team-bar" style="background: #${teamHex};"></span>
                        <span class="live-timing-driver-name">${escapeHtml(name)}</span>
                        ${team ? `<span class="live-timing-driver-team">${escapeHtml(team)}</span>` : ''}
                    </div>
                </td>
                <td class="live-timing-gap">${escapeHtml(isLeader ? 'Leader' : formatLiveGap(row.interval))}</td>
                <td class="live-timing-gap">${escapeHtml(isLeader ? '—' : formatLiveGap(row.gap_to_leader))}</td>
            </tr>
        `;
    }).join('');
}
