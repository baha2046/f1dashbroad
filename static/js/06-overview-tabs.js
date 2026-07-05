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

function isFiniteWeatherValue(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function formatWeatherValue(value, unit, decimals) {
    if (!isFiniteWeatherValue(value)) return `-- ${unit}`;
    return `${Number(value).toFixed(decimals)} ${unit}`;
}

function buildWeatherTrendSeries(samples, limit = 24) {
    const sorted = (Array.isArray(samples) ? samples : [])
        .slice()
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const recent = sorted.slice(-limit);
    const latestSample = recent[recent.length - 1] || {};

    const valueList = (field) => recent
        .map(sample => sample[field])
        .filter(isFiniteWeatherValue)
        .map(Number);
    const rainValues = recent.map(sample => Number(sample.rainfall) === 1 ? 1 : 0);

    return {
        air: {
            label: 'Air',
            unit: '°C',
            className: 'air',
            values: valueList('air_temperature'),
        },
        track: {
            label: 'Track',
            unit: '°C',
            className: 'track',
            values: valueList('track_temperature'),
        },
        wind: {
            label: 'Wind',
            unit: 'm/s',
            className: 'wind',
            values: valueList('wind_speed'),
        },
        rain: {
            label: 'Rain',
            unit: '',
            className: 'rain',
            values: rainValues,
        },
        latest: {
            air: isFiniteWeatherValue(latestSample.air_temperature) ? Number(latestSample.air_temperature) : null,
            track: isFiniteWeatherValue(latestSample.track_temperature) ? Number(latestSample.track_temperature) : null,
            humidity: isFiniteWeatherValue(latestSample.humidity) ? Number(latestSample.humidity) : null,
            wind: isFiniteWeatherValue(latestSample.wind_speed) ? Number(latestSample.wind_speed) : null,
            rain: Number(latestSample.rainfall) === 1 ? 1 : 0,
        },
        sampleCount: recent.length,
        rainDetected: rainValues.some(value => value === 1),
    };
}

function buildWeatherSparklinePoints(values, width = 132, height = 38) {
    const finiteValues = (values || []).filter(isFiniteWeatherValue).map(Number);
    if (finiteValues.length === 0) return '';
    if (finiteValues.length === 1) {
        const y = height / 2;
        return `0,${y.toFixed(1)} ${width},${y.toFixed(1)}`;
    }

    const min = Math.min(...finiteValues);
    const max = Math.max(...finiteValues);
    const range = max - min;
    const step = width / (finiteValues.length - 1);

    return finiteValues.map((value, index) => {
        const normalized = range === 0 ? 0.5 : (value - min) / range;
        const x = index * step;
        const y = height - (normalized * (height - 6)) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
}

function renderWeatherTrendCard(series, latestLabel) {
    const points = buildWeatherSparklinePoints(series.values);
    const min = series.values.length ? Math.min(...series.values) : null;
    const max = series.values.length ? Math.max(...series.values) : null;
    const rangeLabel = isFiniteWeatherValue(min) && isFiniteWeatherValue(max)
        ? `${Number(min).toFixed(series.unit === 'm/s' ? 1 : 0)}-${Number(max).toFixed(series.unit === 'm/s' ? 1 : 0)}${series.unit}`
        : 'No data';

    if (series.className === 'rain') {
        const markers = series.values.map(value => (
            `<span class="${value === 1 ? 'wet' : ''}" aria-hidden="true"></span>`
        )).join('');
        return `
            <div class="weather-trend-card weather-trend-rain">
                <div class="weather-trend-head">
                    <span>${series.label}</span>
                    <strong>${latestLabel}</strong>
                </div>
                <div class="weather-rain-markers">${markers}</div>
                <small>${series.values.some(value => value === 1) ? 'Rain in recent samples' : 'Dry recent samples'}</small>
            </div>
        `;
    }

    return `
        <div class="weather-trend-card">
            <div class="weather-trend-head">
                <span>${series.label}</span>
                <strong>${latestLabel}</strong>
            </div>
            <svg class="weather-sparkline weather-sparkline-${series.className}" viewBox="0 0 132 38" role="img" aria-label="${series.label} recent trend">
                <polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"></polyline>
            </svg>
            <small>${rangeLabel}</small>
        </div>
    `;
}

function renderWeatherTrendChart(trends) {
    if (!DOM.weatherTrendChart) return;
    if (!trends || trends.sampleCount === 0) {
        DOM.weatherTrendChart.innerHTML = '<div class="weather-trend-empty">No recent weather samples.</div>';
        return;
    }

    DOM.weatherTrendChart.innerHTML = [
        renderWeatherTrendCard(trends.air, formatWeatherValue(trends.latest.air, '°C', 1)),
        renderWeatherTrendCard(trends.track, formatWeatherValue(trends.latest.track, '°C', 1)),
        renderWeatherTrendCard(trends.wind, formatWeatherValue(trends.latest.wind, 'm/s', 1)),
        renderWeatherTrendCard(trends.rain, trends.latest.rain === 1 ? 'Wet' : 'Dry'),
    ].join('');
}

// Render Weather Widget
function renderWeather() {
    const trends = buildWeatherTrendSeries(state.weather);
    if (trends.sampleCount === 0) {
        DOM.weatherAirTemp.textContent = '-- °C';
        DOM.weatherTrackTemp.textContent = '-- °C';
        DOM.weatherHumidity.textContent = '-- %';
        DOM.weatherWind.textContent = '-- m/s';
        DOM.weatherRainfall.style.display = 'none';
        renderWeatherTrendChart(trends);
        return;
    }

    DOM.weatherAirTemp.textContent = formatWeatherValue(trends.latest.air, '°C', 1);
    DOM.weatherTrackTemp.textContent = formatWeatherValue(trends.latest.track, '°C', 1);
    DOM.weatherHumidity.textContent = formatWeatherValue(trends.latest.humidity, '%', 0);
    DOM.weatherWind.textContent = formatWeatherValue(trends.latest.wind, 'm/s', 1);
    DOM.weatherRainfall.style.display = trends.rainDetected ? 'flex' : 'none';
    renderWeatherTrendChart(trends);
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

    // Qualifying results carry per-segment arrays: duration/gap_to_leader = [Q1, Q2, Q3]
    const isQualiResults = isQualifyingSession(state.selectedSession) &&
        state.results.some(item => Array.isArray(item.duration));
    const isSprintQuali = isQualiResults &&
        [state.selectedSession.session_type, state.selectedSession.session_name].some(value => (
            String(value || '').toLowerCase().includes('sprint')
        ));
    const segmentLabels = isSprintQuali ? ['SQ1', 'SQ2', 'SQ3'] : ['Q1', 'Q2', 'Q3'];

    const resultsTable = DOM.resultsTableHeadRow ? DOM.resultsTableHeadRow.closest('table') : null;
    if (resultsTable) resultsTable.classList.toggle('quali-results', isQualiResults);

    if (DOM.resultsTableHeadRow) {
        DOM.resultsTableHeadRow.innerHTML = isQualiResults
            ? `
                <th class="results-position-cell">Pos</th>
                <th>Driver</th>
                <th>Laps</th>
                <th>${segmentLabels[0]}</th>
                <th>${segmentLabels[1]}</th>
                <th>${segmentLabels[2]}</th>
                <th>Status</th>
            `
            : `
                <th class="results-position-cell">Pos</th>
                <th>Driver</th>
                <th>Laps</th>
                <th>Time / Gap</th>
                <th>Status</th>
                <th>Points</th>
            `;
    }

    const segmentBest = [null, null, null];
    if (isQualiResults) {
        state.results.forEach((item) => {
            if (!Array.isArray(item.duration)) return;
            item.duration.forEach((t, i) => {
                const value = Number(t);
                if (Number.isFinite(value) && value > 0 && (segmentBest[i] === null || value < segmentBest[i])) {
                    segmentBest[i] = value;
                }
            });
        });
    }

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
            } else if (isQualiResults) {
                const segmentsRun = Array.isArray(item.duration)
                    ? item.duration.filter(t => Number.isFinite(Number(t)) && Number(t) > 0).length
                    : 0;
                if (segmentsRun >= 3) {
                    statusText = `Reached ${segmentLabels[2]}`;
                } else if (segmentsRun > 0) {
                    statusText = `Eliminated in ${segmentLabels[segmentsRun - 1]}`;
                }
            }

            let timingCells = '';
            if (isQualiResults) {
                const durations = Array.isArray(item.duration) ? item.duration : [];
                const gaps = Array.isArray(item.gap_to_leader) ? item.gap_to_leader : [];
                timingCells = [0, 1, 2].map((i) => {
                    const time = Number(durations[i]);
                    if (!Number.isFinite(time) || time <= 0) {
                        return '<td class="quali-seg-cell quali-seg-out">--</td>';
                    }
                    const isBest = segmentBest[i] !== null && time === segmentBest[i];
                    const gap = Number(gaps[i]);
                    const gapHtml = Number.isFinite(gap) && gap > 0
                        ? `<span class="quali-seg-gap">+${gap.toFixed(3)}</span>`
                        : '';
                    return `<td class="quali-seg-cell"><span class="lap-duration-val${isBest ? ' fastest-lap-highlight' : ''}">${formatLapTime(time)}</span>${gapHtml}</td>`;
                }).join('');
            } else {
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
                timingCells = `<td class="lap-duration-val">${timeGapDisplay}</td>`;
            }

            const pointsCell = isQualiResults
                ? ''
                : `<td style="font-weight: 600; color: ${item.points > 0 ? 'var(--text-primary)' : 'var(--text-muted)'};">${item.points && true ? item.points : '-'}</td>`;

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
                ${timingCells}
                <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                ${pointsCell}
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

// Jolpica constructor names ("RB F1 Team", "Alpine F1 Team") don't always
// match the OpenF1-style TEAM_COLORS keys, so fall back progressively.
function getProgressionTeamHex(series) {
    const raw = (series.team || '').toLowerCase();
    if (TEAM_COLORS[raw]) return TEAM_COLORS[raw];
    const stripped = raw.replace(/\s*f1 team$/, '').trim();
    if (TEAM_COLORS[stripped]) return TEAM_COLORS[stripped];
    const partialKey = Object.keys(TEAM_COLORS).find(key => raw.includes(key));
    return partialKey ? TEAM_COLORS[partialKey] : '787878';
}

function getProgressionEndLabel(series) {
    if (series.code) return series.code;
    return (series.name || '').replace(/\s*F1 Team$/i, '');
}

function getProgressionSeriesList() {
    const data = state.seasonProgression;
    if (!data) return [];
    const list = state.progressionView === 'constructors' ? data.constructors : data.drivers;
    return Array.isArray(list) ? list : [];
}

function renderChampionshipProgressionChart() {
    const wrapper = DOM.progressionWrapper;
    const container = DOM.progressionChartContainer;
    if (!wrapper || !container) return;

    const data = state.seasonProgression;
    const rounds = data && Array.isArray(data.rounds) ? data.rounds : [];
    const seriesList = getProgressionSeriesList();
    const sessionEligible = state.selectedSession && isRaceStandingsSession(state.selectedSession);

    if (!sessionEligible || !rounds.length || !seriesList.length) {
        wrapper.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    wrapper.style.display = 'block';
    if (DOM.progressionSummary) {
        const roundLabel = rounds.length === 1 ? '1 round' : `${rounds.length} rounds`;
        DOM.progressionSummary.textContent = `${data.season} season — cumulative points after ${roundLabel}`;
    }
    if (DOM.progressionDriversBtn && DOM.progressionConstructorsBtn) {
        DOM.progressionDriversBtn.classList.toggle('active', state.progressionView !== 'constructors');
        DOM.progressionConstructorsBtn.classList.toggle('active', state.progressionView === 'constructors');
    }

    container.innerHTML = '';
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const width = 900;
    const height = 420;
    const padding = { top: 24, right: 96, bottom: 40, left: 52 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const allPoints = seriesList.flatMap(series => series.points.filter(value => value !== null && value !== undefined));
    const maxPoints = Math.max(...allPoints, 1);

    const getX = index => rounds.length === 1
        ? padding.left + chartWidth / 2
        : padding.left + (index / (rounds.length - 1)) * chartWidth;
    const getY = value => padding.top + chartHeight - (value / maxPoints) * chartHeight;

    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.classList.add('progression-chart');

    // Horizontal gridlines with point labels
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
        const value = (maxPoints / tickCount) * i;
        const y = getY(value);
        const gridLine = document.createElementNS(svgNamespace, 'line');
        gridLine.setAttribute('x1', padding.left);
        gridLine.setAttribute('x2', width - padding.right);
        gridLine.setAttribute('y1', y);
        gridLine.setAttribute('y2', y);
        gridLine.classList.add('progression-grid-line');
        svg.appendChild(gridLine);

        const label = document.createElementNS(svgNamespace, 'text');
        label.setAttribute('x', padding.left - 8);
        label.setAttribute('y', y + 4);
        label.setAttribute('text-anchor', 'end');
        label.classList.add('progression-axis-label');
        label.textContent = Math.round(value);
        svg.appendChild(label);
    }

    // X axis: round numbers, thinned to at most ~12 labels
    const labelStep = Math.max(1, Math.ceil(rounds.length / 12));
    rounds.forEach((round, index) => {
        if (index % labelStep !== 0 && index !== rounds.length - 1) return;
        const label = document.createElementNS(svgNamespace, 'text');
        label.setAttribute('x', getX(index));
        label.setAttribute('y', height - 12);
        label.setAttribute('text-anchor', 'middle');
        label.classList.add('progression-axis-label');
        label.textContent = `R${round.round}`;
        svg.appendChild(label);
    });

    // Draw from last place to leader so leaders end up on top; dash the
    // second entrant per team so teammates stay distinguishable.
    const teamLineCount = {};
    seriesList.forEach(series => {
        const key = (series.team || series.id || '').toLowerCase();
        teamLineCount[key] = (teamLineCount[key] || 0) + 1;
        series._dashed = teamLineCount[key] > 1;
    });

    [...seriesList].reverse().forEach(series => {
        const hex = getProgressionTeamHex(series);
        let pathData = '';
        series.points.forEach((value, index) => {
            if (value === null || value === undefined) return;
            pathData += `${pathData ? ' L' : 'M'} ${getX(index).toFixed(1)} ${getY(value).toFixed(1)}`;
        });
        if (!pathData) return;

        const path = document.createElementNS(svgNamespace, 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', `#${hex}`);
        path.classList.add('progression-line');
        if (series._dashed) path.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(path);

        series.points.forEach((value, index) => {
            if (value === null || value === undefined) return;
            const dot = document.createElementNS(svgNamespace, 'circle');
            dot.setAttribute('cx', getX(index).toFixed(1));
            dot.setAttribute('cy', getY(value).toFixed(1));
            dot.setAttribute('r', 3);
            dot.setAttribute('fill', `#${hex}`);
            dot.classList.add('progression-dot');
            const title = document.createElementNS(svgNamespace, 'title');
            const position = series.positions[index];
            title.textContent = `${series.name} — ${rounds[index].race_name}: ${value} pts${position ? ` (P${position})` : ''}`;
            dot.appendChild(title);
            svg.appendChild(dot);
        });
    });

    // End-of-line labels for the current top 5
    seriesList.slice(0, 5).forEach(series => {
        let lastIndex = -1;
        for (let i = series.points.length - 1; i >= 0; i--) {
            if (series.points[i] !== null && series.points[i] !== undefined) { lastIndex = i; break; }
        }
        if (lastIndex < 0) return;
        const label = document.createElementNS(svgNamespace, 'text');
        label.setAttribute('x', getX(lastIndex) + 8);
        label.setAttribute('y', getY(series.points[lastIndex]) + 4);
        label.setAttribute('fill', `#${getProgressionTeamHex(series)}`);
        label.classList.add('progression-end-label');
        label.textContent = getProgressionEndLabel(series);
        svg.appendChild(label);
    });

    container.appendChild(svg);
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

function formatDriversInMessage(messageText) {
    let escaped = escapeHtml(messageText || '');
    // Regex to match e.g. CAR 12 (ANT) or CARS 11 (PER) or 30 (LAW)
    const regex = /(?:CAR(?:S)?\s+)?(\d+)\s*\(([A-Z]{3})\)/gi;
    return escaped.replace(regex, (match, driverNumStr, acronym) => {
        const num = parseInt(driverNumStr, 10);
        const driver = state.drivers ? state.drivers.find(d => d.driver_number === num || (d.name_acronym || '').toUpperCase() === acronym.toUpperCase()) : null;
        if (driver) {
            const teamHex = getDriverTeamHex(driver);
            const fullName = `${driver.first_name || ''} ${driver.last_name || driver.broadcast_name || ''}`.trim();
            const rgb = getRGBColor(teamHex);
            return `<span class="driver-inline-pill" style="--team-color: #${teamHex}; --team-color-rgb: ${rgb};">` +
                   `<span class="driver-pill-name">${escapeHtml(fullName)}</span>` +
                   `<span class="driver-pill-number">#${num}</span>` +
                   `</span>`;
        }
        return match;
    });
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

    // Group contiguous messages by lap
    const groups = [];
    let currentGroup = null;

    sortedMessages.forEach((item) => {
        const lap = (item.lap_number !== null && item.lap_number !== undefined) ? item.lap_number : null;
        if (!currentGroup || currentGroup.lap !== lap) {
            currentGroup = {
                lap: lap,
                messages: []
            };
            groups.push(currentGroup);
        }
        currentGroup.messages.push(item);
    });

    DOM.raceControlFeed.innerHTML = groups.map(group => {
        let groupTitle = '';
        let groupClass = '';
        if (group.lap === null) {
            groupTitle = 'General Notices';
            groupClass = 'race-control-group-general';
        } else {
            groupTitle = `Lap ${group.lap}`;
            groupClass = 'race-control-group-lap';
        }

        const messagesHtml = group.messages.map(item => {
            const typeLabel = getRaceControlType(item);
            const typeClass = getRaceControlClass(typeLabel);
            const driver = item.driver_number ? state.drivers.find(d => d.driver_number === item.driver_number) : null;
            
            let driverLabel = '';
            let driverColorBar = '';
            let driverPillClass = '';
            
            if (driver) {
                const teamHex = getDriverTeamHex(driver);
                driverLabel = `${driver.first_name || ''} ${driver.last_name || driver.broadcast_name || ''}`.trim();
                driverColorBar = `<span class="driver-pill-dot" style="background: #${teamHex};"></span>`;
                driverPillClass = 'has-driver';
            } else if (item.driver_number) {
                driverLabel = `Car ${item.driver_number}`;
            }

            const metaItems = [
                driverLabel ? `<span class="race-control-meta-pill ${driverPillClass}">${driverColorBar}${escapeHtml(driverLabel)}</span>` : '',
                item.scope ? `<span class="race-control-meta-pill">${escapeHtml(item.scope)}</span>` : '',
                item.sector !== null && item.sector !== undefined ? `<span class="race-control-meta-pill">Sector ${escapeHtml(item.sector)}</span>` : ''
            ].filter(Boolean);

            const parsedMessage = formatDriversInMessage(item.message || 'Race control notice');

            return `
                <article class="race-control-item">
                    <div class="race-control-time">${escapeHtml(formatRaceControlTime(item.date))}</div>
                    <div class="race-control-main">
                        <div class="race-control-row">
                            <span class="race-control-type ${typeClass}">${escapeHtml(typeLabel)}</span>
                            <div class="race-control-meta">
                                ${metaItems.join('')}
                            </div>
                        </div>
                        <p class="race-control-message">${parsedMessage}</p>
                    </div>
                </article>
            `;
        }).join('');

        return `
            <div class="race-control-group">
                <header class="race-control-group-header ${groupClass}">
                    <span class="race-control-group-title">${groupTitle}</span>
                </header>
                <div class="race-control-group-items">
                    ${messagesHtml}
                </div>
            </div>
        `;
    }).join('');
}
