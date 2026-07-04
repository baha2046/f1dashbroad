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

        const age = calculateAgeAtDate(d.birthday, state.selectedSession ? state.selectedSession.date_start : null);
        card.innerHTML = `
            <div class="driver-card-top">
                <div class="driver-info">
                    <div class="driver-team">${d.team_name || 'Independent'}</div>
                    <div class="driver-name">${d.first_name} ${d.last_name}</div>
                    <div class="driver-acronym">${d.name_acronym || ''}</div>
                    <div class="driver-meta">
                        ${d.nationality ? `<span class="driver-flag" title="${d.nationality}">${getNationalityFlag(d.nationality)}</span>` : ''}
                        ${age ? `<span class="driver-age">${age} yrs</span>` : ''}
                        ${d.wiki_url ? `<a href="${d.wiki_url}" target="_blank" class="driver-wiki-link" title="Wikipedia Page"><span class="material-icons-round">open_in_new</span></a>` : ''}
                    </div>
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

        // Prevent switching tabs when clicking Wikipedia link
        const wikiLink = card.querySelector('.driver-wiki-link');
        if (wikiLink) {
            wikiLink.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        DOM.driversGrid.appendChild(card);
    });
}

// Render driver pills in Laps side panel
function renderLapsDriverSidebar() {
    DOM.lapsDriverList.innerHTML = '';
    
    // Sort drivers by driver number or team name
    const sortedDrivers = [...state.drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    
    sortedDrivers.forEach(d => {
        const teamHex = getDriverTeamHex(d);
        const rgb = getRGBColor(teamHex);
        
        const pill = document.createElement('button');
        pill.className = 'driver-pill';
        pill.id = `pill-driver-${d.driver_number}`;
        pill.style.setProperty('--team-color', `#${teamHex}`);
        pill.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.25)`);
        
        pill.innerHTML = `
            <span class="driver-pill-code">${escapeHtml(d.name_acronym || d.last_name || d.driver_number)}</span>
            <span class="driver-pill-meta">
                <span class="pill-team-dot"></span>
                <span>${escapeHtml(String(d.driver_number))}</span>
            </span>
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

function isCompareChartVisible(chartId) {
    return state.compareView.visibleCharts.has(chartId);
}

function hasCompareStintData() {
    return Array.isArray(state.stints) && state.stints.length > 0;
}

function isCompareChartAvailable(chartId) {
    if (['gap', 'position', 'headToHead'].includes(chartId)) {
        return isPitAnnotationSession(state.selectedSession);
    }
    if (chartId === 'tyreStrategy') {
        return hasCompareStintData();
    }
    return true;
}

function setCompareChartSectionVisibility(section, visible) {
    if (!section) return;
    section.style.display = visible ? 'block' : 'none';
}

function setupCompareChartToggles() {
    if (!DOM.compareChartToggles) return;

    DOM.compareChartToggles.addEventListener('click', event => {
        const button = event.target.closest('[data-chart-id]');
        if (!button || button.disabled) return;

        const chartId = button.dataset.chartId;
        if (!isCompareChartAvailable(chartId)) return;

        if (isCompareChartVisible(chartId)) {
            state.compareView.visibleCharts.delete(chartId);
        } else {
            state.compareView.visibleCharts.add(chartId);
        }

        state.compareView.hoverLap = null;
        renderCompareLapChart();
    });
}

function updateCompareChartToggles() {
    if (!DOM.compareChartToggles) return;

    DOM.compareChartToggles.querySelectorAll('[data-chart-id]').forEach(button => {
        const chartId = button.dataset.chartId;
        const available = isCompareChartAvailable(chartId);
        const active = available && isCompareChartVisible(chartId);

        button.style.display = available ? 'inline-flex' : 'none';
        button.disabled = !available;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}
