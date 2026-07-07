// F1 Dashboard Frontend Application State
const state = {
    selectedYear: '2026',
    sessions: [],
    filteredSessions: [],
    selectedSession: null,
    drivers: [],
    weather: [],
    stints: [],
    results: [],
    raceStandings: null,
    seasonProgression: null,
    progressionView: 'drivers',
    raceControl: [],
    sessionStatusSeries: [], // /api/session_status rows (SessionData StatusSeries)
    teamRadio: [],
    pitStops: [],
    position: [],
    positionByLap: {},
    intervals: [],
    live: createLiveState(),
    laps: {}, // map of driverNumber -> laps array
    allSessionLaps: null,
    telemetryCache: {}, // map of `${sessionKey}_${driverNumber}_${lapNumber}` -> /api/car_telemetry payload
    replayCache: {}, // map of `${sessionKey}_${driverNumber}_${lapNumber}` -> /api/track_replay payload
    replay: createReplayState(),
    selectedDriverStats: null,
    selectedCompareDrivers: [],
    compareView: createCompareViewState(),
    currentMeeting: null,
    currentTab: 'drivers-view'
};

function createCompareViewState() {
    return {
        visibleCharts: new Set(['lapTimes', 'gap']),
        headToHeadRef: null,
        lapWindow: { min: null, max: null },
        mutedDrivers: new Set(),
        highlightedDriver: null,
        hoverLap: null,
        zoomDrag: null
    };
}

function createReplayState() {
    return {
        data: null,        // loaded /api/track_replay payload
        loadedKey: null,   // cache key of the loaded payload
        driverNumber: null, // selected reference driver, or REPLAY_FULL_RACE / REPLAY_FULL_SESSION (source of truth for loads)
        lapNumber: null,   // selected timeline lap (source of truth for loads)
        timeline: null,    // { segments, displayTotal } built from the reference driver's laps
        playing: false,
        t: 0,              // current replay time in seconds within the loaded lap window
        speed: 1,
        rafId: null,
        lastFrameTs: null,
        carNodes: {},      // driver_number -> { group, samples } for the built SVG
        lastContextTickMs: 0,
        lastContextAbsMs: null, // playhead position at the previous context tick (row-flash jump guard)
        contextRows: {},
        telemetrySamples: null, // reference driver's car_data samples for the loaded lap window
        telemetryKey: null,     // replay cache key the telemetry samples belong to
        lastTelemetryTickMs: 0,
        positionIndex: null,
        intervalIndex: null,
        stintIndex: null,
        pitWindows: null,
        teamRadioIndex: null,   // driver_number -> date-sorted team radio records
        lastTeamRadioTickMs: 0,
        highlightedDriverNumber: null,
        intervalsSessionKey: null,
        intervalsLoading: null
    };
}

function createLiveState() {
    return {
        active: false,
        sessionKey: null,
        liveStartTimerId: null,
        refreshTimerId: null,
        countdownTimerId: null,
        nextRefreshAt: null,
        refreshing: false,
        lastUpdated: null
    };
}

// Mappers for country codes to emojis
const COUNTRY_FLAGS = {
    'AUS': '🇦🇺', 'AUT': '🇦🇹', 'AZE': '🇦🇿', 'BEL': '🇧🇪', 'BRA': '🇧🇷', 'BRN': '🇧🇭',
    'CAN': '🇨🇦', 'CHN': '🇨🇳', 'ESP': '🇪🇸', 'GBR': '🇬🇧', 'HUN': '🇭🇺', 'ITA': '🇮🇹',
    'JPN': '🇯🇵', 'MEX': '🇲🇽', 'MON': '🇲🇨', 'NED': '🇳🇱', 'QAT': '🇶🇦', 'SAU': '🇸🇦',
    'SGP': '🇸🇬', 'USA': '🇺🇸', 'UAE': '🇦🇪', 'MCO': '🇲🇨', 'SMR': '🇸🇲'
};

// Fallback matching for team colors if not provided by API
const TEAM_COLORS = {
    'red bull': '3671C6', 'red bull racing': '3671C6',
    'ferrari': 'F82D1E',
    'mercedes': '27F4D2',
    'mclaren': 'FF8000',
    'aston martin': '229971',
    'alpine': '0093CC',
    'williams': '64C4FF',
    'haas': 'B6BABD', 'haas f1 team': 'B6BABD',
    'racing bulls': '6692FF', 'rb': '6692FF',
    'audi': 'F50537', 'kick sauber': '52E252', 'sauber': '52E252',
    'cadillac': '909090'
};

// Helper: Convert hex to rgb string for CSS custom properties
function getRGBColor(hex) {
    if (!hex) return '120, 120, 120';
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `${r}, ${g}, ${b}`;
}

function getDriverTeamHex(driver, fallback = '787878') {
    if (!driver) return fallback;
    return (driver.team_colour || TEAM_COLORS[(driver.team_name || '').toLowerCase()] || fallback).replace('#', '');
}

function calculateAgeAtDate(birthdayStr, targetDateStr) {
    if (!birthdayStr) return null;
    try {
        let birthDate;
        birthdayStr = birthdayStr.trim();
        if (birthdayStr.includes('/')) {
            const parts = birthdayStr.split('/');
            if (parts.length === 3) {
                if (parts[0].length === 4) {
                    birthDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                } else {
                    birthDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
                }
            }
        } else {
            birthDate = new Date(birthdayStr);
        }

        if (isNaN(birthDate.getTime())) return null;

        const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
        if (isNaN(targetDate.getTime())) return null;

        let age = targetDate.getFullYear() - birthDate.getFullYear();
        const m = targetDate.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && targetDate.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    } catch (e) {
        console.error('Error calculating age:', e);
        return null;
    }
}

// Helper: Format lap times (e.g., 90.5 -> 1:30.500)
function formatLapTime(seconds) {
    if (!seconds || isNaN(seconds)) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3);
    if (mins > 0) {
        return `${mins}:${secs.padStart(6, '0')}`;
    }
    return `${secs}s`;
}

// Helper: Format race/session total duration (e.g., 4986.801 -> 1:23:06.801)
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = (seconds % 60).toFixed(3);
    if (hours > 0) {
        return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(6, '0')}`;
    }
    if (mins > 0) {
        return `${mins}:${String(secs).padStart(6, '0')}`;
    }
    return `${secs}s`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function formatRaceControlTime(dateValue) {
    if (!dateValue) return '--';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}
