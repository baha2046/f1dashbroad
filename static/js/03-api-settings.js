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
        } else if (response.status === 502 || response.status === 503) {
            try {
                const clone = response.clone();
                const errData = await clone.json();
                if (errData && errData.error === 'upstream_error') {
                    showLiveRestrictionBanner(errData.detail || 'F1 data service is temporarily unavailable.');
                }
            } catch (e) {
                console.error('Error parsing upstream error details:', e);
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
    if (typeof setupLapsChartAutoResize === 'function') {
        setupLapsChartAutoResize();
    }
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

    // Show Blue Flags Toggle
    if (DOM.showBlueFlags) {
        DOM.showBlueFlags.addEventListener('change', () => {
            renderRaceControlFeed();
        });
    }

    // Championship Progression: Drivers / Constructors toggle
    if (DOM.progressionDriversBtn) {
        DOM.progressionDriversBtn.addEventListener('click', () => {
            state.progressionView = 'drivers';
            renderChampionshipProgressionChart();
        });
    }
    if (DOM.progressionConstructorsBtn) {
        DOM.progressionConstructorsBtn.addEventListener('click', () => {
            state.progressionView = 'constructors';
            renderChampionshipProgressionChart();
        });
    }

    // Telemetry Lap Selector
    if (DOM.telemetryLapSelect) {
        DOM.telemetryLapSelect.addEventListener('change', () => {
            loadSelectedLapTelemetry();
        });
    }

    // Session Replay Controls
    if (DOM.replayDriverSelect) {
        DOM.replayDriverSelect.addEventListener('change', () => {
            setupReplayTimeline().then(() => maybeAutoLoadReplay());
        });
    }
    if (DOM.replayTimeline) {
        DOM.replayTimeline.addEventListener('click', (e) => {
            onReplayTimelineClick(e);
        });
    }
    if (DOM.replayMapContent) {
        DOM.replayMapContent.addEventListener('click', (e) => {
            onReplayDriverHighlightClick(e);
        });
    }
    if (DOM.replayTowerBody) {
        DOM.replayTowerBody.addEventListener('click', (e) => {
            onReplayDriverHighlightClick(e);
        });
    }
    if (DOM.replayPlayBtn) {
        DOM.replayPlayBtn.addEventListener('click', () => {
            toggleReplayPlayback();
        });
    }
    if (DOM.replayScrubber) {
        DOM.replayScrubber.addEventListener('input', () => {
            scrubReplayToFraction(Number(DOM.replayScrubber.value) / Number(DOM.replayScrubber.max || 1000));
        });
    }
    if (DOM.replaySpeedToggle) {
        DOM.replaySpeedToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-speed]');
            if (!btn) return;
            DOM.replaySpeedToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.replay.speed = Number(btn.dataset.speed) || 1;
        });
    }

    // Chart Outlier Toggle
    if (DOM.chartHideOutliers) {
        DOM.chartHideOutliers.addEventListener('change', () => {
            if (state.selectedDriverStats && state.laps[state.selectedDriverStats]) {
                if (typeof scheduleLapChartRender === 'function') {
                    scheduleLapChartRender(state.laps[state.selectedDriverStats]);
                } else {
                    renderLapChart(state.laps[state.selectedDriverStats]);
                }
            }
        });
    }

    if (DOM.compareHideOutliers) {
        DOM.compareHideOutliers.addEventListener('change', () => {
            state.compareView.hoverLap = null;
            renderCompareLapChart();
        });
    }

    setupCompareChartToggles();

    if (DOM.compareHeadToHeadRef) {
        DOM.compareHeadToHeadRef.addEventListener('change', () => {
            const ref = Number(DOM.compareHeadToHeadRef.value);
            state.compareView.headToHeadRef = Number.isFinite(ref) ? ref : null;
            state.compareView.hoverLap = null;
            renderCompareLapChart();
        });
    }

    if (DOM.compareResetZoom) {
        DOM.compareResetZoom.addEventListener('click', () => {
            state.compareView.lapWindow = { min: null, max: null };
            state.compareView.hoverLap = null;
            renderCompareLapChart();
        });
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

            // Telemetry fetches are deferred until the Laps tab is actually visible
            if (targetTab === 'laps-view') {
                if (typeof scheduleLapChartRender === 'function') {
                    scheduleLapChartRender();
                }
                maybeAutoLoadTelemetry();
            }

            // Replay fetches are deferred until the Session Replay tab is actually visible
            if (targetTab === 'replay-view') {
                maybeAutoLoadReplay();
            }
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
