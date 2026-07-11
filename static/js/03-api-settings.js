// Wrap standard fetch so upstream data-service errors can surface consistently.
async function customFetch(url, options = {}) {
    try {
        const response = await fetch(url, options);

        if (response.status === 502 || response.status === 503) {
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

function updateApiStatusBarUI() {
    if (DOM.apiStatusText) {
        DOM.apiStatusText.textContent = 'Data Source: F1 Livetiming';
    }
    if (DOM.apiStatusBar) {
        DOM.apiStatusBar.classList.add('active');
    }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // Select elements that were dynamically added to the index.html
    DOM.liveRestrictionBanner = document.getElementById('liveRestrictionBanner');
    DOM.liveRestrictionMessage = document.getElementById('liveRestrictionMessage');
    DOM.liveRestrictionCloseBtn = document.getElementById('liveRestrictionCloseBtn');
    DOM.apiStatusBar = document.getElementById('apiStatusBar');
    DOM.apiStatusText = document.getElementById('apiStatusText');

    setupEventListeners();
    if (typeof setupLapsChartAutoResize === 'function') {
        setupLapsChartAutoResize();
    }
    updateApiStatusBarUI();
    // The static buttons in index.html are the instant fallback; the probed
    // list replaces them so new seasons appear without a template edit
    initYearSelector().finally(() => loadSessions(state.selectedYear, true));
});

async function initYearSelector() {
    try {
        const response = await customFetch('/api/years');
        if (!response.ok) return;
        const years = await response.json();
        if (!Array.isArray(years) || years.length === 0) return;
        state.selectedYear = String(Number(years[0]));
        DOM.yearSelector.innerHTML = years
            .map(y => Number(y))
            .filter(y => Number.isFinite(y))
            .map((y, i) => `<button class="year-btn${i === 0 ? ' active' : ''}" data-year="${y}">${y}</button>`)
            .join('');
    } catch (error) {
        console.error('Year list load failed:', error);
    }
}

const DRIVER_IMAGE_FALLBACK = 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/';

// CSP forbids inline onerror handlers, so broken images are swapped centrally.
// Error events don't bubble; listen in the capture phase.
function setupImageFallbacks() {
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (img.classList.contains('fallback-track-img')) {
            if (typeof showNoTrackMapState === 'function') showNoTrackMapState();
            return;
        }
        const isDriverImage = img.classList.contains('driver-headshot')
            || img.classList.contains('results-driver-avatar')
            || img.classList.contains('driver-profile-avatar');
        if (!isDriverImage || img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = '1';
        img.src = DRIVER_IMAGE_FALLBACK;
    }, true);
}

// Event Listeners Registration
function setupEventListeners() {
    setupImageFallbacks();
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
    if (DOM.driversModeTeamsBtn) {
        DOM.driversModeTeamsBtn.addEventListener('click', () => setDriversViewMode('teams'));
    }
    if (DOM.driversModeDriversBtn) {
        DOM.driversModeDriversBtn.addEventListener('click', () => setDriversViewMode('drivers'));
    }

    // Show Blue Flags Toggle
    if (DOM.showBlueFlags) {
        DOM.showBlueFlags.addEventListener('change', () => {
            renderRaceControlFeed();
        });
    }

    // Show Team Radio Toggle
    if (DOM.showTeamRadio) {
        DOM.showTeamRadio.addEventListener('change', () => {
            renderRaceControlFeed();
        });
    }

    // Team radio play buttons: the feed re-renders freely, so delegate;
    // the replay ticker button is persistent and wired directly.
    if (DOM.raceControlFeed) {
        DOM.raceControlFeed.addEventListener('click', (e) => {
            onTeamRadioPlayClick(e);
        });
    }
    if (DOM.replayTeamRadioPlayBtn) {
        DOM.replayTeamRadioPlayBtn.addEventListener('click', (e) => {
            onTeamRadioPlayClick(e);
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

    // Telemetry Lap Selector (re-fetches the comparison when one is active)
    if (DOM.telemetryLapSelect) {
        DOM.telemetryLapSelect.addEventListener('change', () => {
            if (typeof updateActiveLapTableSelection === 'function') {
                updateActiveLapTableSelection(DOM.telemetryLapSelect.value);
            }
            maybeAutoLoadTelemetry();
        });
    }

    // A lap number in the timing log opens that lap directly in the telemetry lab.
    if (DOM.lapsTableBody) {
        DOM.lapsTableBody.addEventListener('click', (event) => {
            const button = event.target.closest('.lap-analyze-btn');
            if (!button || !DOM.lapsTableBody.contains(button)) return;
            selectLapForTelemetry(button.dataset.lapNumber);
        });
    }

    // Telemetry Compare Selectors
    if (DOM.telemetryCompareDriverSelect) {
        DOM.telemetryCompareDriverSelect.addEventListener('change', () => {
            onTelemetryCompareDriverChange();
        });
    }
    if (DOM.telemetryCompareLapSelect) {
        DOM.telemetryCompareLapSelect.addEventListener('change', () => {
            onTelemetryCompareLapChange();
        });
    }

    // Telemetry View Controls (drag-zoom reset + detail-mode layout)
    if (DOM.telemetryResetZoom) {
        DOM.telemetryResetZoom.addEventListener('click', () => {
            resetTelemetryZoom();
            updateTelemetryZoomControl();
        });
    }
    if (DOM.telemetryDetailMode) {
        DOM.telemetryDetailMode.addEventListener('change', () => {
            state.telemetryView.detailMode = DOM.telemetryDetailMode.checked;
            applyTelemetryChartLayout();
            rerenderTelemetry();
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
        DOM.replayMapContent.addEventListener('keydown', (e) => {
            onReplayDriverHighlightKeydown(e);
        });
        setupReplayMapRotation();
    }
    if (DOM.replayViewToggle) {
        DOM.replayViewToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-map-view]');
            if (!btn) return;
            setReplayMapViewMode(btn.dataset.mapView);
        });
    }
    updateReplayMapViewControls();
    if (DOM.replayTowerBody) {
        DOM.replayTowerBody.addEventListener('click', (e) => {
            onReplayDriverHighlightClick(e);
        });
        DOM.replayTowerBody.addEventListener('keydown', (e) => {
            onReplayDriverHighlightKeydown(e);
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
            DOM.replaySpeedToggle.querySelectorAll('button').forEach((button) => {
                const isActive = button === btn;
                button.classList.toggle('active', isActive);
                button.setAttribute('aria-pressed', String(isActive));
            });
            state.replay.speed = Number(btn.dataset.speed) || 1;
        });
    }
    document.addEventListener('keydown', onReplayKeyboardShortcut);

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

            // Sector benchmarks are loaded on demand because practice and
            // qualifying sessions do not otherwise need every driver's laps.
            if (targetTab === 'circuit-view') {
                maybeLoadCircuitSectorBenchmarks();
            }
        });
    });

    // Banner Close Click
    if (DOM.liveRestrictionCloseBtn) {
        DOM.liveRestrictionCloseBtn.addEventListener('click', hideLiveRestrictionBanner);
    }
}
