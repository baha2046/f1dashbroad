// Select a session and fetch its detailed data
async function selectSession(session) {
    stopLiveMode();
    state.selectedSession = session;
    state.drivers = [];
    state.weather = [];
    state.stints = [];
    state.results = [];
    state.raceStandings = null;
    state.raceControl = [];
    state.teamRadio = [];
    stopTeamRadioPlayback();
    state.pitStops = [];
    state.position = [];
    state.positionByLap = {};
    state.intervals = [];
    state.laps = {};
    state.allSessionLaps = null;
    state.telemetryCache = {};
    resetReplay();
    state.selectedDriverStats = null;
    state.selectedCompareDrivers = [];
    state.compareView = createCompareViewState();
    state.currentMeeting = null;
    
    // If the session was cancelled, show the custom cancelled view and stop
    if (session.is_cancelled === true) {
        showCancelledSessionState(session);
        return;
    }
    
    // UI Loading state
    showDashboardLoading();

    try {
        // Fetch session details concurrently. Pit data is useful only for Race/Sprint sessions.
        const pitStopsRequest = isPitAnnotationSession(session)
            ? customFetch(`/api/pit?session_key=${session.session_key}`)
            : Promise.resolve(null);
        const lapsRequest = isPitAnnotationSession(session)
            ? customFetch(`/api/laps?session_key=${session.session_key}`)
            : Promise.resolve(null);
        const positionRequest = isPitAnnotationSession(session)
            ? customFetch(`/api/position?session_key=${session.session_key}`)
            : Promise.resolve(null);
        const raceStandingsRequest = isRaceStandingsSession(session)
            ? customFetch(`/api/race_standings?year=${encodeURIComponent(session.year || state.selectedYear)}&date=${encodeURIComponent(getSessionDateToken(session))}`)
            : Promise.resolve(null);
        // Season progression is session-independent; refetch only when the year changes
        const progressionYear = String(session.year || state.selectedYear);
        const progressionRequest = isRaceStandingsSession(session) && (!state.seasonProgression || state.seasonProgression.season !== progressionYear)
            ? customFetch(`/api/season_progression?year=${encodeURIComponent(progressionYear)}`)
            : Promise.resolve(null);
        const [driversRes, weatherRes, meetingRes, stintsRes, resultsRes, raceControlRes, teamRadioRes, pitStopsRes, lapsRes, positionRes, raceStandingsRes, progressionRes] = await Promise.all([
            customFetch(`/api/drivers?session_key=${session.session_key}`),
            customFetch(`/api/weather?session_key=${session.session_key}`),
            customFetch(`/api/meetings?meeting_key=${session.meeting_key}`),
            customFetch(`/api/stints?session_key=${session.session_key}`),
            customFetch(`/api/results?session_key=${session.session_key}`),
            customFetch(`/api/race_control?session_key=${session.session_key}`),
            customFetch(`/api/team_radio?session_key=${session.session_key}`),
            pitStopsRequest,
            lapsRequest,
            positionRequest,
            raceStandingsRequest,
            progressionRequest
        ]);

        if (!driversRes.ok) throw new Error('Failed to load drivers');
        
        state.drivers = await driversRes.json();
        
        if (weatherRes.ok) {
            state.weather = await weatherRes.json();
        }

        if (meetingRes.ok) {
            state.currentMeeting = await meetingRes.json();
        }

        if (stintsRes.ok) {
            state.stints = await stintsRes.json();
        }

        if (resultsRes.ok) {
            state.results = await resultsRes.json();
        }

        if (raceControlRes.ok) {
            state.raceControl = await raceControlRes.json();
        }

        if (teamRadioRes.ok) {
            const teamRadio = await teamRadioRes.json();
            state.teamRadio = Array.isArray(teamRadio) ? teamRadio : [];
        }

        if (pitStopsRes && pitStopsRes.ok) {
            const pitStops = await pitStopsRes.json();
            state.pitStops = Array.isArray(pitStops)
                ? pitStops.sort((a, b) => (
                    Number(a.driver_number || 0) - Number(b.driver_number || 0) ||
                    Number(a.lap_number || 0) - Number(b.lap_number || 0)
                ))
                : [];
        }

        if (lapsRes && lapsRes.ok) {
            const allLaps = await lapsRes.json();
            state.allSessionLaps = allLaps;
            
            // Group by driver_number and store in state.laps
            const groupedLaps = {};
            if (Array.isArray(allLaps)) {
                allLaps.forEach(lap => {
                    const dn = Number(lap.driver_number);
                    if (Number.isNaN(dn)) return;
                    if (!groupedLaps[dn]) {
                        groupedLaps[dn] = [];
                    }
                    groupedLaps[dn].push(lap);
                });
                
                for (const dn in groupedLaps) {
                    groupedLaps[dn].sort((a, b) => Number(a.lap_number) - Number(b.lap_number));
                    state.laps[dn] = groupedLaps[dn];
                }
            }
        }

        if (positionRes && positionRes.ok) {
            const position = await positionRes.json();
            state.position = Array.isArray(position) ? position : [];
            state.positionByLap = buildPositionByLapMap();
        }

        if (raceStandingsRes && raceStandingsRes.ok) {
            state.raceStandings = await raceStandingsRes.json();
        }

        if (progressionRes && progressionRes.ok) {
            state.seasonProgression = await progressionRes.json();
        }

        // Render dashboard components
        renderSessionHeader();
        renderWeather();
        renderDriversGrid();
        renderLapsDriverSidebar();
        renderCompareDriverSelector();
        renderCompareLapChart();
        renderCircuitTab();
        setupReplaySection();
        renderResultsTab();
        renderRaceStandingsTables();
        renderChampionshipProgressionChart();
        renderRaceControlFeed();
        setupLiveMode();

        // Hide empty state and show dashboard content
        DOM.emptyState.style.display = 'none';
        DOM.dashboardContent.style.display = 'flex';

        // On narrow screens the sidebar stacks above the dashboard, so bring the content into view
        if (window.matchMedia('(max-width: 900px)').matches) {
            DOM.dashboardContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Auto-select first driver for lap stats view if available
        if (state.drivers && state.drivers.length > 0) {
            const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
            if (sortedDrivers.length > 0) {
                selectDriverForStats(sortedDrivers[0].driver_number);
            }
        }
    } catch (error) {
        console.error(error);
        const banner = document.getElementById('liveRestrictionBanner');
        if (!banner || banner.style.display !== 'flex') {
            alert('Error loading session details.');
        }
        hideDashboard();
    }
}


// Show detail view for a cancelled session
function showCancelledSessionState(session) {
    DOM.emptyState.style.display = 'flex';
    DOM.emptyState.innerHTML = `
        <span class="material-icons-round empty-icon" style="color: var(--accent-red); opacity: 0.85; text-shadow: 0 0 15px rgba(255, 24, 1, 0.4);">cancel</span>
        <h2 style="color: var(--text-primary); margin-top: 16px;">${session.circuit_short_name} Grand Prix Cancelled</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px; max-width: 440px; line-height: 1.6;">
            The <strong>${session.session_name}</strong> session for the ${session.year} ${session.location} Grand Prix was officially cancelled. 
            No driver telemetry, tire stint details, or weather metrics were recorded for this event.
        </p>
        <div style="background: rgba(255, 24, 1, 0.05); border: 1px solid rgba(255, 24, 1, 0.15); padding: 12px 24px; border-radius: 12px; color: var(--text-secondary); font-size: 13px; max-width: 400px; text-align: center; display: flex; align-items: center; gap: 8px;">
            <span class="material-icons-round" style="font-size: 18px; color: var(--accent-red);">info</span>
            <span>Status: Officially Cancelled (is_cancelled: true)</span>
        </div>
    `;
    DOM.dashboardContent.style.display = 'none';
}

// Fetch stunts for selected session
async function fetchStints(sessionKey) {
    try {
        const response = await customFetch(`/api/stints?session_key=${sessionKey}`);
        if (response.ok) {
            state.stints = await response.json();
        }
    } catch (e) {
        console.error('Error fetching stints:', e);
    }
}

// Fetch laps for a specific driver
async function fetchDriverLaps(sessionKey, driverNumber) {
    if (state.laps[driverNumber]) return state.laps[driverNumber];
    
    try {
        const response = await customFetch(`/api/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
        if (response.ok) {
            const laps = await response.json();
            // Sort laps chronologically
            laps.sort((a, b) => a.lap_number - b.lap_number);
            state.laps[driverNumber] = laps;
            return laps;
        }
    } catch (e) {
        console.error(`Error fetching laps for driver ${driverNumber}:`, e);
    }
    return null;
}

// Fetch every driver's laps for the session (memoized on state.allSessionLaps;
// selectSession already fills it for Race/Sprint sessions)
async function fetchAllSessionLaps(sessionKey) {
    if (Array.isArray(state.allSessionLaps)) return state.allSessionLaps;

    try {
        const response = await customFetch(`/api/laps?session_key=${sessionKey}`);
        if (response.ok) {
            const laps = await response.json();
            if (Array.isArray(laps)) {
                state.allSessionLaps = laps;
                return laps;
            }
        }
    } catch (e) {
        console.error('Error fetching session laps:', e);
    }
    return null;
}

function isPitAnnotationSession(session) {
    if (!session) return false;
    const allowedTypes = new Set(['race', 'sprint']);
    return [session.session_type, session.session_name].some(value => (
        allowedTypes.has(String(value || '').trim().toLowerCase())
    ));
}

function isRaceStandingsSession(session) {
    if (!session) return false;
    return String(session.session_name || '').trim().toLowerCase() === 'race';
}

function getSessionDateToken(session) {
    const rawDate = String(session && session.date_start ? session.date_start : '');
    if (!rawDate) return '';
    const parsedDate = new Date(rawDate);
    if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString().slice(0, 10);
    }
    return rawDate.slice(0, 10);
}

function isQualifyingSession(session) {
    if (!session) return false;
    return [session.session_type, session.session_name].some(value => {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized.includes('qualifying') || normalized.includes('quali');
    });
}

function getLapChartTime(lap) {
    if (!lap || !lap.date_start) return null;
    const start = new Date(lap.date_start).getTime();
    if (!Number.isFinite(start)) return null;

    const duration = Number(lap.lap_duration);
    return Number.isFinite(duration) && duration > 0
        ? start + duration * 1000
        : start;
}

function extractQualifyingPhasePeriods(records) {
    if (!Array.isArray(records)) return [];

    const activeStarts = new Map();
    const periods = [];
    const sorted = records
        .map(record => {
            const phase = Number(record && record.qualifying_phase);
            const timestamp = new Date(record && record.date).getTime();
            return {
                record,
                phase,
                timestamp,
                message: String((record && record.message) || '').toUpperCase()
            };
        })
        .filter(item => (
            item.record &&
            item.record.category === 'SessionStatus' &&
            Number.isInteger(item.phase) &&
            item.phase >= 1 &&
            item.phase <= 3 &&
            Number.isFinite(item.timestamp)
        ))
        .sort((a, b) => a.timestamp - b.timestamp);

    sorted.forEach(item => {
        if (item.message.includes('SESSION STARTED')) {
            activeStarts.set(item.phase, item.timestamp);
            return;
        }

        if (!item.message.includes('SESSION FINISHED')) return;

        const startTime = activeStarts.get(item.phase);
        if (!Number.isFinite(startTime) || item.timestamp <= startTime) return;

        const phase = item.phase;
        periods.push({
            phase,
            label: `Q${phase}`,
            startTime,
            endTime: item.timestamp
        });
        activeStarts.delete(item.phase);
    });

    return periods.sort((a, b) => a.startTime - b.startTime);
}

function buildQualifyingPhaseAxis(laps, records, session) {
    if (!isQualifyingSession(session)) return null;

    const phases = extractQualifyingPhasePeriods(records);
    if (phases.length === 0) return null;

    const lapTimes = (Array.isArray(laps) ? laps : [])
        .map(getLapChartTime)
        .filter(Number.isFinite);
    if (lapTimes.length === 0) return null;

    const firstPhaseStart = Math.min(...phases.map(phase => phase.startTime));
    const lastPhaseEnd = Math.max(...phases.map(phase => phase.endTime));
    const min = Math.min(firstPhaseStart, ...lapTimes);
    const max = Math.max(lastPhaseEnd, ...lapTimes);

    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

    return {
        kind: 'qualifying',
        min,
        max,
        phases
    };
}

function getLapXValue(lap, qualifyingAxis = null) {
    return qualifyingAxis ? getLapChartTime(lap) : Number(lap && lap.lap_number);
}

function chartValueWithinWindow(value, minValue, maxValue) {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized >= minValue && normalized <= maxValue;
}

function getQualifyingPhaseForValue(axis, value) {
    if (!axis || !Array.isArray(axis.phases)) return null;
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return null;
    return axis.phases.find(phase => normalized >= phase.startTime && normalized <= phase.endTime) || null;
}

function getQualifyingPhaseLabelForValue(axis, value) {
    const phase = getQualifyingPhaseForValue(axis, value);
    return phase ? phase.label : '';
}

function getQualifyingLapLabel(lap, axis) {
    const lapNumber = Number(lap && lap.lap_number);
    const lapText = Number.isFinite(lapNumber) ? `Lap ${lapNumber}` : 'Lap';
    const phaseLabel = getQualifyingPhaseLabelForValue(axis, getLapChartTime(lap));
    return phaseLabel ? `${phaseLabel} - ${lapText}` : lapText;
}

function findNearestLapByAxisValue(laps, axisValue) {
    const target = Number(axisValue);
    if (!Number.isFinite(target) || !Array.isArray(laps) || laps.length === 0) return null;

    let nearest = null;
    let nearestDistance = Infinity;
    laps.forEach(lap => {
        const value = getLapChartTime(lap);
        if (!Number.isFinite(value)) return;
        const distance = Math.abs(value - target);
        if (distance < nearestDistance) {
            nearest = lap;
            nearestDistance = distance;
        }
    });

    return nearest;
}

function formatPitStopDuration(pitStop) {
    const duration = Number(pitStop && pitStop.pit_duration);
    return Number.isFinite(duration) ? `${duration.toFixed(3)}s` : null;
}

function getLapPitAnnotation(driverNumber, lapNumber) {
    const emptyAnnotation = {
        isPitIn: false,
        isPitOut: false,
        pitIn: [],
        pitOut: []
    };
    const targetDriver = Number(driverNumber);
    const targetLap = Number(lapNumber);

    if (
        !isPitAnnotationSession(state.selectedSession) ||
        !Array.isArray(state.pitStops) ||
        !Number.isFinite(targetDriver) ||
        !Number.isFinite(targetLap)
    ) {
        return emptyAnnotation;
    }

    const pitIn = [];
    const pitOut = [];
    state.pitStops.forEach(pitStop => {
        const pitDriver = Number(pitStop && pitStop.driver_number);
        const pitLap = Number(pitStop && pitStop.lap_number);
        if (!Number.isFinite(pitDriver) || !Number.isFinite(pitLap) || pitDriver !== targetDriver) {
            return;
        }

        if (pitLap === targetLap) {
            pitIn.push(pitStop);
        }
        if (pitLap + 1 === targetLap) {
            pitOut.push(pitStop);
        }
    });

    return {
        isPitIn: pitIn.length > 0,
        isPitOut: pitOut.length > 0,
        pitIn,
        pitOut
    };
}

function buildPitBadgeTitle(type, pitStops) {
    const primaryStop = pitStops[0] || {};
    const pitLap = Number(primaryStop.lap_number);
    const duration = formatPitStopDuration(primaryStop);
    const lapText = Number.isFinite(pitLap) ? `Lap ${pitLap}` : 'pit stop';
    const durationText = duration ? ` (${duration})` : '';

    if (type === 'in') {
        return `Pit in on ${lapText}${durationText}`;
    }
    return `Pit out after ${lapText}${durationText}`;
}

function renderPitLapBadges(annotation) {
    if (!annotation || (!annotation.isPitIn && !annotation.isPitOut)) {
        return '<span class="pit-lap-empty">--</span>';
    }

    const badges = [];
    if (annotation.isPitIn) {
        badges.push(`<span class="pit-lap-badge pit-in" title="${escapeHtml(buildPitBadgeTitle('in', annotation.pitIn))}">Pit in</span>`);
    }
    if (annotation.isPitOut) {
        badges.push(`<span class="pit-lap-badge pit-out" title="${escapeHtml(buildPitBadgeTitle('out', annotation.pitOut))}">Pit out</span>`);
    }
    return badges.join('');
}

function renderPitTooltipRows(annotation) {
    if (!annotation || (!annotation.isPitIn && !annotation.isPitOut)) return '';

    const rows = [];
    if (annotation.isPitIn) {
        const duration = formatPitStopDuration(annotation.pitIn[0]);
        rows.push(`<div class="chart-tooltip-pit pit-in">Pit in${duration ? ` (${duration})` : ''}</div>`);
    }
    if (annotation.isPitOut) {
        const duration = formatPitStopDuration(annotation.pitOut[0]);
        rows.push(`<div class="chart-tooltip-pit pit-out">Pit out${duration ? ` (${duration})` : ''}</div>`);
    }
    return rows.join('');
}

function getDriverPitLapMarkers(driverNumber, minLap, maxLap) {
    const targetDriver = Number(driverNumber);
    if (
        !isPitAnnotationSession(state.selectedSession) ||
        !Array.isArray(state.pitStops) ||
        !Number.isFinite(targetDriver)
    ) {
        return [];
    }

    return state.pitStops
        .filter(pitStop => Number(pitStop && pitStop.driver_number) === targetDriver)
        .map(pitStop => {
            const pitInLap = Number(pitStop && pitStop.lap_number);
            if (!Number.isFinite(pitInLap)) return null;
            return {
                pitStop,
                pitInLap,
                pitOutLap: pitInLap + 1
            };
        })
        .filter(Boolean)
        .filter(marker => marker.pitInLap <= maxLap && marker.pitOutLap >= minLap);
}

function renderPitLapMarkers(svg, markers, getX, minLap, maxLap, padding, chartHeight, svgNamespace) {
    markers.forEach(marker => {
        [
            { lap: marker.pitInLap, type: 'in', label: 'PIT IN' },
            { lap: marker.pitOutLap, type: 'out', label: 'PIT OUT' }
        ].forEach(event => {
            if (event.lap < minLap || event.lap > maxLap) return;

            const x = getX(event.lap);
            const isPitIn = event.type === 'in';
            const guide = document.createElementNS(svgNamespace, "line");
            guide.setAttribute("x1", x);
            guide.setAttribute("y1", padding.top);
            guide.setAttribute("x2", x);
            guide.setAttribute("y2", padding.top + chartHeight);
            guide.setAttribute("class", isPitIn ? "chart-pit-in-guide" : "chart-pit-out-guide");

            const title = document.createElementNS(svgNamespace, "title");
            title.textContent = buildPitBadgeTitle(event.type, [marker.pitStop]);
            guide.appendChild(title);
            svg.appendChild(guide);

            const text = document.createElementNS(svgNamespace, "text");
            text.setAttribute("x", x + 4);
            text.setAttribute("y", padding.top + (isPitIn ? 13 : 27));
            text.setAttribute("class", isPitIn ? "chart-pit-in-label" : "chart-pit-out-label");
            text.textContent = event.label;
            svg.appendChild(text);
        });
    });
}

