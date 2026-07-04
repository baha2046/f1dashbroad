// Render session header
function renderSessionHeader() {
    const s = state.selectedSession;
    if (!s) return;
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

function formatStandingNumber(value) {
    if (value === null || value === undefined || value === '') return '-';
    return value;
}

const NATIONALITY_TO_FLAG = {
    'argentina': '🇦🇷', 'argentinian': '🇦🇷', 'argentine': '🇦🇷',
    'australia': '🇦🇺', 'australian': '🇦🇺',
    'austria': '🇦🇹', 'austrian': '🇦🇹',
    'azerbaijan': '🇦🇿', 'azerbaijani': '🇦🇿',
    'belgium': '🇧🇪', 'belgian': '🇧🇪',
    'brazil': '🇧🇷', 'brazilian': '🇧🇷',
    'bahrain': '🇧🇭', 'bahraini': '🇧🇭',
    'canada': '🇨🇦', 'canadian': '🇨🇦',
    'china': '🇨🇳', 'chinese': '🇨🇳',
    'denmark': '🇩🇰', 'danish': '🇩🇰',
    'finland': '🇫🇮', 'finnish': '🇫🇮',
    'france': '🇫🇷', 'french': '🇫🇷',
    'germany': '🇩🇪', 'german': '🇩🇪',
    'great britain': '🇬🇧', 'british': '🇬🇧',
    'italy': '🇮🇹', 'italian': '🇮🇹',
    'japan': '🇯🇵', 'japanese': '🇯🇵',
    'mexico': '🇲🇽', 'mexican': '🇲🇽',
    'monaco': '🇲🇨', 'monegasque': '🇲🇨',
    'netherlands': '🇳🇱', 'dutch': '🇳🇱',
    'new zealand': '🇳🇿', 'new zealander': '🇳🇿',
    'spain': '🇪🇸', 'spanish': '🇪🇸',
    'thailand': '🇹🇭', 'thai': '🇹🇭',
    'united states': '🇺🇸', 'american': '🇺🇸',
    'switzerland': '🇨🇭', 'swiss': '🇨🇭',
    'sweden': '🇸🇪', 'swedish': '🇸🇪',
    'poland': '🇵🇱', 'polish': '🇵🇱',
    'russia': '🇷🇺', 'russian': '🇷🇺',
    'india': '🇮🇳', 'indian': '🇮🇳',
    'venezuela': '🇻🇪', 'venezuelan': '🇻🇪',
    'indonesia': '🇮🇩', 'indonesian': '🇮🇩',
    'colombia': '🇨🇴', 'colombian': '🇨🇴'
};

function getNationalityFlag(nationality) {
    if (!nationality) return '🏳️';
    const norm = nationality.trim().toLowerCase();
    return NATIONALITY_TO_FLAG[norm] || '🏳️';
}

function findDriver(standingItem) {
    const driver = standingItem.Driver || {};
    const permNum = parseInt(driver.permanentNumber);
    const code = (driver.code || '').toUpperCase();
    const familyName = (driver.familyName || '').toLowerCase();
    
    if (permNum && state.drivers) {
        const found = state.drivers.find(d => d.driver_number === permNum);
        if (found) return found;
    }
    if (code && state.drivers) {
        const found = state.drivers.find(d => (d.name_acronym || '').toUpperCase() === code);
        if (found) return found;
    }
    if (familyName && state.drivers) {
        const found = state.drivers.find(d => (d.last_name || '').toLowerCase() === familyName);
        if (found) return found;
    }
    return null;
}

function renderRaceStandingsTables() {
    const standings = state.raceStandings;
    const driverStandings = standings && Array.isArray(standings.driver_standings)
        ? standings.driver_standings
        : [];
    const constructorStandings = standings && Array.isArray(standings.constructor_standings)
        ? standings.constructor_standings
        : [];

    if (!standings || (!driverStandings.length && !constructorStandings.length)) {
        if (DOM.raceStandingsWrapper) DOM.raceStandingsWrapper.style.display = 'none';
        if (DOM.driverStandingsTableBody) DOM.driverStandingsTableBody.innerHTML = '';
        if (DOM.constructorStandingsTableBody) DOM.constructorStandingsTableBody.innerHTML = '';
        return;
    }

    if (DOM.raceStandingsWrapper) DOM.raceStandingsWrapper.style.display = 'block';
    if (DOM.raceStandingsSummary) {
        const roundLabel = standings.round ? `Round ${standings.round}` : 'Selected round';
        const raceLabel = standings.race_name ? ` - ${standings.race_name}` : '';
        DOM.raceStandingsSummary.textContent = `${standings.season || state.selectedYear} ${roundLabel}${raceLabel}`;
    }

    if (DOM.driverStandingsTableBody) {
        DOM.driverStandingsTableBody.innerHTML = driverStandings.map((item) => {
            const driver = item.Driver || {};
            const constructors = Array.isArray(item.Constructors) ? item.Constructors : [];
            const constructorName = constructors[0] ? constructors[0].name : '-';
            const constructorId = constructors[0] ? constructors[0].constructorId : '';
            
            const localDriver = findDriver(item);
            
            let teamHex = '';
            if (localDriver && localDriver.team_colour) {
                teamHex = localDriver.team_colour;
            } else {
                const teamNameLower = (constructorName || '').toLowerCase();
                const teamIdLower = (constructorId || '').toLowerCase();
                teamHex = TEAM_COLORS[teamNameLower] || TEAM_COLORS[teamIdLower] || '787878';
            }
            teamHex = teamHex.replace('#', '');
            
            const driverName = [driver.givenName, driver.familyName].filter(Boolean).join(' ') || driver.code || '-';
            
            let avatarUrl = 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/';
            if (localDriver && localDriver.headshot_url) {
                avatarUrl = localDriver.headshot_url.replace('.transform/1col/image.png', '');
            }
            
            const position = parseInt(item.position);
            let posClass = 'pos-non-podium';
            if (position === 1) posClass = 'pos-podium-1';
            else if (position === 2) posClass = 'pos-podium-2';
            else if (position === 3) posClass = 'pos-podium-3';
            
            const wins = parseInt(item.wins) || 0;
            const winsDisplay = wins > 0 
                ? `${wins} <span class="material-icons-round" style="font-size: 14px; color: #FFD700; vertical-align: middle; margin-left: 2px;">emoji_events</span>`
                : `<span style="color: var(--text-muted);">${wins}</span>`;

            return `
                <tr>
                    <td class="results-position-cell ${posClass}">${escapeHtml(item.positionText || item.position || '-')}</td>
                    <td>
                        <div class="results-driver-cell">
                            <div class="results-team-color-indicator" style="background: #${teamHex};"></div>
                            <img src="${avatarUrl}" class="results-driver-avatar" alt="${driverName}" onerror="this.src='https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/'">
                            <div class="results-driver-info">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="results-driver-name">${driverName}</span>
                                    <span class="standings-code" style="padding: 1px 4px; min-width: auto; font-size: 9px; line-height: 1.2;">${escapeHtml(driver.code || '--')}</span>
                                </div>
                                <div class="results-driver-team">${escapeHtml(constructorName)}</div>
                            </div>
                        </div>
                    </td>
                    <td>${winsDisplay}</td>
                    <td class="standings-points">${escapeHtml(formatStandingNumber(item.points))}</td>
                </tr>
            `;
        }).join('');
    }

    if (DOM.constructorStandingsTableBody) {
        DOM.constructorStandingsTableBody.innerHTML = constructorStandings.map((item) => {
            const constructor = item.Constructor || {};
            const constructorName = constructor.name || '-';
            const constructorId = constructor.constructorId || '';
            const nationality = constructor.nationality || '';
            
            const teamNameLower = (constructorName || '').toLowerCase();
            const teamIdLower = (constructorId || '').toLowerCase();
            let teamHex = TEAM_COLORS[teamNameLower] || TEAM_COLORS[teamIdLower];
            
            if (!teamHex && state.drivers) {
                const matchingDriver = state.drivers.find(d => (d.team_name || '').toLowerCase() === teamNameLower);
                if (matchingDriver && matchingDriver.team_colour) {
                    teamHex = matchingDriver.team_colour;
                }
            }
            if (!teamHex) teamHex = '787878';
            teamHex = teamHex.replace('#', '');
            
            const flag = getNationalityFlag(nationality);
            
            const position = parseInt(item.position);
            let posClass = 'pos-non-podium';
            if (position === 1) posClass = 'pos-podium-1';
            else if (position === 2) posClass = 'pos-podium-2';
            else if (position === 3) posClass = 'pos-podium-3';
            
            const wins = parseInt(item.wins) || 0;
            const winsDisplay = wins > 0 
                ? `${wins} <span class="material-icons-round" style="font-size: 14px; color: #FFD700; vertical-align: middle; margin-left: 2px;">emoji_events</span>`
                : `<span style="color: var(--text-muted);">${wins}</span>`;

            return `
                <tr>
                    <td class="results-position-cell ${posClass}">${escapeHtml(item.positionText || item.position || '-')}</td>
                    <td>
                        <div class="results-driver-cell">
                            <div class="results-team-color-indicator" style="background: #${teamHex};"></div>
                            <div class="results-driver-info">
                                <span class="results-driver-name" style="font-weight: 600; font-size: 13px;">${escapeHtml(constructorName)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="margin-right: 6px; font-size: 14px;">${flag}</span>
                        <span>${escapeHtml(nationality)}</span>
                    </td>
                    <td>${winsDisplay}</td>
                    <td class="standings-points">${escapeHtml(formatStandingNumber(item.points))}</td>
                </tr>
            `;
        }).join('');
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

    const showBlueFlags = DOM.showBlueFlags ? DOM.showBlueFlags.checked : true;
    let filteredMessages = [...state.raceControl];
    if (!showBlueFlags) {
        filteredMessages = filteredMessages.filter(item => getRaceControlType(item) !== 'BLUE');
    }

    if (filteredMessages.length === 0) {
        DOM.raceControlFeed.style.display = 'none';
        DOM.raceControlEmptyState.style.display = 'flex';
        if (DOM.raceControlSummary) {
            DOM.raceControlSummary.textContent = 'No session messages recorded (excluding blue flags)';
        }
        return;
    }

    DOM.raceControlEmptyState.style.display = 'none';
    DOM.raceControlFeed.style.display = 'flex';

    const sortedMessages = filteredMessages.sort((a, b) => {
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

