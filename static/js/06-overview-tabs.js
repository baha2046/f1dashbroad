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
        const status = getLiveSessionStatus(s);
        headerStatusBadge.textContent = status.text;
        headerStatusBadge.className = `status-badge ${status.className}`;
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

function formatCircuitEventDate(value, gmtOffset) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '--';
    const offsetMatch = String(gmtOffset || '').match(/^(-)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const offsetMs = offsetMatch
        ? (offsetMatch[1] ? -1 : 1) * (
            Number(offsetMatch[2]) * 3600 + Number(offsetMatch[3]) * 60 + Number(offsetMatch[4] || 0)
        ) * 1000
        : 0;
    const trackLocalDate = new Date(date.getTime() + offsetMs);
    return trackLocalDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
    });
}

function circuitTrackDirection(trackPoints) {
    if (!Array.isArray(trackPoints) || trackPoints.length < 3) return '--';
    let signedArea = 0;
    trackPoints.forEach(([x, y], index) => {
        const [nextX, nextY] = trackPoints[(index + 1) % trackPoints.length];
        signedArea += x * nextY - nextX * y;
    });
    return signedArea <= 0 ? 'Clockwise' : 'Anti-clockwise';
}

function buildCircuitSectorBenchmarks(laps, drivers) {
    const best = [null, null, null];
    (Array.isArray(laps) ? laps : []).forEach((lap) => {
        for (let sectorIndex = 0; sectorIndex < 3; sectorIndex += 1) {
            const time = Number(lap[`duration_sector_${sectorIndex + 1}`]);
            if (!Number.isFinite(time) || time <= 0) continue;
            if (!best[sectorIndex] || time < best[sectorIndex].time) {
                const driverNumber = Number(lap.driver_number);
                const driver = (Array.isArray(drivers) ? drivers : []).find(item => (
                    Number(item.driver_number) === driverNumber
                ));
                best[sectorIndex] = {
                    time,
                    driverNumber,
                    lapNumber: Number(lap.lap_number),
                    acronym: driver && driver.name_acronym ? driver.name_acronym : `#${driverNumber}`,
                    driverName: driver && driver.full_name ? driver.full_name : `Driver #${driverNumber}`,
                    teamHex: getDriverTeamHex(driver)
                };
            }
        }
    });
    return best;
}

function renderCircuitSectorBenchmarks(laps = state.allSessionLaps, loading = false) {
    if (!DOM.circuitSectorBenchmarks) return;
    if (loading) {
        DOM.circuitSectorBenchmarks.innerHTML = [1, 2, 3].map(sector => `
            <div class="circuit-sector-benchmark sector-${sector} is-loading">
                <span class="sector-benchmark-index">S${sector}</span>
                <div>
                    <span class="circuit-benchmark-skeleton"></span>
                    <small>Scanning lap data...</small>
                </div>
            </div>
        `).join('');
        return;
    }

    const benchmarks = buildCircuitSectorBenchmarks(laps, state.drivers);
    DOM.circuitSectorBenchmarks.innerHTML = benchmarks.map((benchmark, index) => {
        const sector = index + 1;
        if (!benchmark) {
            return `
                <div class="circuit-sector-benchmark sector-${sector} is-empty">
                    <span class="sector-benchmark-index">S${sector}</span>
                    <div>
                        <strong>--</strong>
                        <small>No recorded split</small>
                    </div>
                </div>
            `;
        }
        const lapLabel = Number.isFinite(benchmark.lapNumber) ? ` · Lap ${benchmark.lapNumber}` : '';
        return `
            <div class="circuit-sector-benchmark sector-${sector}" style="--benchmark-driver-rgb:${getRGBColor(benchmark.teamHex)}">
                <span class="sector-benchmark-index">S${sector}</span>
                <div>
                    <strong>${benchmark.time.toFixed(3)}<small>s</small></strong>
                    <span title="${escapeHtml(benchmark.driverName)}">${escapeHtml(benchmark.acronym)}${lapLabel}</span>
                </div>
            </div>
        `;
    }).join('');
}

let circuitSectorLoadSequence = 0;

async function maybeLoadCircuitSectorBenchmarks() {
    if (!(state.currentTab === 'circuit-view' && state.selectedSession)) return;
    if (Array.isArray(state.allSessionLaps)) {
        renderCircuitSectorBenchmarks(state.allSessionLaps);
        return;
    }

    const requestId = ++circuitSectorLoadSequence;
    const sessionKey = Number(state.selectedSession.session_key);
    renderCircuitSectorBenchmarks(null, true);
    const laps = await fetchAllSessionLaps(sessionKey);
    if (
        requestId !== circuitSectorLoadSequence ||
        !state.selectedSession ||
        Number(state.selectedSession.session_key) !== sessionKey
    ) return;
    renderCircuitSectorBenchmarks(laps);
}

function updateCircuitMapStatus(icon, title, text) {
    if (DOM.circuitMapStatusIcon) DOM.circuitMapStatusIcon.textContent = icon;
    if (DOM.circuitMapStatusTitle) DOM.circuitMapStatusTitle.textContent = title;
    if (DOM.circuitMapStatusText) DOM.circuitMapStatusText.textContent = text;
}

function setupCircuitMapInteractions(cornerCount, sectorCount) {
    if (!DOM.circuitMapContent) return;
    const layerButtons = document.querySelectorAll('[data-circuit-layer-toggle]');
    let selectedFeature = null;

    const showLayerStatus = (layer) => {
        if (layer === 'corners') {
            updateCircuitMapStatus('pin_drop', `${cornerCount} numbered corners`, 'Select a corner marker to identify it on the lap.');
        } else {
            updateCircuitMapStatus('grid_view', `${sectorCount} marshal sectors`, 'Select a numbered sector to trace its race-control zone.');
        }
    };

    const showFeature = (feature) => {
        const kind = feature.dataset.featureKind || 'Track feature';
        const label = feature.dataset.featureLabel || 'Selected';
        const detail = feature.dataset.featureDetail || 'Selected on the circuit map.';
        updateCircuitMapStatus(kind === 'Corner' ? 'pin_drop' : 'grid_view', label, detail);
    };

    const syncLayerAccessibility = (layer) => {
        DOM.circuitMapContent.querySelectorAll('.circuit-map-feature').forEach((feature) => {
            const featureLayer = feature.dataset.featureKind === 'Corner' ? 'corners' : 'sectors';
            const visible = featureLayer === layer;
            feature.setAttribute('tabindex', visible ? '0' : '-1');
            feature.setAttribute('aria-hidden', visible ? 'false' : 'true');
        });
    };

    layerButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const layer = button.dataset.circuitLayerToggle;
            DOM.circuitMapContent.dataset.layer = layer;
            selectedFeature = null;
            DOM.circuitMapContent.querySelectorAll('.circuit-map-feature.is-active').forEach(node => node.classList.remove('is-active'));
            layerButtons.forEach((candidate) => {
                const active = candidate === button;
                candidate.classList.toggle('active', active);
                candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            syncLayerAccessibility(layer);
            showLayerStatus(layer);
        });
    });

    DOM.circuitMapContent.querySelectorAll('.circuit-map-feature').forEach((feature) => {
        feature.addEventListener('pointerenter', () => showFeature(feature));
        feature.addEventListener('pointerleave', () => {
            if (selectedFeature) showFeature(selectedFeature);
            else showLayerStatus(DOM.circuitMapContent.dataset.layer || 'sectors');
        });
        feature.addEventListener('focus', () => showFeature(feature));
        feature.addEventListener('blur', () => {
            if (selectedFeature) showFeature(selectedFeature);
        });
        feature.addEventListener('click', () => {
            const isAlreadySelected = selectedFeature === feature;
            DOM.circuitMapContent.querySelectorAll('.circuit-map-feature.is-active').forEach(node => node.classList.remove('is-active'));
            selectedFeature = isAlreadySelected ? null : feature;
            if (selectedFeature) {
                selectedFeature.classList.add('is-active');
                showFeature(selectedFeature);
            } else {
                showLayerStatus(DOM.circuitMapContent.dataset.layer || 'sectors');
            }
        });
        feature.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            feature.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    });

    syncLayerAccessibility(DOM.circuitMapContent.dataset.layer || 'sectors');
    showLayerStatus(DOM.circuitMapContent.dataset.layer || 'sectors');
}

// Render Circuit Tab Details
function renderCircuitTab() {
    if (!state.currentMeeting || !state.currentMeeting.meeting) {
        DOM.circuitOfficialName.textContent = '--';
        DOM.circuitShortName.textContent = '--';
        DOM.circuitLocation.textContent = '--';
        DOM.circuitCountry.textContent = '--';
        DOM.circuitType.textContent = '--';
        DOM.circuitGmtOffset.textContent = '--';
        DOM.circuitStartDate.textContent = '--';
        DOM.circuitEndDate.textContent = '--';
        if (DOM.circuitCornerCount) DOM.circuitCornerCount.textContent = '--';
        if (DOM.circuitMarshalSectorCount) DOM.circuitMarshalSectorCount.textContent = '--';
        if (DOM.circuitDirection) DOM.circuitDirection.textContent = '--';
        if (DOM.circuitRoundChip) DOM.circuitRoundChip.textContent = 'Season circuit';
        renderCircuitSectorBenchmarks([]);
        showNoTrackMapState();
        return;
    }

    const m = state.currentMeeting.meeting;
    const info = state.currentMeeting.circuit_info;
    const flagCode = m.country_code || (state.selectedSession && state.selectedSession.country_code);

    DOM.circuitOfficialName.textContent = m.meeting_official_name || m.meeting_name || '--';
    DOM.circuitShortName.textContent = m.circuit_short_name || (info && info.circuitName) || '--';
    DOM.circuitLocation.textContent = m.location || '--';
    DOM.circuitCountry.textContent = m.country_name || '--';
    DOM.circuitType.textContent = m.circuit_type || 'Permanent';
    DOM.circuitGmtOffset.textContent = m.gmt_offset ? `GMT ${m.gmt_offset}` : '--';
    DOM.circuitStartDate.textContent = formatCircuitEventDate(m.date_start, m.gmt_offset);
    DOM.circuitEndDate.textContent = formatCircuitEventDate(m.date_end, m.gmt_offset);
    if (DOM.circuitHeroFlag) DOM.circuitHeroFlag.textContent = COUNTRY_FLAGS[flagCode] || '🏁';
    if (DOM.circuitRoundChip) {
        const round = info && info.round !== null && info.round !== undefined ? Number(info.round) : NaN;
        DOM.circuitRoundChip.textContent = Number.isFinite(round)
            ? `Round ${round}`
            : `${(state.selectedSession && state.selectedSession.year) || state.selectedYear} season`;
    }

    const hasTrackCoordinates = info && Array.isArray(info.x) && Array.isArray(info.y) && info.x.length > 2;
    const corners = hasTrackCoordinates && Array.isArray(info.corners)
        ? info.corners.filter(corner => (
            corner && corner.trackPosition &&
            Number.isFinite(Number(corner.number)) &&
            Number.isFinite(Number(corner.trackPosition.x)) &&
            Number.isFinite(Number(corner.trackPosition.y))
        ))
        : [];
    const marshalSectors = hasTrackCoordinates && Array.isArray(info.marshalSectors) ? info.marshalSectors : [];
    const trackPoints = hasTrackCoordinates
        ? info.x.map((x, index) => [Number(x), Number(info.y[index])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        : [];
    const marshalSegments = typeof buildMarshalSectorSegments === 'function'
        ? buildMarshalSectorSegments(trackPoints, marshalSectors)
        : [];

    if (DOM.circuitCornerCount) DOM.circuitCornerCount.textContent = corners.length || '--';
    if (DOM.circuitMarshalSectorCount) DOM.circuitMarshalSectorCount.textContent = marshalSegments.length || '--';
    if (DOM.circuitDirection) DOM.circuitDirection.textContent = circuitTrackDirection(trackPoints);
    renderCircuitSectorBenchmarks();

    if (trackPoints.length > 2) {
        const xCoords = trackPoints.map(point => point[0]);
        const yCoords = trackPoints.map(point => point[1]);
        const xMin = Math.min(...xCoords);
        const xMax = Math.max(...xCoords);
        const yMin = Math.min(...yCoords);
        const yMax = Math.max(...yCoords);
        const width = Math.max(xMax - xMin, 1);
        const height = Math.max(yMax - yMin, 1);
        const viewBoxSize = 1000;
        const padding = 125;
        const drawSize = viewBoxSize - 2 * padding;
        const scale = Math.min(drawSize / width, drawSize / height);
        const offsetX = padding + (drawSize - width * scale) / 2;
        const offsetY = padding + (drawSize - height * scale) / 2;
        const mapX = x => (x - xMin) * scale + offsetX;
        const mapY = y => (yMax - y) * scale + offsetY;
        const pathForPoints = (points, close = false) => {
            if (!points.length) return '';
            const commands = points.map(([x, y], index) => (
                `${index === 0 ? 'M' : 'L'} ${mapX(x).toFixed(1)} ${mapY(y).toFixed(1)}`
            ));
            return `${commands.join(' ')}${close ? ' Z' : ''}`;
        };
        const pathD = pathForPoints(trackPoints, true);

        const cornerHTML = corners.map((corner) => {
            const cx = mapX(Number(corner.trackPosition.x)).toFixed(1);
            const cy = mapY(Number(corner.trackPosition.y)).toFixed(1);
            const number = Number(corner.number);
            return `
                <g class="corner-marker-group circuit-map-feature" data-feature-kind="Corner" data-feature-label="Turn ${number}" data-feature-detail="Corner ${number} in the lap sequence." tabindex="0" role="button" aria-label="Turn ${number}">
                    <circle cx="${cx}" cy="${cy}" r="22" class="corner-circle" />
                    <text x="${cx}" y="${cy}" dy="6" class="corner-text">${number}</text>
                </g>
            `;
        }).join('');

        const sectorHTML = marshalSegments.map((segment) => {
            const number = Number(segment.number);
            const badgeX = mapX(segment.badge[0]).toFixed(1);
            const badgeY = mapY(segment.badge[1]).toFixed(1);
            return `
                <g class="circuit-sector-group circuit-map-feature" data-feature-kind="Sector" data-feature-label="Marshal sector ${number}" data-feature-detail="Race-control zone ${number} along the circuit." tabindex="0" role="button" aria-label="Marshal sector ${number}">
                    <path d="${pathForPoints(segment.points)}" class="circuit-sector-path" />
                    <g class="circuit-sector-badge">
                        <circle cx="${badgeX}" cy="${badgeY}" r="18"></circle>
                        <text x="${badgeX}" y="${badgeY}" dy="5">${number}</text>
                    </g>
                </g>
            `;
        }).join('');

        const start = [mapX(trackPoints[0][0]), mapY(trackPoints[0][1])];
        const next = [mapX(trackPoints[1][0]), mapY(trackPoints[1][1])];
        const tangentX = next[0] - start[0];
        const tangentY = next[1] - start[1];
        const tangentLength = Math.hypot(tangentX, tangentY) || 1;
        const normalX = -(tangentY / tangentLength) * 30;
        const normalY = (tangentX / tangentLength) * 30;

        DOM.circuitMapContent.dataset.layer = 'sectors';
        DOM.circuitMapContent.innerHTML = `
            <span class="circuit-map-compass" aria-hidden="true"><i></i>N</span>
            <svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Interactive ${escapeHtml(m.circuit_short_name || 'circuit')} track map">
                <defs>
                    <filter id="circuit-track-glow" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="7" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
                <path d="${pathD}" class="circuit-track-shadow" />
                <path d="${pathD}" class="track-path" filter="url(#circuit-track-glow)" />
                <g class="circuit-layer circuit-layer-sectors">${sectorHTML}</g>
                <g class="circuit-layer circuit-layer-corners">${cornerHTML}</g>
                <g class="circuit-start-finish" aria-label="Start finish line">
                    <line x1="${(start[0] - normalX).toFixed(1)}" y1="${(start[1] - normalY).toFixed(1)}" x2="${(start[0] + normalX).toFixed(1)}" y2="${(start[1] + normalY).toFixed(1)}"></line>
                    <circle cx="${start[0].toFixed(1)}" cy="${start[1].toFixed(1)}" r="8"></circle>
                </g>
            </svg>
        `;
        setupCircuitMapInteractions(corners.length, marshalSegments.length);
    } else if (m.circuit_image) {
        DOM.circuitMapContent.innerHTML = `
            <div class="fallback-track-img-wrapper">
                <img src="${safeUrl(m.circuit_image)}" class="fallback-track-img" alt="${escapeHtml(m.circuit_short_name)} track map">
                <span class="fallback-label">Official Formula 1 Circuit Graphic</span>
            </div>
        `;
        updateCircuitMapStatus('image', 'Official circuit artwork', 'Interactive geometry is not available for this event.');
    } else {
        showNoTrackMapState();
    }
}

// Fallback state if no track map coordinates or images are found
function showNoTrackMapState() {
    DOM.circuitMapContent.innerHTML = `
        <div class="circuit-map-empty">
            <span class="material-icons-round">map</span>
            <strong>No track layout available</strong>
            <p>The event metadata loaded, but this circuit has no map geometry yet.</p>
        </div>
    `;
    updateCircuitMapStatus('info', 'Map data unavailable', 'Circuit facts and session sector benchmarks remain available.');
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

            let teamHex = getDriverTeamHex(driver);

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
                timingCells = `<td class="lap-duration-val">${escapeHtml(timeGapDisplay)}</td>`;
            }

            const pointsCell = isQualiResults
                ? ''
                : `<td style="font-weight: 600; color: ${item.points > 0 ? 'var(--text-primary)' : 'var(--text-muted)'};">${escapeHtml(item.points && true ? item.points : '-')}</td>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="results-position-cell ${posClass}">${escapeHtml(posDisplay)}</td>
                <td>
                    <div class="results-driver-cell">
                        <div class="results-team-color-indicator" style="background: #${teamHex};"></div>
                        <img src="${safeUrl((driver.headshot_url || 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/').replace('.transform/1col/image.png', ''))}" class="results-driver-avatar" alt="${escapeHtml(driver.full_name)}">
                        <div class="results-driver-info">
                            <span class="results-driver-name">${escapeHtml(driver.first_name)} ${escapeHtml(driver.last_name)}${item.fastest_lap ? `<span class="fl-pill" title="Fastest lap${item.fastest_lap_time ? ` · ${escapeHtml(item.fastest_lap_time)}` : ''}${item.fastest_lap_number ? ` (lap ${escapeHtml(item.fastest_lap_number)})` : ''}">FL</span>` : ''}</span>
                            <span class="results-driver-team">${escapeHtml(driver.team_name || 'Independent')}</span>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(item.number_of_laps !== null ? item.number_of_laps : '--')}</td>
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
                teamHex = getDriverTeamHex(localDriver);
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
                            <img src="${safeUrl(avatarUrl)}" class="results-driver-avatar" alt="${escapeHtml(driverName)}">
                            <div class="results-driver-info">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="results-driver-name">${escapeHtml(driverName)}</span>
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
                    teamHex = getDriverTeamHex(matchingDriver);
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
// match the compatibility TEAM_COLORS keys, so fall back progressively.
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

// ===== Team radio playback =====
// One shared Audio element serves every play button (Race Control feed and
// the Session Replay ticker) so only a single clip plays at a time.
let teamRadioAudio = null;
let teamRadioUrl = null;

function isTeamRadioPlaying() {
    return !!(teamRadioAudio && !teamRadioAudio.paused && !teamRadioAudio.ended);
}

function getPlayingTeamRadioUrl() {
    return isTeamRadioPlaying() ? teamRadioUrl : null;
}

function isPlayableTeamRadioUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
}

function formatTeamRadioClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getTeamRadioAudio() {
    if (!teamRadioAudio) {
        teamRadioAudio = new Audio();
        teamRadioAudio.preload = 'none';
        teamRadioAudio.addEventListener('timeupdate', updateTeamRadioClipTime);
        ['play', 'pause', 'ended', 'error'].forEach(eventName => {
            teamRadioAudio.addEventListener(eventName, syncTeamRadioPlayingButtons);
        });
    }
    return teamRadioAudio;
}

// Stop playback outright (session switches: the clip no longer belongs to
// anything on screen).
function stopTeamRadioPlayback() {
    if (!teamRadioAudio) return;
    teamRadioAudio.pause();
    teamRadioUrl = null;
}

// Play/pause toggle for one clip URL; a different URL switches the player over.
function toggleTeamRadioClip(url) {
    if (!isPlayableTeamRadioUrl(url)) return;

    const audio = getTeamRadioAudio();
    if (teamRadioUrl === url) {
        if (isTeamRadioPlaying()) {
            audio.pause();
            return;
        }
        if (audio.ended) audio.currentTime = 0;
    } else {
        teamRadioUrl = url;
        audio.src = url;
    }
    audio.play().catch(error => {
        console.error('Team radio playback failed:', error);
        syncTeamRadioPlayingButtons();
    });
}

// Re-apply the playing state to whatever buttons currently exist for the
// active clip: the feed re-renders freely (live refresh, toggles) while the
// audio keeps playing.
function syncTeamRadioPlayingButtons() {
    const playingUrl = getPlayingTeamRadioUrl();
    document.querySelectorAll('.team-radio-play-btn').forEach(btn => {
        const active = !!playingUrl && btn.dataset.radioUrl === playingUrl;
        btn.classList.toggle('playing', active);
        const icon = btn.querySelector('.material-icons-round');
        if (icon) icon.textContent = active ? 'pause' : 'play_arrow';
    });
    updateTeamRadioClipTime();
}

function updateTeamRadioClipTime() {
    if (!teamRadioAudio) return;
    const elapsed = formatTeamRadioClock(teamRadioAudio.currentTime);
    const total = formatTeamRadioClock(teamRadioAudio.duration);
    const text = elapsed && total ? `${elapsed} / ${total}` : elapsed;
    if (!text) return;
    document.querySelectorAll('.team-radio-play-btn.playing').forEach(btn => {
        const player = btn.closest('.team-radio-player');
        const label = player ? player.querySelector('.team-radio-clip-time') : null;
        if (label) label.textContent = text;
    });
}

function onTeamRadioPlayClick(event) {
    const btn = event && event.target ? event.target.closest('.team-radio-play-btn') : null;
    if (!btn) return;
    event.preventDefault();
    toggleTeamRadioClip(btn.dataset ? btn.dataset.radioUrl : btn.getAttribute('data-radio-url'));
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

// Field-wide lap in progress at ms: the highest lap number any driver has
// started (mirrors race-control lap_number semantics, which follow the race
// leader). Needs state.allSessionLaps, so Race/Sprint sessions only.
function deriveTeamRadioLapAtMs(ms) {
    if (!Array.isArray(state.allSessionLaps) || !Number.isFinite(ms)) return null;

    let best = null;
    state.allSessionLaps.forEach(lap => {
        if (!lap || lap.date_start === null || lap.date_start === undefined) return;
        const lapNumber = Number(lap.lap_number);
        const startMs = new Date(lap.date_start).getTime();
        if (!Number.isFinite(lapNumber) || !Number.isFinite(startMs) || startMs > ms) return;
        if (best === null || lapNumber > best) best = lapNumber;
    });
    return best;
}

// Merge race control messages and team radio clips into one entry list
// sorted by date descending (newest first, like the feed renders).
function buildRaceControlFeedEntries(showBlueFlags, showTeamRadio) {
    const entries = [];

    (Array.isArray(state.raceControl) ? state.raceControl : []).forEach(item => {
        if (!item) return;
        if (!showBlueFlags && getRaceControlType(item) === 'BLUE') return;
        entries.push({
            kind: 'message',
            date: item.date || '',
            lap: (item.lap_number !== null && item.lap_number !== undefined) ? item.lap_number : null,
            item
        });
    });

    if (showTeamRadio) {
        (Array.isArray(state.teamRadio) ? state.teamRadio : []).forEach(item => {
            if (!item || !isPlayableTeamRadioUrl(item.recording_url)) return;
            const dateMs = item.date ? new Date(item.date).getTime() : NaN;
            entries.push({
                kind: 'radio',
                date: item.date || '',
                lap: deriveTeamRadioLapAtMs(dateMs),
                item
            });
        });
    }

    return entries.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function renderTeamRadioFeedItem(item) {
    const driverNumber = Number(item.driver_number);
    const driver = Number.isFinite(driverNumber)
        ? state.drivers.find(d => Number(d.driver_number) === driverNumber)
        : null;

    let driverLabel = '';
    let driverPill = '';
    if (driver) {
        const teamHex = getDriverTeamHex(driver);
        driverLabel = `${driver.first_name || ''} ${driver.last_name || driver.broadcast_name || ''}`.trim();
        driverPill = `<span class="race-control-meta-pill has-driver"><span class="driver-pill-dot" style="background: #${teamHex};"></span>${escapeHtml(driverLabel)}</span>`;
    } else if (Number.isFinite(driverNumber)) {
        driverLabel = `Car ${driverNumber}`;
        driverPill = `<span class="race-control-meta-pill">${escapeHtml(driverLabel)}</span>`;
    }

    return `
        <article class="race-control-item team-radio-item">
            <div class="race-control-time">${escapeHtml(formatRaceControlTime(item.date))}</div>
            <div class="race-control-main">
                <div class="race-control-row">
                    <span class="race-control-type race-control-type-team-radio">Team Radio</span>
                    <div class="race-control-meta">${driverPill}</div>
                </div>
                <div class="team-radio-player">
                    <button type="button" class="team-radio-play-btn" data-radio-url="${safeUrl(item.recording_url)}" aria-label="${escapeHtml(`Play team radio${driverLabel ? ` from ${driverLabel}` : ''}`)}">
                        <span class="material-icons-round">play_arrow</span>
                    </button>
                    <span class="team-radio-clip-time">Radio message</span>
                </div>
            </div>
        </article>
    `;
}

function renderRaceControlMessageItem(item) {
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
}

function renderRaceControlFeed() {
    if (!DOM.raceControlFeed || !DOM.raceControlEmptyState) return;

    const showBlueFlags = DOM.showBlueFlags ? DOM.showBlueFlags.checked : true;
    const showTeamRadio = DOM.showTeamRadio ? DOM.showTeamRadio.checked : true;
    const entries = buildRaceControlFeedEntries(showBlueFlags, showTeamRadio);

    if (entries.length === 0) {
        const hasAnySource = (Array.isArray(state.raceControl) && state.raceControl.length > 0) ||
            (Array.isArray(state.teamRadio) && state.teamRadio.length > 0);
        DOM.raceControlFeed.style.display = 'none';
        DOM.raceControlEmptyState.style.display = 'flex';
        if (DOM.raceControlSummary) {
            DOM.raceControlSummary.textContent = hasAnySource
                ? 'No session messages recorded (all filtered out)'
                : 'No session messages recorded';
        }
        return;
    }

    DOM.raceControlEmptyState.style.display = 'none';
    DOM.raceControlFeed.style.display = 'flex';

    if (DOM.raceControlSummary) {
        const messageEntries = entries.filter(entry => entry.kind === 'message');
        const radioCount = entries.length - messageEntries.length;
        const incidentCount = messageEntries.filter(entry => {
            const msg = (entry.item.message || '').toUpperCase();
            return msg.includes('INCIDENT') || msg.includes('PENALTY') || msg.includes('INVESTIGAT');
        }).length;
        const radioText = radioCount > 0 ? `, ${radioCount} radio clips` : '';
        DOM.raceControlSummary.textContent = `${messageEntries.length} messages, ${incidentCount} incident updates${radioText}`;
    }

    // Group contiguous entries by lap
    const groups = [];
    let currentGroup = null;

    entries.forEach((entry) => {
        // Radio clips without a derivable lap (practice/quali have no
        // field-wide laps) stay with the surrounding group instead of
        // splitting it into bogus "General Notices" slivers.
        if (entry.kind === 'radio' && entry.lap === null && currentGroup) {
            currentGroup.messages.push(entry);
            return;
        }
        if (!currentGroup || currentGroup.lap !== entry.lap) {
            currentGroup = {
                lap: entry.lap,
                messages: []
            };
            groups.push(currentGroup);
        }
        currentGroup.messages.push(entry);
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

        const messagesHtml = group.messages.map(entry => (
            entry.kind === 'radio'
                ? renderTeamRadioFeedItem(entry.item)
                : renderRaceControlMessageItem(entry.item)
        )).join('');

        return `
            <div class="race-control-group">
                <header class="race-control-group-header ${groupClass}">
                    <span class="race-control-group-title">${escapeHtml(groupTitle)}</span>
                </header>
                <div class="race-control-group-items">
                    ${messagesHtml}
                </div>
            </div>
        `;
    }).join('');

    // Restore the playing state on the re-rendered buttons
    syncTeamRadioPlayingButtons();
}
