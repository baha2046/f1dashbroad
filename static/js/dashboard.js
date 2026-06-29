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
    raceControl: [],
    laps: {}, // map of driverNumber -> laps array
    selectedDriverStats: null,
    selectedCompareDrivers: [],
    currentMeeting: null,
    currentTab: 'drivers-view'
};

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

// DOM Selectors
const DOM = {
    yearSelector: document.getElementById('yearSelector'),
    sessionSearch: document.getElementById('sessionSearch'),
    typeFilters: document.getElementById('typeFilters'),
    showCancelled: document.getElementById('showCancelled'),
    sessionsList: document.getElementById('sessionsList'),
    emptyState: document.getElementById('emptyState'),
    dashboardContent: document.getElementById('dashboardContent'),
    
    // Header
    headerFlag: document.getElementById('headerFlag'),
    headerYear: document.getElementById('headerYear'),
    headerLocation: document.getElementById('headerLocation'),
    headerGPName: document.getElementById('headerGPName'),
    headerSessionType: document.getElementById('headerSessionType'),
    
    // Weather
    weatherAirTemp: document.getElementById('weatherAirTemp'),
    weatherTrackTemp: document.getElementById('weatherTrackTemp'),
    weatherHumidity: document.getElementById('weatherHumidity'),
    weatherWind: document.getElementById('weatherWind'),
    weatherRainfall: document.getElementById('weatherRainfall'),
    
    // Drivers Grid
    driverSearch: document.getElementById('driverSearch'),
    driversGrid: document.getElementById('driversGrid'),
    
    // Laps/Stints Section
    lapsDriverList: document.getElementById('lapsDriverList'),
    lapsContent: document.getElementById('lapsContent'),
    lapsEmpty: document.getElementById('lapsEmpty'),
    lapsData: document.getElementById('lapsData'),
    statsColorBar: document.getElementById('statsColorBar'),
    statsDriverHeadshot: document.getElementById('statsDriverHeadshot'),
    statsDriverName: document.getElementById('statsDriverName'),
    statsDriverTeam: document.getElementById('statsDriverTeam'),
    statsDriverNumber: document.getElementById('statsDriverNumber'),
    statsFastestLap: document.getElementById('statsFastestLap'),
    statsTheoBestLap: document.getElementById('statsTheoBestLap'),
    statsAvgLap: document.getElementById('statsAvgLap'),
    statsTotalLaps: document.getElementById('statsTotalLaps'),
    stintsTimeline: document.getElementById('stintsTimeline'),
    chartHideOutliers: document.getElementById('chartHideOutliers'),
    lapsChartContainer: document.getElementById('lapsChartContainer'),
    lapsTableBody: document.getElementById('lapsTableBody'),

    // Compare Section
    compareDriverList: document.getElementById('compareDriverList'),
    compareChartContainer: document.getElementById('compareChartContainer'),
    compareLegend: document.getElementById('compareLegend'),
    compareHideOutliers: document.getElementById('compareHideOutliers'),
    compareSelectedCount: document.getElementById('compareSelectedCount'),
    
    // Circuit Details elements
    circuitOfficialName: document.getElementById('circuitOfficialName'),
    circuitShortName: document.getElementById('circuitShortName'),
    circuitLocation: document.getElementById('circuitLocation'),
    circuitCountry: document.getElementById('circuitCountry'),
    circuitType: document.getElementById('circuitType'),
    circuitGmtOffset: document.getElementById('circuitGmtOffset'),
    circuitStartDate: document.getElementById('circuitStartDate'),
    circuitEndDate: document.getElementById('circuitEndDate'),
    circuitMapContent: document.getElementById('circuitMapContent'),
    
    // Results
    resultsTableBody: document.getElementById('resultsTableBody'),
    resultsTableWrapper: document.getElementById('resultsTableWrapper'),
    resultsEmptyState: document.getElementById('resultsEmptyState'),
    resultsEmptyTitle: document.getElementById('resultsEmptyTitle'),
    resultsEmptyText: document.getElementById('resultsEmptyText'),

    // Race Control
    raceControlFeed: document.getElementById('raceControlFeed'),
    raceControlEmptyState: document.getElementById('raceControlEmptyState'),
    raceControlSummary: document.getElementById('raceControlSummary'),
    
    // Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
};

// Wrap standard fetch to include X-OpenF1-Key header and catch 403 live restrictions
async function customFetch(url, options = {}) {
    const apiKey = localStorage.getItem('openf1_api_key');
    if (apiKey) {
        options.headers = {
            ...options.headers,
            'X-OpenF1-Key': apiKey
        };
    }
    
    try {
        const response = await fetch(url, options);
        console.log(response);
        
        if (response.status === 403 || response.status === 401) {
            try {
                const clone = response.clone();
                const errData = await clone.json();
                if (errData && errData.error === 'live_session_restriction') {
                    showLiveRestrictionBanner(errData.detail || 'Access restricted during live F1 session.');
                }
            } catch (e) {
                console.error('Error parsing restriction details:', e);
            }
        } else if (response.ok) {
            hideLiveRestrictionBanner();
        }
        
        return response;
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

function showLiveRestrictionBanner(message) {
    if (DOM.liveRestrictionBanner) {
        DOM.liveRestrictionBanner.style.display = 'flex';
    }
    if (DOM.liveRestrictionMessage) {
        DOM.liveRestrictionMessage.textContent = message;
    }
}

function hideLiveRestrictionBanner() {
    if (DOM.liveRestrictionBanner) {
        DOM.liveRestrictionBanner.style.display = 'none';
    }
}

function toggleApiSettingsPanel() {
    if (!DOM.apiSettingsPanel) return;
    const isHidden = DOM.apiSettingsPanel.style.display === 'none';
    DOM.apiSettingsPanel.style.display = isHidden ? 'flex' : 'none';
    
    if (DOM.apiStatusBar) {
        DOM.apiStatusBar.classList.toggle('open', isHidden);
    }
}

function updateApiStatusBarUI() {
    const apiKey = localStorage.getItem('openf1_api_key');
    if (DOM.apiStatusText) {
        DOM.apiStatusText.textContent = apiKey ? 'API Status: Active Key' : 'API Status: Free';
    }
    if (DOM.apiStatusBar) {
        DOM.apiStatusBar.classList.toggle('active', !!apiKey);
    }
    if (DOM.openF1ApiKeyInput) {
        DOM.openF1ApiKeyInput.value = apiKey || '';
    }
    if (DOM.openF1ApiKeyClearBtn) {
        DOM.openF1ApiKeyClearBtn.style.display = apiKey ? 'inline-block' : 'none';
    }
}

function saveApiKey() {
    if (!DOM.openF1ApiKeyInput) return;
    const key = DOM.openF1ApiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('openf1_api_key', key);
        updateApiStatusBarUI();
        hideLiveRestrictionBanner();
        loadSessions(state.selectedYear, true);
    }
}

function clearApiKey() {
    localStorage.removeItem('openf1_api_key');
    updateApiStatusBarUI();
    loadSessions(state.selectedYear, true);
}

// Global scope bindings for inline calls
window.toggleApiSettingsPanel = toggleApiSettingsPanel;
window.saveApiKey = saveApiKey;
window.clearApiKey = clearApiKey;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // Select elements that were dynamically added to the index.html
    DOM.liveRestrictionBanner = document.getElementById('liveRestrictionBanner');
    DOM.liveRestrictionMessage = document.getElementById('liveRestrictionMessage');
    DOM.liveRestrictionEnterKeyBtn = document.getElementById('liveRestrictionEnterKeyBtn');
    DOM.liveRestrictionCloseBtn = document.getElementById('liveRestrictionCloseBtn');
    DOM.apiStatusBar = document.getElementById('apiStatusBar');
    DOM.apiStatusText = document.getElementById('apiStatusText');
    DOM.apiSettingsArrow = document.getElementById('apiSettingsArrow');
    DOM.apiSettingsPanel = document.getElementById('apiSettingsPanel');
    DOM.openF1ApiKeyInput = document.getElementById('openF1ApiKeyInput');
    DOM.openF1ApiKeySaveBtn = document.getElementById('openF1ApiKeySaveBtn');
    DOM.openF1ApiKeyClearBtn = document.getElementById('openF1ApiKeyClearBtn');

    setupEventListeners();
    updateApiStatusBarUI();
    loadSessions(state.selectedYear, true);
});

// Event Listeners Registration
function setupEventListeners() {
    // Year Buttons Click
    DOM.yearSelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.year-btn');
        if (!btn || btn.classList.contains('active')) return;
        
        document.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedYear = btn.dataset.year;
        
        loadSessions(state.selectedYear, true);
    });

    // Session Search Input
    DOM.sessionSearch.addEventListener('input', () => {
        filterAndRenderSessions();
    });

    // Session Type Filter Pills
    DOM.typeFilters.addEventListener('click', (e) => {
        const pill = e.target.closest('.filter-pill');
        if (!pill || pill.classList.contains('active')) return;
        
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        
        filterAndRenderSessions();
    });

    // Include Cancelled checkbox
    if (DOM.showCancelled) {
        DOM.showCancelled.addEventListener('change', () => {
            filterAndRenderSessions();
        });
    }

    // Driver Search Input
    DOM.driverSearch.addEventListener('input', () => {
        renderDriversGrid();
    });

    // Chart Outlier Toggle
    if (DOM.chartHideOutliers) {
        DOM.chartHideOutliers.addEventListener('change', () => {
            if (state.selectedDriverStats && state.laps[state.selectedDriverStats]) {
                renderLapChart(state.laps[state.selectedDriverStats]);
            }
        });
    }

    if (DOM.compareHideOutliers) {
        DOM.compareHideOutliers.addEventListener('change', renderCompareLapChart);
    }

    // Dashboard Tabs Toggle
    DOM.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            if (state.currentTab === targetTab) return;
            
            DOM.tabButtons.forEach(b => b.classList.remove('active'));
            DOM.tabViews.forEach(v => v.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
            state.currentTab = targetTab;
        });
    });

    // API Settings Toggle Click
    if (DOM.apiStatusBar) {
        DOM.apiStatusBar.addEventListener('click', toggleApiSettingsPanel);
    }
    
    // Save Key Click
    if (DOM.openF1ApiKeySaveBtn) {
        DOM.openF1ApiKeySaveBtn.addEventListener('click', saveApiKey);
    }
    
    // Clear Key Click
    if (DOM.openF1ApiKeyClearBtn) {
        DOM.openF1ApiKeyClearBtn.addEventListener('click', clearApiKey);
    }
    
    // Banner Enter Key Click
    if (DOM.liveRestrictionEnterKeyBtn) {
        DOM.liveRestrictionEnterKeyBtn.addEventListener('click', () => {
            if (DOM.apiSettingsPanel && DOM.apiSettingsPanel.style.display === 'none') {
                toggleApiSettingsPanel();
            }
            if (DOM.openF1ApiKeyInput) {
                DOM.openF1ApiKeyInput.focus();
            }
        });
    }
    
    // Banner Close Click
    if (DOM.liveRestrictionCloseBtn) {
        DOM.liveRestrictionCloseBtn.addEventListener('click', hideLiveRestrictionBanner);
    }
}

// Helper: Find the latest race event relative to current time
function findLatestRaceEvent(sessions) {
    const now = new Date();
    // Filter to only 'Race' type sessions (session_name 'Race' or 'Sprint', or session_type 'Race')
    const raceSessions = sessions.filter(s => 
        s.session_name === 'Race' || s.session_type === 'Race'
    );
    
    if (raceSessions.length === 0) return null;
    
    // Prefer non-cancelled races if available
    const activeRaces = raceSessions.filter(s => !s.is_cancelled);
    const targets = activeRaces.length > 0 ? activeRaces : raceSessions;
    
    // Find the last completed or ongoing race
    const pastOrOngoing = targets.filter(s => new Date(s.date_start) <= now);
    
    if (pastOrOngoing.length > 0) {
        // Return the one that started most recently
        return pastOrOngoing[pastOrOngoing.length - 1];
    } else {
        // Return the first upcoming race
        return targets[0];
    }
}

// Fetch and load F1 sessions list for selected year
async function loadSessions(year, autoFocus = false) {
    DOM.sessionsList.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading sessions...</p>
        </div>
    `;
    
    hideDashboard();

    try {
        const response = await customFetch(`/api/sessions?year=${year}`);
        if (!response.ok) throw new Error('Failed to fetch sessions');
        
        state.sessions = await response.json();
        
        // Sort sessions by date (newest first, or oldest first)
        // Usually, order chronologically looks cleaner for F1 calendars
        state.sessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
        
        if (autoFocus) {
            const latestRace = findLatestRaceEvent(state.sessions);
            if (latestRace) {
                state.selectedSession = latestRace;
            }
        }
        
        filterAndRenderSessions();
        
        if (autoFocus && state.selectedSession) {
            selectSession(state.selectedSession);
        }
    } catch (error) {
        console.error(error);
        DOM.sessionsList.innerHTML = `
            <div class="error-state">
                <span class="material-icons-round" style="font-size:36px;color:var(--accent-red)">error_outline</span>
                <p>Could not load sessions. Please try again.</p>
                <button onclick="loadSessions('${year}')" class="filter-pill" style="margin-top:8px">Retry</button>
            </div>
        `;
    }
}

// Filter and render F1 sessions
function filterAndRenderSessions() {
    const searchQuery = DOM.sessionSearch.value.toLowerCase().trim();
    const typeFilter = document.querySelector('.filter-pill.active').dataset.type;
    const showCancelled = DOM.showCancelled ? DOM.showCancelled.checked : false;

    state.filteredSessions = state.sessions.filter(session => {
        // If session is cancelled and showCancelled toggle is OFF, hide it
        if (session.is_cancelled && !showCancelled) {
            return false;
        }

        const matchesSearch = 
            (session.session_name || '').toLowerCase().includes(searchQuery) ||
            (session.location || '').toLowerCase().includes(searchQuery) ||
            (session.circuit_short_name || '').toLowerCase().includes(searchQuery) ||
            (session.country_name || '').toLowerCase().includes(searchQuery);

        const matchesType = typeFilter === 'all' || 
            (session.session_type || '').includes(typeFilter) || 
            (typeFilter === 'Qualifying' && (session.session_name || '').includes('Qualifying')) ||
            (typeFilter === 'Practice' && (session.session_name || '').includes('Practice'));

        return matchesSearch && matchesType;
    });

    // If currently selected session is filtered out, clear selection and hide dashboard
    if (state.selectedSession && !state.filteredSessions.some(s => s.session_key === state.selectedSession.session_key)) {
        hideDashboard();
        state.selectedSession = null;
    }

    renderSessionsList();
}

// Render F1 sessions list
function renderSessionsList() {
    if (state.filteredSessions.length === 0) {
        DOM.sessionsList.innerHTML = `
            <div class="loading-state">
                <p>No sessions found matching criteria.</p>
            </div>
        `;
        return;
    }

    DOM.sessionsList.innerHTML = '';
    state.filteredSessions.forEach(session => {
        const card = document.createElement('div');
        const isCancelled = session.is_cancelled === true;
        card.className = `session-card ${isCancelled ? 'cancelled' : ''} ${state.selectedSession && state.selectedSession.session_key === session.session_key ? 'active' : ''}`;
        
        let badgeClass = 'badge-practice';
        let badgeText = session.session_name;
        
        if (isCancelled) {
            badgeClass = 'badge-cancelled';
            badgeText = 'Cancelled';
        } else if (session.session_name.includes('Quali')) {
            badgeClass = 'badge-quali';
        } else if (session.session_name.includes('Race') || session.session_name.includes('Sprint')) {
            badgeClass = 'badge-race';
        }

        // Determine status for badge
        const now = new Date();
        const startDate = new Date(session.date_start);
        const endDate = new Date(session.date_end);

        let statusText = '';
        let statusClass = '';

        if (isCancelled) {
            statusText = 'Cancelled';
            statusClass = 'status-cancelled';
        } else if (now < startDate) {
            statusText = 'Upcoming';
            statusClass = 'status-upcoming';
        } else if (now > endDate) {
            statusText = 'Past';
            statusClass = 'status-past';
        } else {
            statusText = 'Live';
            statusClass = 'status-live';
        }

        const flagEmoji = COUNTRY_FLAGS[session.country_code] || '🏁';
        const sessionDate = new Date(session.date_start).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });
        const grandPrixName = `${session.circuit_short_name} GP`;
        const placeName = [session.location, session.country_name].filter(Boolean).join(', ');

        card.innerHTML = `
            <div class="session-flag-tile" aria-hidden="true">
                <span class="loc-flag" style="${isCancelled ? 'filter: grayscale(1) opacity(0.6);' : ''}">${flagEmoji}</span>
            </div>
            <div class="session-card-main">
                <div class="card-top">
                    <span class="session-type-badge ${badgeClass}">${badgeText}</span>
                    <div class="card-top-right">
                        <span class="status-badge ${statusClass}">${statusText}</span>
                        <span class="session-date">${sessionDate}</span>
                    </div>
                </div>
                <div class="session-gp">${grandPrixName}</div>
                <div class="session-loc">
                    <span class="material-icons-round loc-pin" aria-hidden="true">place</span>
                    <span>${placeName}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectSession(session);
        });

        DOM.sessionsList.appendChild(card);

        // Scroll active card into view
        if (state.selectedSession && state.selectedSession.session_key === session.session_key) {
            setTimeout(() => {
                card.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }, 50);
        }
    });
}

// Select a session and fetch its detailed data
async function selectSession(session) {
    state.selectedSession = session;
    state.drivers = [];
    state.weather = [];
    state.stints = [];
    state.results = [];
    state.raceControl = [];
    state.laps = {};
    state.selectedDriverStats = null;
    state.selectedCompareDrivers = [];
    state.currentMeeting = null;
    
    // If the session was cancelled, show the custom cancelled view and stop
    if (session.is_cancelled === true) {
        showCancelledSessionState(session);
        return;
    }
    
    // UI Loading state
    showDashboardLoading();

    try {
        // Fetch drivers list, weather, stints, meeting, results, and race control concurrently
        const [driversRes, weatherRes, meetingRes, stintsRes, resultsRes, raceControlRes] = await Promise.all([
            customFetch(`/api/drivers?session_key=${session.session_key}`),
            customFetch(`/api/weather?session_key=${session.session_key}`),
            customFetch(`/api/meetings?meeting_key=${session.meeting_key}`),
            customFetch(`/api/stints?session_key=${session.session_key}`),
            customFetch(`/api/results?session_key=${session.session_key}`),
            customFetch(`/api/race_control?session_key=${session.session_key}`)
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

        // Render dashboard components
        renderSessionHeader();
        renderWeather();
        renderDriversGrid();
        renderLapsDriverSidebar();
        renderCompareDriverSelector();
        renderCompareLapChart();
        renderCircuitTab();
        renderResultsTab();
        renderRaceControlFeed();
        
        // Hide empty state and show dashboard content
        DOM.emptyState.style.display = 'none';
        DOM.dashboardContent.style.display = 'flex';
        
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

// Render session header
function renderSessionHeader() {
    const s = state.selectedSession;
    const flag = COUNTRY_FLAGS[s.country_code] || '🏁';
    
    DOM.headerFlag.textContent = flag;
    DOM.headerYear.textContent = s.year;
    DOM.headerLocation.textContent = s.location;
    DOM.headerGPName.textContent = `${s.circuit_short_name} Grand Prix`;
    DOM.headerSessionType.textContent = s.session_name;

    // Render status badge in header
    const headerStatusBadge = document.getElementById('headerStatusBadge');
    if (headerStatusBadge) {
        const now = new Date();
        const startDate = new Date(s.date_start);
        const endDate = new Date(s.date_end);
        
        let statusText = '';
        let statusClass = '';
        
        if (s.is_cancelled) {
            statusText = 'Cancelled';
            statusClass = 'status-cancelled';
        } else if (now < startDate) {
            statusText = 'Upcoming';
            statusClass = 'status-upcoming';
        } else if (now > endDate) {
            statusText = 'Past';
            statusClass = 'status-past';
        } else {
            statusText = 'Live';
            statusClass = 'status-live';
        }
        
        headerStatusBadge.textContent = statusText;
        headerStatusBadge.className = `status-badge ${statusClass}`;
    }
}

// Render Weather Widget
function renderWeather() {
    if (state.weather.length === 0) {
        DOM.weatherAirTemp.textContent = '-- °C';
        DOM.weatherTrackTemp.textContent = '-- °C';
        DOM.weatherHumidity.textContent = '-- %';
        DOM.weatherWind.textContent = '-- m/s';
        DOM.weatherRainfall.style.display = 'none';
        return;
    }

    let airSum = 0, trackSum = 0, humidSum = 0, windSum = 0;
    let rainCount = 0;
    
    state.weather.forEach(w => {
        airSum += w.air_temperature || 0;
        trackSum += w.track_temperature || 0;
        humidSum += w.humidity || 0;
        windSum += w.wind_speed || 0;
        if (w.rainfall === 1) rainCount++;
    });

    const total = state.weather.length;
    DOM.weatherAirTemp.textContent = `${(airSum / total).toFixed(1)} °C`;
    DOM.weatherTrackTemp.textContent = `${(trackSum / total).toFixed(1)} °C`;
    DOM.weatherHumidity.textContent = `${(humidSum / total).toFixed(0)} %`;
    DOM.weatherWind.textContent = `${(windSum / total).toFixed(1)} m/s`;
    
    if (rainCount > 0) {
        DOM.weatherRainfall.style.display = 'flex';
    } else {
        DOM.weatherRainfall.style.display = 'none';
    }
}

// Render Circuit Tab Details
function renderCircuitTab() {
    if (!state.currentMeeting || !state.currentMeeting.meeting) {
        // Clear elements
        DOM.circuitOfficialName.textContent = '--';
        DOM.circuitShortName.textContent = '--';
        DOM.circuitLocation.textContent = '--';
        DOM.circuitCountry.textContent = '--';
        DOM.circuitType.textContent = '--';
        DOM.circuitGmtOffset.textContent = '--';
        DOM.circuitStartDate.textContent = '--';
        DOM.circuitEndDate.textContent = '--';
        showNoTrackMapState();
        return;
    }

    const m = state.currentMeeting.meeting;
    const info = state.currentMeeting.circuit_info;

    // Render metadata
    DOM.circuitOfficialName.textContent = m.meeting_official_name || m.meeting_name || '--';
    DOM.circuitShortName.textContent = m.circuit_short_name || '--';
    DOM.circuitLocation.textContent = m.location || '--';
    DOM.circuitCountry.textContent = m.country_name || '--';
    DOM.circuitType.textContent = m.circuit_type || 'Permanent';
    DOM.circuitGmtOffset.textContent = m.gmt_offset ? `GMT ${m.gmt_offset}` : '--';
    
    DOM.circuitStartDate.textContent = m.date_start ? new Date(m.date_start).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) : '--';

    DOM.circuitEndDate.textContent = m.date_end ? new Date(m.date_end).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) : '--';

    // Render track map
    if (info && Array.isArray(info.x) && info.x.length > 0) {
        const xCoords = info.x;
        const yCoords = info.y;
        const corners = info.corners || [];
        const rotation = 0 //info.rotation || 0;

        const xMin = Math.min(...xCoords);
        const xMax = Math.max(...xCoords);
        const yMin = Math.min(...yCoords);
        const yMax = Math.max(...yCoords);

        const width = xMax - xMin;
        const height = yMax - yMin;

        // Establish viewBox size
        const viewBoxSize = 1000;
        const padding = 100; // Margin around the track trace
        const drawSize = viewBoxSize - 2 * padding;

        // Calculate scaling factor to preserve aspect ratio
        const scale = Math.min(drawSize / width, drawSize / height);

        // Recenter offsets
        const offsetX = padding + (drawSize - width * scale) / 2;
        const offsetY = padding + (drawSize - height * scale) / 2;

        // Invert Y coordinate
        function mapX(x) {
            return (x - xMin) * scale + offsetX;
        }
        function mapY(y) {
            return (yMax - y) * scale + offsetY;
        }

        // Generate track path string
        let pathD = '';
        for (let i = 0; i < xCoords.length; i++) {
            const sx = mapX(xCoords[i]).toFixed(1);
            const sy = mapY(yCoords[i]).toFixed(1);
            if (i === 0) {
                pathD += `M ${sx} ${sy}`;
            } else {
                pathD += ` L ${sx} ${sy}`;
            }
        }
        pathD += ' Z'; // Close track path loop

        const centerVal = viewBoxSize / 2;

        // Build corner badges
        let cornerHTML = '';
        corners.forEach(c => {
            if (c.trackPosition) {
                const cx = mapX(c.trackPosition.x).toFixed(1);
                const cy = mapY(c.trackPosition.y).toFixed(1);
                cornerHTML += `
                    <g class="corner-marker-group" data-corner="${c.number}">
                        <circle cx="${cx}" cy="${cy}" r="24" class="corner-circle" />
                        <text x="${cx}" y="${cy}" dy="6" class="corner-text">${c.number}</text>
                    </g>
                `;
            }
        });

        // Render dynamic SVG layout
        DOM.circuitMapContent.innerHTML = `
            <svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <filter id="track-glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="8" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
                <g transform="rotate(${rotation}, ${centerVal}, ${centerVal})">
                    <path d="${pathD}" class="track-path" filter="url(#track-glow)" />
                    ${cornerHTML}
                </g>
            </svg>
        `;
    } else if (m.circuit_image) {
        // Fallback to official Formula 1 circuit graphic
        DOM.circuitMapContent.innerHTML = `
            <div class="fallback-track-img-wrapper">
                <img src="${m.circuit_image}" class="fallback-track-img" alt="${m.circuit_short_name} track map" onerror="showNoTrackMapState()">
                <span class="fallback-label">Official Formula 1 Circuit Graphic</span>
            </div>
        `;
    } else {
        showNoTrackMapState();
    }
}

// Fallback state if no track map coordinates or images are found
function showNoTrackMapState() {
    DOM.circuitMapContent.innerHTML = `
        <div class="loading-state" style="flex-direction:column;gap:12px;">
            <span class="material-icons-round" style="font-size:48px;color:var(--text-muted)">map</span>
            <p style="color:var(--text-muted);font-weight:500;">No track map layout available</p>
        </div>
    `;
}

// Render Results Tab
function renderResultsTab() {
    if (!state.results || state.results.length === 0) {
        if (DOM.resultsTableWrapper) DOM.resultsTableWrapper.style.display = 'none';
        if (DOM.resultsEmptyState) {
            DOM.resultsEmptyState.style.display = 'flex';
            DOM.resultsEmptyTitle.textContent = 'No Results Available';
            DOM.resultsEmptyText.textContent = 'Results are not available for this session. It may be upcoming or in progress.';
        }
        return;
    }

    if (DOM.resultsEmptyState) DOM.resultsEmptyState.style.display = 'none';
    if (DOM.resultsTableWrapper) DOM.resultsTableWrapper.style.display = 'block';

    const sortedResults = [...state.results].sort((a, b) => {
        const aPos = a.position !== null && a.position !== undefined ? Number(a.position) : Infinity;
        const bPos = b.position !== null && b.position !== undefined ? Number(b.position) : Infinity;
        
        if (aPos !== bPos) {
            return aPos - bPos;
        }
        
        const aLaps = a.number_of_laps || 0;
        const bLaps = b.number_of_laps || 0;
        if (aLaps !== bLaps) {
            return bLaps - aLaps;
        }
        
        return a.driver_number - b.driver_number;
    });

    if (DOM.resultsTableBody) {
        DOM.resultsTableBody.innerHTML = '';
        sortedResults.forEach((item) => {
            const driver = state.drivers.find(d => d.driver_number === item.driver_number) || {
                first_name: 'Driver',
                last_name: `#${item.driver_number}`,
                full_name: `Driver #${item.driver_number}`,
                team_name: 'Independent',
                name_acronym: `D${item.driver_number}`,
                team_colour: '787878'
            };

            let teamHex = driver.team_colour;
            if (!teamHex && driver.team_name) {
                teamHex = TEAM_COLORS[driver.team_name.toLowerCase()];
            }
            if (!teamHex) teamHex = '787878';

            let posDisplay = '';
            let posClass = 'pos-non-podium';
            
            if (item.dsq) {
                posDisplay = 'DSQ';
                posClass = 'pos-dsq';
            } else if (item.dns) {
                posDisplay = 'DNS';
                posClass = 'pos-dns';
            } else if (item.dnf) {
                posDisplay = 'NC';
                posClass = 'pos-dnf';
            } else if (item.position === null || item.position === undefined) {
                posDisplay = 'NC';
                posClass = 'pos-nc';
            } else {
                posDisplay = item.position;
                if (item.position === 1) posClass = 'pos-podium-1';
                else if (item.position === 2) posClass = 'pos-podium-2';
                else if (item.position === 3) posClass = 'pos-podium-3';
            }

            let statusText = 'Finished';
            let statusClass = 'finished';
            if (item.dsq) {
                statusText = 'Disqualified';
                statusClass = 'dsq';
            } else if (item.dns) {
                statusText = 'Did Not Start';
                statusClass = 'dns';
            } else if (item.dnf) {
                statusText = 'Did Not Finish';
                statusClass = 'dnf';
            } else if (item.position === null || item.position === undefined) {
                statusText = 'Not Classified';
                statusClass = 'dnf';
            }

            let timeGapDisplay = '--';
            if (item.position === 1 && item.duration) {
                timeGapDisplay = formatDuration(item.duration);
            } else if (item.gap_to_leader !== null && item.gap_to_leader !== undefined) {
                if (typeof item.gap_to_leader === 'number') {
                    timeGapDisplay = `+${item.gap_to_leader.toFixed(3)}s`;
                } else {
                    timeGapDisplay = item.gap_to_leader;
                }
            } else if (item.duration) {
                timeGapDisplay = formatDuration(item.duration);
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="results-position-cell ${posClass}">${posDisplay}</td>
                <td>
                    <div class="results-driver-cell">
                        <div class="results-team-color-indicator" style="background: #${teamHex};"></div>
                        <img src="${(driver.headshot_url || 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/').replace('.transform/1col/image.png', '')}" class="results-driver-avatar" alt="${driver.full_name}" onerror="this.src='https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/'">
                        <div class="results-driver-info">
                            <span class="results-driver-name">${driver.first_name} ${driver.last_name}</span>
                            <span class="results-driver-team">${driver.team_name || 'Independent'}</span>
                        </div>
                    </div>
                </td>
                <td>${item.number_of_laps !== null ? item.number_of_laps : '--'}</td>
                <td class="lap-duration-val">${timeGapDisplay}</td>
                <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                <td style="font-weight: 600; color: ${item.points > 0 ? 'var(--text-primary)' : 'var(--text-muted)'};">${item.points && true ? item.points : '-'}</td>
            `;
            DOM.resultsTableBody.appendChild(tr);
        });
    }
}

function getRaceControlType(item) {
    const message = (item.message || '').toUpperCase();
    const category = item.category || 'Other';
    const flag = item.flag || '';

    if (flag) return flag;
    if (category === 'SafetyCar' || message.includes('SAFETY CAR')) return 'Safety Car';
    if (category === 'SessionStatus') return 'Session';
    if (message.includes('PENALTY')) return 'Penalty';
    if (message.includes('INVESTIGAT')) return 'Investigation';
    if (message.includes('INCIDENT')) return 'Incident';
    return category;
}

function getRaceControlClass(label) {
    return `race-control-type-${String(label || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function renderRaceControlFeed() {
    if (!DOM.raceControlFeed || !DOM.raceControlEmptyState) return;

    if (!state.raceControl || state.raceControl.length === 0) {
        DOM.raceControlFeed.style.display = 'none';
        DOM.raceControlEmptyState.style.display = 'flex';
        if (DOM.raceControlSummary) {
            DOM.raceControlSummary.textContent = 'No session messages recorded';
        }
        return;
    }

    DOM.raceControlEmptyState.style.display = 'none';
    DOM.raceControlFeed.style.display = 'flex';

    const sortedMessages = [...state.raceControl].sort((a, b) => {
        return (b.date || '').localeCompare(a.date || '');
    });

    if (DOM.raceControlSummary) {
        const incidentCount = sortedMessages.filter(item => {
            const msg = (item.message || '').toUpperCase();
            return msg.includes('INCIDENT') || msg.includes('PENALTY') || msg.includes('INVESTIGAT');
        }).length;
        DOM.raceControlSummary.textContent = `${sortedMessages.length} messages, ${incidentCount} incident updates`;
    }

    DOM.raceControlFeed.innerHTML = sortedMessages.map((item) => {
        const typeLabel = getRaceControlType(item);
        const typeClass = getRaceControlClass(typeLabel);
        const driver = item.driver_number ? state.drivers.find(d => d.driver_number === item.driver_number) : null;
        const driverLabel = driver ? `${driver.name_acronym || driver.last_name} #${item.driver_number}` : (item.driver_number ? `Car ${item.driver_number}` : '');
        const metaItems = [
            item.lap_number !== null && item.lap_number !== undefined ? `Lap ${item.lap_number}` : '',
            driverLabel,
            item.scope ? item.scope : '',
            item.sector !== null && item.sector !== undefined ? `Sector ${item.sector}` : ''
        ].filter(Boolean);

        return `
            <article class="race-control-item">
                <div class="race-control-time">${escapeHtml(formatRaceControlTime(item.date))}</div>
                <div class="race-control-main">
                    <div class="race-control-row">
                        <span class="race-control-type ${typeClass}">${escapeHtml(typeLabel)}</span>
                        <div class="race-control-meta">
                            ${metaItems.map(meta => `<span class="race-control-meta-pill">${escapeHtml(meta)}</span>`).join('')}
                        </div>
                    </div>
                    <p class="race-control-message">${escapeHtml(item.message || 'Race control notice')}</p>
                </div>
            </article>
        `;
    }).join('');
}

// Render Grid of Drivers
function renderDriversGrid() {
    const filter = DOM.driverSearch.value.toLowerCase().trim();
    
    const filteredDrivers = state.drivers.filter(d => {
        return (d.full_name || '').toLowerCase().includes(filter) ||
               (d.team_name || '').toLowerCase().includes(filter) ||
               (d.name_acronym || '').toLowerCase().includes(filter) ||
               String(d.driver_number).includes(filter);
    });

    if (filteredDrivers.length === 0) {
        DOM.driversGrid.innerHTML = `
            <div class="loading-state" style="grid-column: 1 / -1;">
                <p>No drivers match filter.</p>
            </div>
        `;
        return;
    }

    DOM.driversGrid.innerHTML = '';
    filteredDrivers.forEach(d => {
        // Resolve F1 Team Colors
        let teamHex = d.team_colour;
        if (!teamHex && d.team_name) {
            teamHex = TEAM_COLORS[d.team_name.toLowerCase()];
        }
        if (!teamHex) teamHex = '787878';
        
        const rgb = getRGBColor(teamHex);
        const card = document.createElement('div');
        card.className = 'driver-card';
        card.style.setProperty('--team-color', `#${teamHex}`);
        card.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.2)`);

        // Handle Fallback Headshots
        const headshot = d.headshot_url || 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/';

        card.innerHTML = `
            <div class="driver-card-top">
                <div class="driver-info">
                    <div class="driver-team">${d.team_name || 'Independent'}</div>
                    <div class="driver-name">${d.first_name} ${d.last_name}</div>
                    <div class="driver-acronym">${d.name_acronym || ''}</div>
                </div>
                <div class="driver-number-badge">${d.driver_number}</div>
            </div>
            <div class="driver-watermark-number">${d.driver_number}</div>
            <div class="driver-headshot-container">
                <img src="${headshot.replace('.transform/1col/image.png', '')}" class="driver-headshot" alt="${d.full_name}" onerror="this.src='https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/'">
            </div>
        `;

        card.addEventListener('click', () => {
            // Switch to Laps & Stints tab
            const lapsTab = document.getElementById('tab-laps');
            lapsTab.click();
            
            // Select driver in side panel
            selectDriverForStats(d.driver_number);
        });

        DOM.driversGrid.appendChild(card);
    });
}

// Render driver pills in Laps side panel
function renderLapsDriverSidebar() {
    DOM.lapsDriverList.innerHTML = '';
    
    // Sort drivers by driver number or team name
    const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    
    sortedDrivers.forEach(d => {
        let teamHex = d.team_colour || TEAM_COLORS[(d.team_name || '').toLowerCase()] || '787878';
        const rgb = getRGBColor(teamHex);
        
        const pill = document.createElement('button');
        pill.className = 'driver-pill';
        pill.id = `pill-driver-${d.driver_number}`;
        pill.style.setProperty('--team-color', `#${teamHex}`);
        pill.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.25)`);
        
        pill.innerHTML = `
            <span>${d.name_acronym || d.last_name} &bull; ${d.driver_number}</span>
            <span class="pill-team-dot"></span>
        `;
        
        pill.addEventListener('click', () => {
            selectDriverForStats(d.driver_number);
        });
        
        DOM.lapsDriverList.appendChild(pill);
    });
}

function renderCompareDriverSelector() {
    if (!DOM.compareDriverList) return;

    DOM.compareDriverList.innerHTML = '';

    const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    sortedDrivers.forEach(d => {
        const driverNumber = Number(d.driver_number);
        if (Number.isNaN(driverNumber)) return;

        const teamHex = getDriverTeamHex(d);
        const rgb = getRGBColor(teamHex);
        const isSelected = state.selectedCompareDrivers.includes(driverNumber);
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `compare-driver-pill ${isSelected ? 'active' : ''}`;
        pill.id = `compare-driver-${driverNumber}`;
        pill.style.setProperty('--team-color', `#${teamHex}`);
        pill.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.25)`);

        pill.innerHTML = `
            <span class="compare-driver-code">${escapeHtml(d.name_acronym || d.last_name || driverNumber)}</span>
            <span class="compare-driver-meta">
                <span class="pill-team-dot"></span>
                <span>${driverNumber}</span>
            </span>
        `;

        pill.addEventListener('click', () => {
            toggleCompareDriver(driverNumber);
        });

        DOM.compareDriverList.appendChild(pill);
    });

    updateCompareSelectedCount();
}

function updateCompareSelectedCount() {
    if (!DOM.compareSelectedCount) return;
    const count = state.selectedCompareDrivers.length;
    DOM.compareSelectedCount.textContent = `${count} selected`;
}

async function toggleCompareDriver(driverNumber) {
    const normalizedDriverNumber = Number(driverNumber);
    if (Number.isNaN(normalizedDriverNumber)) return;

    const existingIndex = state.selectedCompareDrivers.indexOf(normalizedDriverNumber);
    if (existingIndex >= 0) {
        state.selectedCompareDrivers.splice(existingIndex, 1);
        renderCompareDriverSelector();
        renderCompareLapChart();
        return;
    }

    state.selectedCompareDrivers.push(normalizedDriverNumber);
    renderCompareDriverSelector();

    const needsLapData = !state.laps[normalizedDriverNumber];
    if (needsLapData && DOM.compareChartContainer) {
        DOM.compareChartContainer.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading comparison laps...</p>
            </div>
        `;
    }

    if (needsLapData && state.selectedSession) {
        await fetchDriverLaps(state.selectedSession.session_key, normalizedDriverNumber);
    }

    renderCompareLapChart();
}

function renderCompareLegend(selectedDrivers) {
    if (!DOM.compareLegend) return;

    if (selectedDrivers.length === 0) {
        DOM.compareLegend.innerHTML = '<span class="compare-legend-empty">No drivers selected</span>';
        return;
    }

    DOM.compareLegend.innerHTML = selectedDrivers.map(driver => {
        const teamHex = getDriverTeamHex(driver);
        const label = driver.name_acronym || driver.last_name || driver.driver_number;
        return `
            <div class="compare-legend-item" style="--team-color: #${teamHex};">
                <span class="compare-legend-swatch"></span>
                <span>${escapeHtml(label)}</span>
            </div>
        `;
    }).join('');
}

function renderCompareEmptyState(icon, title, text) {
    if (!DOM.compareChartContainer) return;
    DOM.compareChartContainer.innerHTML = `
        <div class="compare-empty">
            <span class="material-icons-round">${icon}</span>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(text)}</p>
        </div>
    `;
}

function renderCompareLapChart() {
    if (!DOM.compareChartContainer) return;

    updateCompareSelectedCount();

    const selectedDrivers = state.selectedCompareDrivers
        .map(driverNumber => state.drivers.find(d => Number(d.driver_number) === Number(driverNumber)))
        .filter(Boolean);

    renderCompareLegend(selectedDrivers);

    if (selectedDrivers.length === 0) {
        renderCompareEmptyState('stacked_line_chart', 'No Drivers Selected', 'Select drivers from the list to compare lap time progression.');
        return;
    }

    DOM.compareChartContainer.innerHTML = '';

    const hideOutliers = DOM.compareHideOutliers ? DOM.compareHideOutliers.checked : true;
    const series = selectedDrivers.map(driver => {
        const driverNumber = Number(driver.driver_number);
        const validLaps = (state.laps[driverNumber] || [])
            .filter(lap => (
                lap.lap_duration &&
                !Number.isNaN(Number(lap.lap_duration)) &&
                Number.isFinite(Number(lap.lap_number))
            ));
        const durations = validLaps.map(lap => Number(lap.lap_duration));
        const fastest = durations.length > 0 ? Math.min(...durations) : null;
        const outlierThreshold = fastest ? fastest * 1.15 : Infinity;
        let plottableLaps = hideOutliers
            ? validLaps.filter(lap => Number(lap.lap_duration) <= outlierThreshold)
            : validLaps;

        if (plottableLaps.length === 0 && validLaps.length > 0) {
            plottableLaps = validLaps;
        }

        return {
            driver,
            driverNumber,
            teamHex: getDriverTeamHex(driver),
            validLaps,
            plottableLaps,
            outlierThreshold
        };
    }).filter(item => item.validLaps.length > 0);

    if (series.length === 0) {
        renderCompareEmptyState('query_stats', 'No Lap Times Available', 'The selected drivers do not have lap times recorded for this session.');
        return;
    }

    const lapNumbers = series.flatMap(item => item.validLaps.map(lap => Number(lap.lap_number))).filter(Number.isFinite);
    const plotDurations = series.flatMap(item => item.plottableLaps.map(lap => Number(lap.lap_duration))).filter(Number.isFinite);

    const minLap = Math.min(...lapNumbers);
    const maxLap = Math.max(...lapNumbers);
    const minTime = Math.min(...plotDurations);
    const maxTime = Math.max(...plotDurations);

    const width = DOM.compareChartContainer.clientWidth || 900;
    const height = 460;
    const padding = { top: 24, right: 34, bottom: 34, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const getX = (lapNum) => {
        if (maxLap === minLap) return padding.left + chartWidth / 2;
        return padding.left + ((lapNum - minLap) / (maxLap - minLap)) * chartWidth;
    };

    const getY = (duration) => {
        if (maxTime === minTime) return padding.top + chartHeight / 2;
        return padding.top + chartHeight - ((duration - minTime) / (maxTime - minTime)) * chartHeight;
    };

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    const yGridLines = 4;
    for (let i = 0; i <= yGridLines; i++) {
        const tVal = minTime + (i / yGridLines) * (maxTime - minTime);
        const y = getY(tVal);

        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", padding.left + chartWidth);
        line.setAttribute("y2", y);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", padding.left - 10);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "end");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = formatLapTime(tVal);
        svg.appendChild(text);
    }

    const xGridLines = Math.min(10, maxLap - minLap + 1);
    for (let i = 0; i < xGridLines; i++) {
        const lapNum = Math.round(minLap + (i / (xGridLines - 1 || 1)) * (maxLap - minLap));
        const x = getX(lapNum);

        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", padding.top);
        line.setAttribute("x2", x);
        line.setAttribute("y2", padding.top + chartHeight);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", x);
        text.setAttribute("y", padding.top + chartHeight + 20);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = `L${lapNum}`;
        svg.appendChild(text);
    }

    const xAxis = document.createElementNS(svgNamespace, "line");
    xAxis.setAttribute("x1", padding.left);
    xAxis.setAttribute("y1", padding.top + chartHeight);
    xAxis.setAttribute("x2", padding.left + chartWidth);
    xAxis.setAttribute("y2", padding.top + chartHeight);
    xAxis.setAttribute("class", "chart-axis-line");
    svg.appendChild(xAxis);

    const yAxis = document.createElementNS(svgNamespace, "line");
    yAxis.setAttribute("x1", padding.left);
    yAxis.setAttribute("y1", padding.top);
    yAxis.setAttribute("x2", padding.left);
    yAxis.setAttribute("y2", padding.top + chartHeight);
    yAxis.setAttribute("class", "chart-axis-line");
    svg.appendChild(yAxis);

    const safetyCarPeriods = extractSafetyCarPeriods(state.raceControl);
    safetyCarPeriods.forEach(period => {
        const start = Math.max(period.start, minLap);
        const end = Math.min(period.end, maxLap);
        if (start > end) return;

        const xStart = getX(start);
        const xEnd = getX(end);
        let width = xEnd - xStart;
        if (width <= 0) width = 2;

        const isVSC = period.type === 'VSC';
        const rect = document.createElementNS(svgNamespace, "rect");
        rect.setAttribute("x", xStart);
        rect.setAttribute("y", padding.top);
        rect.setAttribute("width", width);
        rect.setAttribute("height", chartHeight);
        rect.setAttribute("class", isVSC ? "chart-vsc-shading" : "chart-safety-car-shading");
        svg.appendChild(rect);

        const lineLeft = document.createElementNS(svgNamespace, "line");
        lineLeft.setAttribute("x1", xStart);
        lineLeft.setAttribute("y1", padding.top);
        lineLeft.setAttribute("x2", xStart);
        lineLeft.setAttribute("y2", padding.top + chartHeight);
        lineLeft.setAttribute("class", isVSC ? "chart-vsc-boundary" : "chart-safety-car-boundary");
        svg.appendChild(lineLeft);

        if (xEnd > xStart) {
            const lineRight = document.createElementNS(svgNamespace, "line");
            lineRight.setAttribute("x1", xEnd);
            lineRight.setAttribute("y1", padding.top);
            lineRight.setAttribute("x2", xEnd);
            lineRight.setAttribute("y2", padding.top + chartHeight);
            lineRight.setAttribute("class", isVSC ? "chart-vsc-boundary" : "chart-safety-car-boundary");
            svg.appendChild(lineRight);
        }

        if (width > 12) {
            const text = document.createElementNS(svgNamespace, "text");
            text.setAttribute("x", xStart + width / 2);
            text.setAttribute("y", padding.top + 15);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("class", isVSC ? "chart-vsc-text" : "chart-safety-car-text");
            text.textContent = isVSC ? "VSC" : (width < 50 ? "SC" : "Safety Car");
            svg.appendChild(text);
        }
    });

    let tooltip = document.querySelector(".chart-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }

    series.forEach(item => {
        const rgb = getRGBColor(item.teamHex);
        const points = item.plottableLaps.map(lap => (
            `${getX(Number(lap.lap_number)).toFixed(1)},${getY(Number(lap.lap_duration)).toFixed(1)}`
        ));

        if (points.length > 1) {
            const path = document.createElementNS(svgNamespace, "path");
            path.setAttribute("d", `M ${points.join(" L ")}`);
            path.setAttribute("class", "compare-chart-line");
            path.style.stroke = `#${item.teamHex}`;
            path.style.setProperty('--team-color', `#${item.teamHex}`);
            path.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.35)`);
            svg.appendChild(path);
        }

        item.validLaps.forEach(lap => {
            const isOutlier = hideOutliers && Number(lap.lap_duration) > item.outlierThreshold;
            const x = getX(Number(lap.lap_number));
            const y = isOutlier ? padding.top : getY(Number(lap.lap_duration));
            const circle = document.createElementNS(svgNamespace, "circle");
            circle.setAttribute("cx", x);
            circle.setAttribute("cy", y);
            circle.setAttribute("r", isOutlier ? 3.5 : 4.2);
            circle.setAttribute("class", isOutlier ? "chart-outlier-dot compare-chart-outlier-dot" : "compare-chart-dot");
            circle.style.stroke = `#${item.teamHex}`;
            circle.style.setProperty('--team-color', `#${item.teamHex}`);

            circle.addEventListener("mouseenter", () => {
                circle.classList.add("active");
                if (!isOutlier) {
                    circle.style.fill = `#${item.teamHex}`;
                }

                const driverLabel = item.driver.name_acronym || item.driver.last_name || item.driver.driver_number;
                tooltip.style.display = "block";
                tooltip.innerHTML = `
                    <div class="chart-tooltip-header">${escapeHtml(driverLabel)} - Lap ${lap.lap_number}</div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span style="color:var(--text-muted)">Time:</span>
                        <strong style="color:var(--text-primary)">${formatLapTime(Number(lap.lap_duration))}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:10px;">
                        <span style="color:var(--text-muted)">S1:</span>
                        <span>${lap.duration_sector_1 ? Number(lap.duration_sector_1).toFixed(3) + 's' : '--'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:10px;">
                        <span style="color:var(--text-muted)">S2:</span>
                        <span>${lap.duration_sector_2 ? Number(lap.duration_sector_2).toFixed(3) + 's' : '--'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:10px;">
                        <span style="color:var(--text-muted)">S3:</span>
                        <span>${lap.duration_sector_3 ? Number(lap.duration_sector_3).toFixed(3) + 's' : '--'}</span>
                    </div>
                    ${isOutlier ? '<div style="color:#ffd60a;font-size:9px;margin-top:6px;font-weight:700;text-align:center;">OUTLIER (PIT/SLOW LAP)</div>' : ''}
                `;

                const rect = DOM.compareChartContainer.getBoundingClientRect();
                const circleX = rect.left + window.scrollX + x;
                const circleY = rect.top + window.scrollY + y;
                tooltip.style.left = `${circleX - 80}px`;
                tooltip.style.top = `${circleY - tooltip.clientHeight - 12}px`;
            });

            circle.addEventListener("mouseleave", () => {
                circle.classList.remove("active");
                if (!isOutlier) {
                    circle.style.fill = "#0c0c12";
                }
                tooltip.style.display = "none";
            });

            svg.appendChild(circle);
        });
    });

    DOM.compareChartContainer.appendChild(svg);
}

// Select driver and fetch laps & stint details to render analytics
// Select driver and fetch laps & stint details to render analytics
async function selectDriverForStats(driverNumber) {
    state.selectedDriverStats = driverNumber;
    
    // Highlight pill
    document.querySelectorAll('.driver-pill').forEach(p => p.classList.remove('active'));
    const activePill = document.getElementById(`pill-driver-${driverNumber}`);
    if (activePill) activePill.classList.add('active');

    // Get Driver details
    const d = state.drivers.find(drv => drv.driver_number === driverNumber);
    if (!d) return;

    // Show loading sub-state
    DOM.lapsEmpty.style.display = 'none';
    DOM.lapsData.style.display = 'none';
    
    // Temporarily append a loading spinner inside laps panel
    const loader = document.createElement('div');
    loader.className = 'loading-state';
    loader.innerHTML = '<div class="spinner"></div><p>Loading driver telemetry...</p>';
    DOM.lapsContent.appendChild(loader);

    try {
        // Load driver laps
        const laps = await fetchDriverLaps(state.selectedSession.session_key, driverNumber);
        
        // Remove loader
        loader.remove();
        
        // Render stats header with official headshot and color
        let teamHex = d.team_colour || TEAM_COLORS[(d.team_name || '').toLowerCase()] || '787878';
        DOM.statsColorBar.style.backgroundColor = `#${teamHex}`;
        DOM.statsDriverName.textContent = `${d.first_name} ${d.last_name}`;
        DOM.statsDriverTeam.textContent = d.team_name || 'Independent';
        DOM.statsDriverNumber.textContent = d.driver_number;
        DOM.statsDriverNumber.style.color = `#${teamHex}`;
        
        // Load driver avatar image
        const headshot = d.headshot_url || "";//'https://media.formula1.com/d_driver_fallback_image.png';
        DOM.statsDriverHeadshot.src = headshot.replace('.transform/1col/image.png', '');
        DOM.statsDriverHeadshot.style.setProperty('--team-color', `#${teamHex}`);
        const rgb = getRGBColor(teamHex);
        DOM.statsDriverHeadshot.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.2)`);

        // Compute lap statistics
        let fastestDuration = Infinity;
        let totalLaps = 0;
        let bestS1 = Infinity;
        let bestS2 = Infinity;
        let bestS3 = Infinity;
        let runningLaps = [];
        
        laps.forEach(lap => {
            if (lap.lap_duration && lap.lap_duration < fastestDuration) {
                fastestDuration = lap.lap_duration;
            }
            if (lap.lap_duration) {
                totalLaps++;
                runningLaps.push(lap.lap_duration);
            }
            if (lap.duration_sector_1 && lap.duration_sector_1 < bestS1) bestS1 = lap.duration_sector_1;
            if (lap.duration_sector_2 && lap.duration_sector_2 < bestS2) bestS2 = lap.duration_sector_2;
            if (lap.duration_sector_3 && lap.duration_sector_3 < bestS3) bestS3 = lap.duration_sector_3;
        });

        // 1. Fastest Lap
        DOM.statsFastestLap.textContent = fastestDuration !== Infinity ? formatLapTime(fastestDuration) : '--';
        
        // 2. Theoretical Best Lap
        if (bestS1 !== Infinity && bestS2 !== Infinity && bestS3 !== Infinity) {
            const theoBest = bestS1 + bestS2 + bestS3;
            DOM.statsTheoBestLap.textContent = formatLapTime(theoBest);
            DOM.statsTheoBestLap.title = `S1: ${bestS1.toFixed(3)}s | S2: ${bestS2.toFixed(3)}s | S3: ${bestS3.toFixed(3)}s`;
        } else {
            DOM.statsTheoBestLap.textContent = '--';
            DOM.statsTheoBestLap.title = '';
        }

        // 3. Average Lap Pace (exclude outliers above 115% of fastest lap)
        if (fastestDuration !== Infinity && runningLaps.length > 0) {
            const paceThreshold = fastestDuration * 1.15;
            const representativeLaps = runningLaps.filter(dur => dur <= paceThreshold);
            const sum = representativeLaps.reduce((acc, v) => acc + v, 0);
            const avgVal = sum / (representativeLaps.length || 1);
            DOM.statsAvgLap.textContent = formatLapTime(avgVal);
            DOM.statsAvgLap.title = `Averaged ${representativeLaps.length} of ${runningLaps.length} laps (filtered out pit stops / yellow flags)`;
        } else {
            DOM.statsAvgLap.textContent = '--';
            DOM.statsAvgLap.title = '';
        }

        // 4. Total Laps
        DOM.statsTotalLaps.textContent = totalLaps;

        // Render Laps Table with Sector Personal Best highlights
        let lapsTableHTML = '';
        if (laps.length === 0) {
            lapsTableHTML = '<tr><td colspan="5" style="text-align:center;">No lap data recorded for this driver.</td></tr>';
        } else {
            laps.forEach(lap => {
                const isFastest = lap.lap_duration === fastestDuration;
                const isBestS1 = lap.duration_sector_1 === bestS1;
                const isBestS2 = lap.duration_sector_2 === bestS2;
                const isBestS3 = lap.duration_sector_3 === bestS3;

                lapsTableHTML += `
                    <tr id="lap-row-${lap.lap_number}">
                        <td>${lap.lap_number}</td>
                        <td class="${isBestS1 ? 'personal-best-sector' : ''}">
                            ${lap.duration_sector_1 ? lap.duration_sector_1.toFixed(3) + 's' : '--'}
                        </td>
                        <td class="${isBestS2 ? 'personal-best-sector' : ''}">
                            ${lap.duration_sector_2 ? lap.duration_sector_2.toFixed(3) + 's' : '--'}
                        </td>
                        <td class="${isBestS3 ? 'personal-best-sector' : ''}">
                            ${lap.duration_sector_3 ? lap.duration_sector_3.toFixed(3) + 's' : '--'}
                        </td>
                        <td class="${isFastest ? 'fastest-lap-highlight' : 'lap-duration-val'}">
                            ${isFastest ? '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;margin-right:4px;">grade</span>' : ''}
                            ${formatLapTime(lap.lap_duration)}
                        </td>
                    </tr>
                `;
            });
        }
        DOM.lapsTableBody.innerHTML = lapsTableHTML;

        // Render Stints Timeline
        renderStintsTimeline(driverNumber);

        // Render Lap Timing Chart
        renderLapChart(laps);

        // Display dashboard
        DOM.lapsData.style.display = 'block';
    } catch (e) {
        console.error('Error rendering driver details:', e);
        loader.remove();
        DOM.lapsEmpty.style.display = 'flex';
    }
}

// Render Stints Timeline with Gap/Garage intervals
function renderStintsTimeline(driverNumber) {
    const driverStints = state.stints.filter(s => s.driver_number === driverNumber);
    
    if (driverStints.length === 0) {
        DOM.stintsTimeline.innerHTML = '<div style="display:flex;align-items:center;padding:0 16px;color:var(--text-muted);font-size:13px;width:100%;height:100%;">No stint data recorded.</div>';
        return;
    }

    // Sort stints by lap_start
    driverStints.sort((a, b) => a.lap_start - b.lap_start);

    // Determine absolute max lap from stints and laps data
    let maxLap = 0;
    driverStints.forEach(s => {
        if (s.lap_end > maxLap) maxLap = s.lap_end;
    });

    const laps = state.laps[driverNumber] || [];
    if (laps.length > 0) {
        const lastLap = laps[laps.length - 1].lap_number;
        if (lastLap > maxLap) maxLap = lastLap;
    }

    if (maxLap === 0) maxLap = 1;

    DOM.stintsTimeline.innerHTML = '';
    
    // Scan and build timeline including active stints and garage gaps
    let currentLap = 1;
    const timelineSegments = [];

    driverStints.forEach(stint => {
        // Gap before stint starts
        if (stint.lap_start > currentLap) {
            timelineSegments.push({
                type: 'gap',
                lap_start: currentLap,
                lap_end: stint.lap_start - 1,
                compound: 'GARAGE'
            });
        }
        
        timelineSegments.push({
            type: 'stint',
            stint_number: stint.stint_number,
            lap_start: stint.lap_start,
            lap_end: stint.lap_end,
            compound: stint.compound,
            tyre_age_at_start: stint.tyre_age_at_start
        });
        
        currentLap = stint.lap_end + 1;
    });

    // Gap at the end
    if (currentLap <= maxLap) {
        timelineSegments.push({
            type: 'gap',
            lap_start: currentLap,
            lap_end: maxLap,
            compound: 'GARAGE'
        });
    }

    timelineSegments.forEach(segment => {
        const stintLaps = (segment.lap_end - segment.lap_start) + 1;
        const widthPct = (stintLaps / maxLap) * 100;
        
        const div = document.createElement('div');
        const compound = (segment.compound || 'UNKNOWN').toUpperCase();
        div.className = `stint-segment stint-compound-${compound}`;
        div.style.width = `${widthPct}%`;
        
        if (segment.type === 'gap') {
            div.innerHTML = `
                <span>G</span>
                <div class="stint-tooltip">
                    <strong>In Garage / Inactive</strong><br>
                    Laps: ${segment.lap_start} - ${segment.lap_end} (${stintLaps} laps)
                </div>
            `;
        } else {
            const initial = segment.compound ? segment.compound.charAt(0) : '?';
            div.innerHTML = `
                <span>${initial}</span>
                <div class="stint-tooltip">
                    <strong>Stint ${segment.stint_number}: ${segment.compound || 'Unknown'}</strong><br>
                    Laps: ${segment.lap_start} - ${segment.lap_end} (${stintLaps} laps)<br>
                    Starting Age: ${segment.tyre_age_at_start || 0} laps
                </div>
            `;
        }
        
        DOM.stintsTimeline.appendChild(div);
    });
}

// Parse Safety Car (SC) and Virtual Safety Car (VSC) periods from race control messages
function extractSafetyCarPeriods(records) {
    if (!records || !Array.isArray(records)) return [];
    
    // Sort records by date to process chronologically
    const sorted = [...records].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    
    const periods = [];
    let currentType = null; // 'SC' or 'VSC'
    let startLap = null;
    
    for (const r of sorted) {
        const msg = (r.message || '').toUpperCase();
        const lap = r.lap_number;
        if (lap === null || lap === undefined) continue;
        
        // VSC Start
        if (msg.includes("VSC DEPLOYED")) {
            if (currentType && currentType !== "VSC") {
                periods.push({ type: currentType, start: startLap, end: lap });
            }
            currentType = "VSC";
            startLap = lap;
        }
        // VSC End
        else if (msg.includes("VSC ENDING") || msg.includes("VSC TERMINATED")) {
            if (currentType === "VSC") {
                periods.push({ type: "VSC", start: startLap, end: lap });
                currentType = null;
                startLap = null;
            }
        }
        // SC Start
        else if (msg.includes("SAFETY CAR DEPLOYED")) {
            if (currentType && currentType !== "SC") {
                periods.push({ type: currentType, start: startLap, end: lap });
            }
            currentType = "SC";
            startLap = lap;
        }
        // SC End
        else if (msg.includes("SAFETY CAR IN THIS LAP") || msg.includes("SAFETY CAR IN")) {
            if (currentType === "SC") {
                periods.push({ type: "SC", start: startLap, end: lap });
                currentType = null;
                startLap = null;
            }
        }
        // Red Flag / Aborted
        else if (msg.includes("SESSION ABORTED") || msg.includes("RED FLAG")) {
            if (currentType) {
                periods.push({ type: currentType, start: startLap, end: lap });
                currentType = null;
                startLap = null;
            }
        }
    }
    
    if (currentType && startLap !== null) {
        const maxLap = records.reduce((max, r) => {
            return (r.lap_number !== null && r.lap_number !== undefined && r.lap_number > max) ? r.lap_number : max;
        }, startLap);
        periods.push({ type: currentType, start: startLap, end: maxLap });
    }
    
    return periods;
}

// Render SVG Timing Chart
function renderLapChart(laps) {
    if (!DOM.lapsChartContainer) return;
    DOM.lapsChartContainer.innerHTML = '';

    // Filter laps with valid duration
    const validLaps = laps.filter(l => l.lap_duration && !isNaN(l.lap_duration));
    if (validLaps.length === 0) {
        DOM.lapsChartContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">No lap times recorded to plot.</div>';
        return;
    }

    // Determine outliers
    const durations = validLaps.map(l => l.lap_duration);
    const fastest = Math.min(...durations);
    
    // Outlier limit: 1.15 * fastest
    const outlierThreshold = fastest * 1.15;
    
    const hideOutliers = DOM.chartHideOutliers ? DOM.chartHideOutliers.checked : true;
    
    // Laps to plot on the trendline
    let plottableLaps = validLaps;
    if (hideOutliers) {
        plottableLaps = validLaps.filter(l => l.lap_duration <= outlierThreshold);
    }
    
    if (plottableLaps.length === 0) {
        plottableLaps = validLaps; // Fallback
    }

    const plotDurations = plottableLaps.map(l => l.lap_duration);
    const minTime = Math.min(...plotDurations);
    const maxTime = Math.max(...plotDurations);
    
    const minLap = Math.min(...validLaps.map(l => l.lap_number));
    const maxLap = Math.max(...validLaps.map(l => l.lap_number));

    // Chart margins and sizes
    const width = DOM.lapsChartContainer.clientWidth || 800;
    const height = 320;
    const padding = { top: 20, right: 30, bottom: 30, left: 55 };
    
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Scale helper functions
    const getX = (lapNum) => {
        if (maxLap === minLap) return padding.left + chartWidth / 2;
        return padding.left + ((lapNum - minLap) / (maxLap - minLap)) * chartWidth;
    };

    const getY = (duration) => {
        if (maxTime === minTime) return padding.top + chartHeight / 2;
        // Flip Y coordinates so smaller duration is higher up!
        return padding.top + chartHeight - ((duration - minTime) / (maxTime - minTime)) * chartHeight;
    };

    // Create SVG element
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    // Draw Grid Lines (Y axis - time)
    const yGridLines = 4;
    for (let i = 0; i <= yGridLines; i++) {
        const tVal = minTime + (i / yGridLines) * (maxTime - minTime);
        const y = getY(tVal);
        
        // Grid Line
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", padding.left + chartWidth);
        line.setAttribute("y2", y);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        // Y label
        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", padding.left - 10);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "end");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = formatLapTime(tVal);
        svg.appendChild(text);
    }

    // Draw X Grid Lines & Labels (Lap number)
    const xGridLines = Math.min(10, maxLap - minLap + 1);
    for (let i = 0; i < xGridLines; i++) {
        const lapNum = Math.round(minLap + (i / (xGridLines - 1 || 1)) * (maxLap - minLap));
        const x = getX(lapNum);
        
        // Grid Line
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", padding.top);
        line.setAttribute("x2", x);
        line.setAttribute("y2", padding.top + chartHeight);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        // X Label
        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", x);
        text.setAttribute("y", padding.top + chartHeight + 18);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = `L${lapNum}`;
        svg.appendChild(text);
    }

    // Draw Main Axis lines
    const xAxis = document.createElementNS(svgNamespace, "line");
    xAxis.setAttribute("x1", padding.left);
    xAxis.setAttribute("y1", padding.top + chartHeight);
    xAxis.setAttribute("x2", padding.left + chartWidth);
    xAxis.setAttribute("y2", padding.top + chartHeight);
    xAxis.setAttribute("class", "chart-axis-line");
    svg.appendChild(xAxis);

    const yAxis = document.createElementNS(svgNamespace, "line");
    yAxis.setAttribute("x1", padding.left);
    yAxis.setAttribute("y1", padding.top);
    yAxis.setAttribute("x2", padding.left);
    yAxis.setAttribute("y2", padding.top + chartHeight);
    yAxis.setAttribute("class", "chart-axis-line");
    svg.appendChild(yAxis);

    // Draw Safety Car & VSC Zones
    const safetyCarPeriods = extractSafetyCarPeriods(state.raceControl);
    safetyCarPeriods.forEach(period => {
        // Clamp to chart boundaries
        const start = Math.max(period.start, minLap);
        const end = Math.min(period.end, maxLap);
        if (start > end) return;
        
        const xStart = getX(start);
        const xEnd = getX(end);
        let width = xEnd - xStart;
        if (width <= 0) width = 2; // thin line if single lap deployment
        
        const isVSC = period.type === 'VSC';
        
        // 1. Shading
        const rect = document.createElementNS(svgNamespace, "rect");
        rect.setAttribute("x", xStart);
        rect.setAttribute("y", padding.top);
        rect.setAttribute("width", width);
        rect.setAttribute("height", chartHeight);
        rect.setAttribute("class", isVSC ? "chart-vsc-shading" : "chart-safety-car-shading");
        svg.appendChild(rect);
        
        // 2. Boundary Lines (left and right)
        const lineLeft = document.createElementNS(svgNamespace, "line");
        lineLeft.setAttribute("x1", xStart);
        lineLeft.setAttribute("y1", padding.top);
        lineLeft.setAttribute("x2", xStart);
        lineLeft.setAttribute("y2", padding.top + chartHeight);
        lineLeft.setAttribute("class", isVSC ? "chart-vsc-boundary" : "chart-safety-car-boundary");
        svg.appendChild(lineLeft);
        
        if (xEnd > xStart) {
            const lineRight = document.createElementNS(svgNamespace, "line");
            lineRight.setAttribute("x1", xEnd);
            lineRight.setAttribute("y1", padding.top);
            lineRight.setAttribute("x2", xEnd);
            lineRight.setAttribute("y2", padding.top + chartHeight);
            lineRight.setAttribute("class", isVSC ? "chart-vsc-boundary" : "chart-safety-car-boundary");
            svg.appendChild(lineRight);
        }
        
        // 3. Label Text
        let labelText = isVSC ? "VSC" : "Safety Car";
        if (!isVSC && width < 50) {
            labelText = "SC";
        }
        if (width > 12) {
            const text = document.createElementNS(svgNamespace, "text");
            text.setAttribute("x", xStart + width / 2);
            text.setAttribute("y", padding.top + 15);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("class", isVSC ? "chart-vsc-text" : "chart-safety-car-text");
            text.textContent = labelText;
            svg.appendChild(text);
        }
    });

    // Build path points
    let points = [];
    plottableLaps.forEach(lap => {
        points.push(`${getX(lap.lap_number).toFixed(1)},${getY(lap.lap_duration).toFixed(1)}`);
    });

    // Set line color dynamically based on driver's team color
    const activeDriver = state.drivers.find(drv => drv.driver_number === state.selectedDriverStats);
    let teamHex = 'ff1801';
    if (activeDriver) {
        teamHex = activeDriver.team_colour || TEAM_COLORS[(activeDriver.team_name || '').toLowerCase()] || 'ff1801';
    }

    if (points.length > 1) {
        const path = document.createElementNS(svgNamespace, "path");
        path.setAttribute("d", `M ${points.join(" L ")}`);
        path.setAttribute("class", "chart-line");
        path.style.stroke = `#${teamHex}`;
        path.style.setProperty('--team-color', `#${teamHex}`);
        const rgb = getRGBColor(teamHex);
        path.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.35)`);
        svg.appendChild(path);
    }

    // Create custom tooltip div if not exists
    let tooltip = document.querySelector(".chart-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }

    // Plot data points
    validLaps.forEach(lap => {
        const isOutlier = hideOutliers && lap.lap_duration > outlierThreshold;
        const x = getX(lap.lap_number);
        const y = isOutlier ? padding.top : getY(lap.lap_duration);

        const circle = document.createElementNS(svgNamespace, "circle");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.style.setProperty('--team-color', `#${teamHex}`);
        
        if (isOutlier) {
            circle.setAttribute("r", 3.5);
            circle.setAttribute("class", "chart-outlier-dot");
        } else {
            circle.setAttribute("r", 4.5);
            circle.setAttribute("class", "chart-dot");
            circle.style.stroke = `#${teamHex}`;
        }

        // Hover interactions
        circle.addEventListener("mouseenter", (e) => {
            circle.classList.add("active");
            if (!isOutlier) {
                circle.style.fill = `#${teamHex}`;
            }
            
            // Show Tooltip
            tooltip.style.display = "block";
            tooltip.innerHTML = `
                <div class="chart-tooltip-header">Lap ${lap.lap_number}</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span style="color:var(--text-muted)">Time:</span>
                    <strong style="color:var(--text-primary)">${formatLapTime(lap.lap_duration)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:10px;">
                    <span style="color:var(--text-muted)">S1:</span>
                    <span>${lap.duration_sector_1 ? lap.duration_sector_1.toFixed(3) + 's' : '--'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:10px;">
                    <span style="color:var(--text-muted)">S2:</span>
                    <span>${lap.duration_sector_2 ? lap.duration_sector_2.toFixed(3) + 's' : '--'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;">
                    <span style="color:var(--text-muted)">S3:</span>
                    <span>${lap.duration_sector_3 ? lap.duration_sector_3.toFixed(3) + 's' : '--'}</span>
                </div>
                ${isOutlier ? '<div style="color:#ffd60a;font-size:9px;margin-top:6px;font-weight:700;text-align:center;">OUTLIER (PIT/SLOW LAP)</div>' : ''}
            `;
            
            const rect = DOM.lapsChartContainer.getBoundingClientRect();
            const circleX = rect.left + window.scrollX + x;
            const circleY = rect.top + window.scrollY + y;
            
            tooltip.style.left = `${circleX - 80}px`;
            tooltip.style.top = `${circleY - tooltip.clientHeight - 12}px`;

            // Highlight row in table
            const row = document.getElementById(`lap-row-${lap.lap_number}`);
            if (row) {
                row.classList.add("lap-row-highlight");
                row.style.setProperty('--team-color', `#${teamHex}`);
                row.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        });

        circle.addEventListener("mouseleave", () => {
            circle.classList.remove("active");
            if (!isOutlier) {
                circle.style.fill = "#0c0c12";
            }
            tooltip.style.display = "none";
            
            const row = document.getElementById(`lap-row-${lap.lap_number}`);
            if (row) {
                row.classList.remove("lap-row-highlight");
            }
        });

        svg.appendChild(circle);
    });

    DOM.lapsChartContainer.appendChild(svg);
}

// Helper: Show full dashboard loading
function showDashboardLoading() {
    DOM.emptyState.style.display = 'flex';
    DOM.emptyState.innerHTML = `
        <div class="spinner"></div>
        <h2 style="margin-top:16px;">Loading Session Details...</h2>
        <p>Fetching driver, lap, weather, and stint data from OpenF1...</p>
    `;
    DOM.dashboardContent.style.display = 'none';
}

// Helper: Hide dashboard and reset empty state
function hideDashboard() {
    DOM.emptyState.style.display = 'flex';
    DOM.emptyState.innerHTML = `
        <span class="material-icons-round empty-icon">sports_score</span>
        <h2>No Session Selected</h2>
        <p>Select a Formula 1 session from the sidebar to view detailed driver telemetry, weather information, and session stats.</p>
    `;
    DOM.dashboardContent.style.display = 'none';
}
