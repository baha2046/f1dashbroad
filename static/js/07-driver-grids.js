function canonicalConstructorKey(value) {
    const compact = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return '';
    if (compact === 'rb' || compact.includes('racingbulls') || compact.includes('visacashapprb')) return 'rb';
    if (compact.includes('redbull')) return 'redbull';
    if (compact.includes('astonmartin')) return 'astonmartin';
    if (compact.includes('alphatauri')) return 'alphatauri';
    if (compact.includes('tororosso')) return 'tororosso';
    if (compact.includes('kicksauber') || compact.includes('stakef1') || compact.includes('sauber')) return 'sauber';
    if (compact.includes('alpine')) return 'alpine';
    if (compact.includes('cadillac')) return 'cadillac';
    if (compact.includes('mercedes')) return 'mercedes';
    if (compact.includes('ferrari')) return 'ferrari';
    if (compact.includes('mclaren')) return 'mclaren';
    if (compact.includes('williams')) return 'williams';
    if (compact.includes('haas')) return 'haas';
    if (compact.includes('audi')) return 'audi';
    return compact.replace(/formulaone|f1team|racing|team/g, '');
}

function getConstructorRosterItems() {
    const roster = state.constructorRoster;
    return roster && Array.isArray(roster.constructors) ? roster.constructors : [];
}

function findConstructorForDriver(driver, constructors = getConstructorRosterItems()) {
    const teamKey = canonicalConstructorKey(driver && driver.team_name);
    if (!teamKey) return null;
    return constructors.find((constructor) => (
        canonicalConstructorKey(constructor.constructorId) === teamKey ||
        canonicalConstructorKey(constructor.name) === teamKey
    )) || null;
}

function buildConstructorGroups() {
    const constructors = getConstructorRosterItems();
    const assignedDrivers = new Set();
    const groups = constructors.map((constructor) => {
        const keys = new Set([
            canonicalConstructorKey(constructor.constructorId),
            canonicalConstructorKey(constructor.name)
        ]);
        const drivers = state.drivers.filter((driver) => keys.has(canonicalConstructorKey(driver.team_name)));
        drivers.forEach(driver => assignedDrivers.add(Number(driver.driver_number)));
        return { constructor, drivers, fromJolpica: true };
    });

    const fallbackByTeam = new Map();
    state.drivers.forEach((driver) => {
        if (assignedDrivers.has(Number(driver.driver_number))) return;
        const key = canonicalConstructorKey(driver.team_name) || `driver-${driver.driver_number}`;
        if (!fallbackByTeam.has(key)) {
            fallbackByTeam.set(key, {
                constructor: {
                    constructorId: key,
                    name: driver.team_name || 'Independent',
                    nationality: null,
                    url: null
                },
                drivers: [],
                fromJolpica: false
            });
        }
        fallbackByTeam.get(key).drivers.push(driver);
    });

    return [...groups, ...fallbackByTeam.values()].sort((a, b) => (
        String(a.constructor.name || '').localeCompare(String(b.constructor.name || ''))
    ));
}

function getConstructorTeamHex(group) {
    if (group.drivers.length) return getDriverTeamHex(group.drivers[0]);
    const name = String(group.constructor.name || '').toLowerCase();
    const id = String(group.constructor.constructorId || '').toLowerCase();
    return String(TEAM_COLORS[name] || TEAM_COLORS[id] || '787878').replace('#', '');
}

function openDriverAnalysis(driverNumber) {
    const lapsTab = document.getElementById('tab-laps');
    if (lapsTab) lapsTab.click();
    selectDriverForStats(driverNumber);
}

function setDriversViewMode(mode) {
    state.driversViewMode = mode === 'drivers' ? 'drivers' : 'teams';
    if (DOM.driversModeTeamsBtn && DOM.driversModeDriversBtn) {
        const teamsActive = state.driversViewMode === 'teams';
        DOM.driversModeTeamsBtn.classList.toggle('active', teamsActive);
        DOM.driversModeDriversBtn.classList.toggle('active', !teamsActive);
        DOM.driversModeTeamsBtn.setAttribute('aria-pressed', String(teamsActive));
        DOM.driversModeDriversBtn.setAttribute('aria-pressed', String(!teamsActive));
    }
    renderDriversGrid();
}

function updateDriversSummary(groups) {
    const roster = state.constructorRoster || {};
    const meeting = state.currentMeeting || {};
    const session = state.selectedSession || {};
    const venue = meeting.circuit_short_name || session.circuit_short_name || session.location || 'Formula 1';
    const constructors = getConstructorRosterItems();
    const nationalityCount = new Set(
        constructors.map(item => String(item.nationality || '').trim()).filter(Boolean)
    ).size;

    if (DOM.driversHeroTitle) DOM.driversHeroTitle.textContent = `${venue} paddock`;
    if (DOM.driversHeroSubtitle) {
        DOM.driversHeroSubtitle.textContent = roster.race_name
            ? `${roster.race_name} drivers matched with the official constructor roster.`
            : 'Session drivers matched with their constructor identities and team context.';
    }
    if (DOM.driversRosterRound) {
        DOM.driversRosterRound.textContent = roster.round
            ? `${roster.season || session.year || state.selectedYear} · Round ${roster.round}`
            : `${session.year || state.selectedYear} season roster`;
    }
    if (DOM.driversCount) DOM.driversCount.textContent = String(state.drivers.length);
    if (DOM.driversConstructorCount) DOM.driversConstructorCount.textContent = String(constructors.length || groups.length);
    if (DOM.driversNationalityCount) DOM.driversNationalityCount.textContent = String(nationalityCount || '--');
}

function driverMatchesPaddockFilter(driver, constructor, filter) {
    if (!filter) return true;
    return [
        driver.full_name,
        driver.first_name,
        driver.last_name,
        driver.name_acronym,
        driver.driver_number,
        driver.team_name,
        driver.nationality,
        constructor && constructor.name,
        constructor && constructor.nationality
    ].some(value => String(value || '').toLowerCase().includes(filter));
}

function renderDriversEmptyState(message) {
    DOM.driversGrid.innerHTML = `
        <div class="drivers-grid-empty">
            <span class="material-icons-round" aria-hidden="true">search_off</span>
            <strong>No paddock matches</strong>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function createConstructorCard(group) {
    const constructor = group.constructor;
    const teamHex = getConstructorTeamHex(group);
    const rgb = getRGBColor(teamHex);
    const nationality = constructor.nationality || 'Nationality unavailable';
    const initials = String(constructor.name || 'F1')
        .split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    const card = document.createElement('article');
    card.className = 'constructor-card';
    card.style.setProperty('--team-color', `#${teamHex}`);
    card.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.2)`);
    card.innerHTML = `
        <div class="constructor-card-watermark" aria-hidden="true">${escapeHtml(initials)}</div>
        <header class="constructor-card-header">
            <div class="constructor-identity">
                <span class="constructor-color-orb" aria-hidden="true"></span>
                <div>
                    <span class="constructor-kicker">${group.fromJolpica ? 'Official constructor' : 'Session team'}</span>
                    <h4>${escapeHtml(constructor.name || 'Independent')}</h4>
                    <p><span aria-hidden="true">${getNationalityFlag(constructor.nationality)}</span> ${escapeHtml(nationality)} · ${escapeHtml(constructor.constructorId || 'team')}</p>
                </div>
            </div>
            ${constructor.url ? `<a class="constructor-profile-link" href="${safeUrl(constructor.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(constructor.name)} constructor profile"><span class="material-icons-round" aria-hidden="true">open_in_new</span></a>` : ''}
        </header>
        <div class="constructor-driver-lineup">
            ${group.drivers.length ? group.drivers.map((driver) => {
                const headshot = driver.headshot_url || 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/';
                return `
                    <button type="button" class="constructor-driver" data-driver-number="${escapeHtml(driver.driver_number)}" aria-label="Open lap analysis for ${escapeHtml(driver.full_name)}">
                        <span class="constructor-driver-number">${escapeHtml(driver.driver_number)}</span>
                        <span class="constructor-driver-copy">
                            <strong>${escapeHtml(driver.first_name)} ${escapeHtml(driver.last_name)}</strong>
                            <small>${escapeHtml(driver.name_acronym || '')}</small>
                        </span>
                        <img src="${safeUrl(headshot.replace('.transform/1col/image.png', ''))}" alt="" aria-hidden="true">
                        <span class="material-icons-round constructor-driver-arrow" aria-hidden="true">arrow_forward</span>
                    </button>
                `;
            }).join('') : `
                <div class="constructor-lineup-empty">
                    <span class="material-icons-round" aria-hidden="true">person_off</span>
                    No session drivers matched this constructor.
                </div>
            `}
        </div>
        <footer class="constructor-card-footer">
            <span>${group.drivers.length} ${group.drivers.length === 1 ? 'driver' : 'drivers'} in this session</span>
            <span>Constructor profile</span>
        </footer>
    `;

    card.querySelectorAll('.constructor-driver').forEach((button) => {
        button.addEventListener('click', () => openDriverAnalysis(Number(button.dataset.driverNumber)));
    });
    return card;
}

function createDriverCard(driver, constructor) {
    const teamHex = getDriverTeamHex(driver);
    const rgb = getRGBColor(teamHex);
    const headshot = driver.headshot_url || 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/';
    const age = calculateAgeAtDate(driver.birthday, state.selectedSession ? state.selectedSession.date_start : null);
    const card = document.createElement('article');
    card.className = 'driver-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open lap analysis for ${driver.full_name || driver.name_acronym || driver.driver_number}`);
    card.style.setProperty('--team-color', `#${teamHex}`);
    card.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.22)`);
    card.innerHTML = `
        <div class="driver-card-glow" aria-hidden="true"></div>
        <div class="driver-card-top">
            <div class="driver-info">
                <div class="driver-team">${escapeHtml((constructor && constructor.name) || driver.team_name || 'Independent')}</div>
                <div class="driver-name"><span>${escapeHtml(driver.first_name || '')}</span> ${escapeHtml(driver.last_name || '')}</div>
                <div class="driver-acronym">${escapeHtml(driver.name_acronym || '')}</div>
                <div class="driver-meta">
                    ${driver.nationality ? `<span class="driver-flag" title="${escapeHtml(driver.nationality)}">${getNationalityFlag(driver.nationality)}</span>` : ''}
                    ${age ? `<span class="driver-age">${age} yrs</span>` : ''}
                </div>
            </div>
            <div class="driver-number-badge">${escapeHtml(driver.driver_number)}</div>
        </div>
        <div class="driver-watermark-number">${escapeHtml(driver.driver_number)}</div>
        <div class="driver-headshot-container">
            <img src="${safeUrl(headshot.replace('.transform/1col/image.png', ''))}" class="driver-headshot" alt="${escapeHtml(driver.full_name || '')}">
        </div>
        <div class="driver-card-footer">
            <span>Open lap analysis</span>
            <span class="material-icons-round" aria-hidden="true">arrow_forward</span>
        </div>
    `;

    const activate = () => openDriverAnalysis(driver.driver_number);
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (event) => {
        if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        activate();
    });
    return card;
}

// Render the constructor roster or individual driver grid
function renderDriversGrid() {
    if (!DOM.driversGrid) return;
    const filter = DOM.driverSearch ? DOM.driverSearch.value.toLowerCase().trim() : '';
    const groups = buildConstructorGroups();
    updateDriversSummary(groups);

    const teamsMode = state.driversViewMode !== 'drivers';
    if (DOM.driversViewTitle) DOM.driversViewTitle.textContent = teamsMode ? 'Constructor roster' : 'Driver lineup';
    DOM.driversGrid.classList.toggle('constructor-grid', teamsMode);
    DOM.driversGrid.classList.toggle('driver-grid', !teamsMode);
    DOM.driversGrid.innerHTML = '';

    if (teamsMode) {
        const filteredGroups = groups.filter((group) => (
            [group.constructor.name, group.constructor.constructorId, group.constructor.nationality]
                .some(value => String(value || '').toLowerCase().includes(filter)) ||
            group.drivers.some(driver => driverMatchesPaddockFilter(driver, group.constructor, filter))
        ));
        if (DOM.driversVisibleCount) {
            DOM.driversVisibleCount.textContent = `${filteredGroups.length} of ${groups.length} constructors shown`;
        }
        if (!filteredGroups.length) {
            renderDriversEmptyState('Try another driver, constructor, or nationality.');
            return;
        }
        filteredGroups.forEach(group => DOM.driversGrid.appendChild(createConstructorCard(group)));
        return;
    }

    const constructors = getConstructorRosterItems();
    const filteredDrivers = state.drivers.filter((driver) => (
        driverMatchesPaddockFilter(driver, findConstructorForDriver(driver, constructors), filter)
    ));
    if (DOM.driversVisibleCount) {
        DOM.driversVisibleCount.textContent = `${filteredDrivers.length} of ${state.drivers.length} drivers shown`;
    }
    if (!filteredDrivers.length) {
        renderDriversEmptyState('Try another driver number, team, or nationality.');
        return;
    }
    filteredDrivers.forEach((driver) => {
        DOM.driversGrid.appendChild(createDriverCard(driver, findConstructorForDriver(driver, constructors)));
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
