// Select driver and fetch laps & stint details to render analytics
let lapsChartRenderFrame = null;
let lapsChartResizeObserver = null;

function updateLapsSessionContext(driver = null) {
    const session = state.selectedSession || {};
    if (DOM.lapsSessionName) {
        const sessionParts = [session.circuit_short_name || session.location, session.session_name || session.session_type]
            .filter(Boolean);
        DOM.lapsSessionName.textContent = sessionParts.length ? sessionParts.join(' · ') : 'Selected session';
    }
    if (DOM.lapsSessionStatus) {
        DOM.lapsSessionStatus.textContent = driver
            ? `#${driver.driver_number} ${driver.name_acronym || driver.last_name || 'driver'} channel selected`
            : 'Telemetry workspace ready';
    }
}

function getChartContainerWidth(container) {
    if (!container) return 0;
    const rectWidth = container.getBoundingClientRect ? container.getBoundingClientRect().width : 0;
    return Math.floor(rectWidth || container.clientWidth || container.offsetWidth || 0);
}

function isChartContainerVisible(container) {
    return !!(container && container.isConnected && container.getClientRects && container.getClientRects().length > 0);
}

function scheduleLapChartRender(laps = null, attempt = 0) {
    const sourceLaps = laps || (state.selectedDriverStats !== null ? state.laps[state.selectedDriverStats] : null);
    if (!sourceLaps || !DOM.lapsChartContainer) return;

    if (lapsChartRenderFrame !== null) {
        cancelAnimationFrame(lapsChartRenderFrame);
    }

    lapsChartRenderFrame = requestAnimationFrame(() => {
        lapsChartRenderFrame = null;

        const width = getChartContainerWidth(DOM.lapsChartContainer);
        const canRender = state.currentTab === 'laps-view' && isChartContainerVisible(DOM.lapsChartContainer) && width > 0;
        if (canRender) {
            renderLapChart(sourceLaps);
            return;
        }

        if (attempt < 5) {
            scheduleLapChartRender(sourceLaps, attempt + 1);
        }
    });
}

function setupLapsChartAutoResize() {
    if (!DOM.lapsChartContainer || lapsChartResizeObserver) return;

    const rerender = () => {
        if (state.currentTab === 'laps-view') {
            scheduleLapChartRender();
        }
    };

    if (typeof ResizeObserver === 'function') {
        lapsChartResizeObserver = new ResizeObserver(rerender);
        lapsChartResizeObserver.observe(DOM.lapsChartContainer);
    } else {
        window.addEventListener('resize', rerender);
    }
}

async function selectDriverForStats(driverNumber) {
    state.selectedDriverStats = driverNumber;
    
    // Highlight pill
    document.querySelectorAll('.driver-pill').forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-pressed', 'false');
    });
    const activePill = document.getElementById(`pill-driver-${driverNumber}`);
    if (activePill) {
        activePill.classList.add('active');
        activePill.setAttribute('aria-pressed', 'true');
    }

    // Get Driver details
    const d = state.drivers.find(drv => drv.driver_number === driverNumber);
    if (!d) return;
    updateLapsSessionContext(d);

    // Show loading sub-state
    DOM.lapsEmpty.style.display = 'none';
    DOM.lapsData.style.display = 'none';
    
    // Temporarily append a loading spinner inside laps panel
    const loader = document.createElement('div');
    loader.className = 'loading-state';
    loader.innerHTML = '<div class="spinner"></div><p>Loading driver telemetry...</p>';
    DOM.lapsContent.appendChild(loader);

    if (!state.selectedSession) {
        loader.remove();
        return;
    }

    try {
        // Load driver laps
        const laps = await fetchDriverLaps(state.selectedSession.session_key, driverNumber);

        if (Number(state.selectedDriverStats) !== Number(driverNumber)) {
            loader.remove();
            return;
        }
        
        // Remove loader
        loader.remove();
        
        // Render stats header with official headshot and color
        let teamHex = getDriverTeamHex(d);
        DOM.statsColorBar.style.backgroundColor = `#${teamHex}`;
        DOM.statsDriverName.textContent = `${d.first_name} ${d.last_name}`;
        DOM.statsDriverTeam.textContent = d.team_name || 'Independent';
        DOM.statsDriverNumber.textContent = d.driver_number;
        DOM.statsDriverNumber.style.color = `#${teamHex}`;
        
        // Render flag, age, and wiki link
        const age = calculateAgeAtDate(d.birthday, state.selectedSession ? state.selectedSession.date_start : null);
        
        if (DOM.statsDriverFlag) {
            if (d.nationality) {
                DOM.statsDriverFlag.textContent = getNationalityFlag(d.nationality);
                DOM.statsDriverFlag.title = d.nationality;
                DOM.statsDriverFlag.style.display = 'inline';
            } else {
                DOM.statsDriverFlag.style.display = 'none';
            }
        }

        if (DOM.statsDriverAge) {
            if (age) {
                DOM.statsDriverAge.textContent = `${age} yrs`;
                DOM.statsDriverAge.style.display = 'inline-block';
            } else {
                DOM.statsDriverAge.style.display = 'none';
            }
        }

        if (DOM.statsDriverWiki) {
            if (d.wiki_url) {
                DOM.statsDriverWiki.href = safeUrl(d.wiki_url);
                DOM.statsDriverWiki.style.display = 'inline-flex';
            } else {
                DOM.statsDriverWiki.style.display = 'none';
            }
        }
        
        // Load driver avatar image
        const headshot = d.headshot_url || "";//'https://media.formula1.com/d_driver_fallback_image.png';
        DOM.statsDriverHeadshot.src = safeUrl(headshot.replace('.transform/1col/image.png', ''));
        DOM.statsDriverHeadshot.alt = `${d.first_name || ''} ${d.last_name || d.name_acronym || 'Driver'} headshot`.trim();
        DOM.statsDriverHeadshot.style.setProperty('--team-color', `#${teamHex}`);
        const rgb = getRGBColor(teamHex);
        DOM.statsDriverHeadshot.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.2)`);
        DOM.lapsData.style.setProperty('--team-color', `#${teamHex}`);
        DOM.lapsData.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.22)`);

        // Compute lap statistics
        let fastestDuration = Infinity;
        let totalLaps = 0;
        let bestS1 = Infinity;
        let bestS2 = Infinity;
        let bestS3 = Infinity;
        let fastestLapNumber = null;
        let runningLaps = [];
        
        laps.forEach(lap => {
            if (lap.lap_duration && lap.lap_duration < fastestDuration) {
                fastestDuration = lap.lap_duration;
                fastestLapNumber = lap.lap_number;
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
        if (DOM.statsFastestMeta) {
            DOM.statsFastestMeta.textContent = fastestLapNumber !== null ? `Set on lap ${fastestLapNumber}` : 'No timed benchmark';
        }
        
        // 2. Theoretical Best Lap
        let theoreticalBest = null;
        if (bestS1 !== Infinity && bestS2 !== Infinity && bestS3 !== Infinity) {
            theoreticalBest = bestS1 + bestS2 + bestS3;
            DOM.statsTheoBestLap.textContent = formatLapTime(theoreticalBest);
            DOM.statsTheoBestLap.title = `S1: ${bestS1.toFixed(3)}s | S2: ${bestS2.toFixed(3)}s | S3: ${bestS3.toFixed(3)}s`;
            if (DOM.statsTheoBestMeta) {
                const potential = fastestDuration !== Infinity ? Math.max(0, fastestDuration - theoreticalBest) : null;
                DOM.statsTheoBestMeta.textContent = potential !== null
                    ? `${potential.toFixed(3)}s potential gain`
                    : 'Best sector combination';
            }
        } else {
            DOM.statsTheoBestLap.textContent = '--';
            DOM.statsTheoBestLap.title = '';
            if (DOM.statsTheoBestMeta) DOM.statsTheoBestMeta.textContent = 'Sector data incomplete';
        }

        // 3. Average Lap Pace (exclude outliers above 115% of fastest lap)
        let representativeLapCount = 0;
        if (fastestDuration !== Infinity && runningLaps.length > 0) {
            const paceThreshold = fastestDuration * 1.15;
            const representativeLaps = runningLaps.filter(dur => dur <= paceThreshold);
            representativeLapCount = representativeLaps.length;
            const sum = representativeLaps.reduce((acc, v) => acc + v, 0);
            const avgVal = sum / (representativeLaps.length || 1);
            DOM.statsAvgLap.textContent = formatLapTime(avgVal);
            DOM.statsAvgLap.title = `Averaged ${representativeLaps.length} of ${runningLaps.length} laps (filtered out pit stops / yellow flags)`;
            if (DOM.statsAvgMeta) DOM.statsAvgMeta.textContent = `${representativeLapCount} clean laps sampled`;
        } else {
            DOM.statsAvgLap.textContent = '--';
            DOM.statsAvgLap.title = '';
            if (DOM.statsAvgMeta) DOM.statsAvgMeta.textContent = 'No representative sample';
        }

        // 4. Total Laps
        DOM.statsTotalLaps.textContent = totalLaps;
        if (DOM.statsTotalMeta) {
            const stintCount = state.stints.filter(stint => Number(stint.driver_number) === Number(driverNumber)).length;
            DOM.statsTotalMeta.textContent = `${stintCount} ${stintCount === 1 ? 'run' : 'runs'} recorded`;
        }

        // Render Laps Table with Sector Personal Best highlights
        const tableSafetyCarPeriods = extractSafetyCarPeriods(state.raceControl);
        let lapsTableHTML = '';
        if (laps.length === 0) {
            lapsTableHTML = '<tr><td colspan="8" style="text-align:center;">No lap data recorded for this driver.</td></tr>';
        } else {
            laps.forEach(lap => {
                const isFastest = lap.lap_duration === fastestDuration;
                const isBestS1 = lap.duration_sector_1 === bestS1;
                const isBestS2 = lap.duration_sector_2 === bestS2;
                const isBestS3 = lap.duration_sector_3 === bestS3;
                const pitAnnotation = getLapPitAnnotation(driverNumber, lap.lap_number);
                const stintInfo = getLapStintInfo(driverNumber, lap.lap_number);
                const trackStatus = getLapTrackStatus(lap.lap_number, tableSafetyCarPeriods);
                const rowClasses = [
                    pitAnnotation.isPitIn ? 'lap-row-pit-in' : '',
                    pitAnnotation.isPitOut ? 'lap-row-pit-out' : ''
                ].filter(Boolean).join(' ');

                lapsTableHTML += `
                    <tr id="lap-row-${escapeHtml(lap.lap_number)}" class="${rowClasses}">
                        <td>
                            <button type="button" class="lap-analyze-btn" data-lap-number="${escapeHtml(lap.lap_number)}" aria-label="Analyze lap ${escapeHtml(lap.lap_number)} telemetry" aria-pressed="false">
                                <span>${escapeHtml(lap.lap_number)}</span>
                                <span class="material-icons-round" aria-hidden="true">monitoring</span>
                            </button>
                        </td>
                        <td class="lap-tyre-cell">${renderLapTyreBadge(stintInfo)}</td>
                        <td class="pit-lap-cell">${renderPitLapBadges(pitAnnotation)}</td>
                        <td class="lap-track-cell">${renderLapTrackBadge(trackStatus)}</td>
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
        if (DOM.lapsTableCount) {
            DOM.lapsTableCount.textContent = `${totalLaps} ${totalLaps === 1 ? 'timed lap' : 'timed laps'}`;
        }

        // Render Stints Timeline
        renderStintsTimeline(driverNumber);

        // Display dashboard
        DOM.lapsData.style.display = 'flex';

        // Render Lap Timing Chart after the panel is visible and measurable.
        scheduleLapChartRender(laps);

        // Populate the telemetry lap selector (fetches only when the tab is visible)
        setupTelemetrySection(laps);
    } catch (e) {
        console.error('Error rendering driver details:', e);
        loader.remove();
        DOM.lapsEmpty.style.display = 'flex';
    }
}

// Render Stints Timeline with Gap/Garage intervals
function renderStintsTimeline(driverNumber) {
    const driverStints = state.stints.filter(s => Number(s.driver_number) === Number(driverNumber));
    
    if (driverStints.length === 0) {
        DOM.stintsTimeline.innerHTML = '<div class="stints-empty"><span class="material-icons-round" aria-hidden="true">tire_repair</span><span>No stint data recorded for this driver.</span></div>';
        if (DOM.stintsSummary) DOM.stintsSummary.textContent = 'No tyre runs available';
        if (DOM.stintsLegend) DOM.stintsLegend.innerHTML = '';
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

    const uniqueCompounds = [...new Set(driverStints.map(stint => (
        String(stint.compound || 'UNKNOWN').toUpperCase().replace(/[^A-Z]/g, '') || 'UNKNOWN'
    )))];
    if (DOM.stintsSummary) {
        DOM.stintsSummary.textContent = `${driverStints.length} ${driverStints.length === 1 ? 'run' : 'runs'} · ${uniqueCompounds.length} ${uniqueCompounds.length === 1 ? 'compound' : 'compounds'} · ${maxLap} laps mapped`;
    }
    if (DOM.stintsLegend) {
        DOM.stintsLegend.innerHTML = uniqueCompounds.map(compound => `
            <span><i class="stint-legend-dot stint-compound-${escapeHtml(compound)}" aria-hidden="true"></i>${escapeHtml(compound.charAt(0) + compound.slice(1).toLowerCase())}</span>
        `).join('');
    }

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
        const compound = String(segment.compound || 'UNKNOWN').toUpperCase().replace(/[^A-Z]/g, '') || 'UNKNOWN';
        div.className = `stint-segment stint-compound-${compound}`;
        div.style.width = `${widthPct}%`;
        div.tabIndex = 0;
        div.setAttribute('role', 'img');
        
        if (segment.type === 'gap') {
            div.setAttribute('aria-label', `Garage or inactive, laps ${segment.lap_start} to ${segment.lap_end}, ${stintLaps} laps`);
            div.innerHTML = `
                <span class="stint-segment-code">G</span>
                <span class="stint-segment-range">${escapeHtml(segment.lap_start)}–${escapeHtml(segment.lap_end)}</span>
                <div class="stint-tooltip" aria-hidden="true">
                    <strong>In Garage / Inactive</strong><br>
                    Laps: ${escapeHtml(segment.lap_start)} - ${escapeHtml(segment.lap_end)} (${stintLaps} laps)
                </div>
            `;
        } else {
            const initial = segment.compound ? segment.compound.charAt(0) : '?';
            div.setAttribute('aria-label', `Stint ${segment.stint_number}, ${segment.compound || 'unknown'} compound, laps ${segment.lap_start} to ${segment.lap_end}, starting tyre age ${segment.tyre_age_at_start || 0} laps`);
            div.innerHTML = `
                <span class="stint-segment-code">${escapeHtml(initial)}</span>
                <span class="stint-segment-range">${escapeHtml(segment.lap_start)}–${escapeHtml(segment.lap_end)}</span>
                <div class="stint-tooltip" aria-hidden="true">
                    <strong>Stint ${escapeHtml(segment.stint_number)}: ${escapeHtml(segment.compound || 'Unknown')}</strong><br>
                    Laps: ${escapeHtml(segment.lap_start)} - ${escapeHtml(segment.lap_end)} (${stintLaps} laps)<br>
                    Starting Age: ${escapeHtml(segment.tyre_age_at_start || 0)} laps
                </div>
            `;
        }
        
        DOM.stintsTimeline.appendChild(div);
    });
}

function updateActiveLapTableSelection(lapNumber) {
    const selectedLap = String(lapNumber);
    if (!DOM.lapsTableBody) return;
    DOM.lapsTableBody.querySelectorAll('.lap-analyze-btn').forEach(button => {
        const isSelected = button.dataset.lapNumber === selectedLap;
        button.setAttribute('aria-pressed', String(isSelected));
        const row = button.closest('tr');
        if (row) row.classList.toggle('lap-row-selected', isSelected);
    });
}

function selectLapForTelemetry(lapNumber, shouldScroll = true) {
    if (!DOM.telemetryLapSelect) return;
    const selectedLap = String(lapNumber);
    const hasLap = Array.from(DOM.telemetryLapSelect.options).some(option => option.value === selectedLap);
    if (!hasLap) return;

    DOM.telemetryLapSelect.value = selectedLap;
    updateActiveLapTableSelection(selectedLap);
    DOM.telemetryLapSelect.dispatchEvent(new Event('change', { bubbles: true }));

    if (shouldScroll && DOM.telemetrySection) {
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        DOM.telemetrySection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
}

// Tyre compound + age on a given lap, resolved from the driver's stints
function getLapStintInfo(driverNumber, lapNumber) {
    const lap = Number(lapNumber);
    if (!Number.isFinite(lap) || !Array.isArray(state.stints)) return null;
    const stint = state.stints.find(s => (
        Number(s.driver_number) === Number(driverNumber) &&
        Number(s.lap_start) <= lap && lap <= Number(s.lap_end)
    ));
    if (!stint) return null;
    const compound = String(stint.compound || 'UNKNOWN').toUpperCase().replace(/[^A-Z]/g, '') || 'UNKNOWN';
    const baseAge = Number(stint.tyre_age_at_start) || 0;
    return {
        compound,
        label: compound.charAt(0) + compound.slice(1).toLowerCase(),
        age: baseAge + (lap - Number(stint.lap_start)),
        stintNumber: stint.stint_number
    };
}

// SC/VSC cover on a given lap, from pre-extracted safety car periods
function getLapTrackStatus(lapNumber, safetyCarPeriods) {
    const lap = Number(lapNumber);
    if (!Number.isFinite(lap)) return null;
    let status = null;
    (safetyCarPeriods || []).forEach(period => {
        if (lap < period.start || lap > period.end) return;
        // A full SC outranks a VSC when periods meet on a boundary lap
        if (status !== 'SC') status = period.type;
    });
    return status;
}

function renderLapTyreBadge(stintInfo) {
    if (!stintInfo) return '<span class="lap-tyre-empty">--</span>';
    const ageText = `${stintInfo.age} ${stintInfo.age === 1 ? 'lap' : 'laps'} old`;
    const stintText = Number.isFinite(Number(stintInfo.stintNumber)) ? ` (stint ${stintInfo.stintNumber})` : '';
    return `<span class="lap-tyre-badge stint-compound-${escapeHtml(stintInfo.compound)}" ` +
        `title="${escapeHtml(`${stintInfo.label} — ${ageText}${stintText}`)}">` +
        `<i aria-hidden="true">${escapeHtml(stintInfo.compound.charAt(0))}</i>${escapeHtml(stintInfo.age)}</span>`;
}

function renderLapTrackBadge(status) {
    if (!status) return '<span class="lap-track-clear">--</span>';
    const isVsc = status === 'VSC';
    const title = isVsc ? 'Virtual Safety Car on this lap' : 'Safety Car on this lap';
    return `<span class="lap-track-badge ${isVsc ? 'track-vsc' : 'track-sc'}" title="${escapeHtml(title)}">${escapeHtml(status)}</span>`;
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

    // Filter laps with valid duration
    const validLaps = laps.filter(l => l.lap_duration && !isNaN(l.lap_duration));
    if (validLaps.length === 0) {
        DOM.lapsChartContainer.innerHTML = '';
        DOM.lapsChartContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">No lap times recorded to plot.</div>';
        return;
    }

    const width = getChartContainerWidth(DOM.lapsChartContainer);
    if (width <= 0) {
        scheduleLapChartRender(laps);
        return;
    }

    DOM.lapsChartContainer.innerHTML = '';

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
    
    const qualifyingAxis = buildQualifyingPhaseAxis(validLaps, state.raceControl, state.selectedSession);
    // Shared by the SC/VSC shading and the hover tooltip's track-status row
    const safetyCarPeriods = qualifyingAxis ? [] : extractSafetyCarPeriods(state.raceControl);
    const minLap = Math.min(...validLaps.map(l => l.lap_number));
    const maxLap = Math.max(...validLaps.map(l => l.lap_number));
    const minXValue = qualifyingAxis ? qualifyingAxis.min : minLap;
    const maxXValue = qualifyingAxis ? qualifyingAxis.max : maxLap;

    // Chart margins and sizes
    const height = 320;
    const padding = { top: 20, right: 30, bottom: 30, left: 55 };
    
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Scale helper functions
    const getX = (xValue) => {
        if (maxXValue === minXValue) return padding.left + chartWidth / 2;
        return padding.left + ((xValue - minXValue) / (maxXValue - minXValue)) * chartWidth;
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

    if (qualifyingAxis) {
        renderQualifyingPhaseRegions(svg, qualifyingAxis, getX, padding, chartHeight, svgNamespace, true);
    } else {
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

    if (!qualifyingAxis) {
        // Draw Safety Car & VSC Zones
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

        const pitLapMarkers = getDriverPitLapMarkers(state.selectedDriverStats, minLap, maxLap);
        renderPitLapMarkers(svg, pitLapMarkers, getX, minLap, maxLap, padding, chartHeight, svgNamespace);
    }

    // Build path points
    let points = [];
    plottableLaps.forEach(lap => {
        const xValue = getLapXValue(lap, qualifyingAxis);
        if (!Number.isFinite(xValue)) return;
        points.push(`${getX(xValue).toFixed(1)},${getY(lap.lap_duration).toFixed(1)}`);
    });

    // Set line color dynamically based on driver's team color
    const activeDriver = state.drivers.find(drv => drv.driver_number === state.selectedDriverStats);
    let teamHex = 'ff1801';
    if (activeDriver) {
        teamHex = getDriverTeamHex(activeDriver, 'ff1801');
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
    tooltip.classList.remove("compare-unified-tooltip", "compare-strategy-tooltip");

    const lapCircles = new Map();
    let activeLapNumber = null;

    const clearLapChartHover = () => {
        if (activeLapNumber === null) return;

        const activeCircle = lapCircles.get(activeLapNumber);
        if (activeCircle) {
            activeCircle.classList.remove("active");
            if (!activeCircle.classList.contains("chart-outlier-dot")) {
                activeCircle.style.fill = "#0c0c12";
            }
        }

        const activeRow = document.getElementById(`lap-row-${activeLapNumber}`);
        if (activeRow) activeRow.classList.remove("lap-row-highlight");
        activeLapNumber = null;
    };

    const renderLapChartTooltip = (tooltip, lap, pitAnnotation, isOutlier) => {
        const stintInfo = getLapStintInfo(state.selectedDriverStats, lap.lap_number);
        const trackStatus = getLapTrackStatus(lap.lap_number, safetyCarPeriods);
        tooltip.innerHTML = `
            <div class="chart-tooltip-header">${escapeHtml(getQualifyingLapLabel(lap, qualifyingAxis))}</div>
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
            ${stintInfo ? `
            <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;">
                <span style="color:var(--text-muted)">Tyre:</span>
                <span>${escapeHtml(stintInfo.label)} · ${escapeHtml(stintInfo.age)} ${stintInfo.age === 1 ? 'lap' : 'laps'} old</span>
            </div>` : ''}
            ${trackStatus ? `<div class="chart-tooltip-track ${trackStatus === 'VSC' ? 'track-vsc' : 'track-sc'}">${trackStatus === 'VSC' ? 'Virtual Safety Car' : 'Safety Car'}</div>` : ''}
            ${renderPitTooltipRows(pitAnnotation)}
            ${isOutlier ? '<div style="color:#ffd60a;font-size:9px;margin-top:6px;font-weight:700;text-align:center;">OUTLIER (PIT/SLOW LAP)</div>' : ''}
        `;
    };

    // Plot data points
    validLaps.forEach(lap => {
        const isOutlier = hideOutliers && lap.lap_duration > outlierThreshold;
        const pitAnnotation = getLapPitAnnotation(state.selectedDriverStats, lap.lap_number);
        const pitDotClasses = [
            pitAnnotation.isPitIn ? 'chart-pit-in-dot' : '',
            pitAnnotation.isPitOut ? 'chart-pit-out-dot' : ''
        ].filter(Boolean).join(' ');
        const xValue = getLapXValue(lap, qualifyingAxis);
        if (!Number.isFinite(xValue)) return;

        const x = getX(xValue);
        const y = isOutlier ? padding.top : getY(lap.lap_duration);

        const circle = document.createElementNS(svgNamespace, "circle");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.style.setProperty('--team-color', `#${teamHex}`);
        
        if (isOutlier) {
            circle.setAttribute("r", 3.5);
            circle.setAttribute("class", `chart-outlier-dot${pitDotClasses ? ` ${pitDotClasses}` : ''}`);
        } else {
            circle.setAttribute("r", 4.5);
            circle.setAttribute("class", `chart-dot${pitDotClasses ? ` ${pitDotClasses}` : ''}`);
            circle.style.stroke = `#${teamHex}`;
        }
        lapCircles.set(lap.lap_number, circle);
        svg.appendChild(circle);
    });

    // A full plot-area target makes lap details available without requiring a
    // user to land on the tiny SVG marker for a lap.
    const overlay = document.createElementNS(svgNamespace, "rect");
    overlay.setAttribute("x", padding.left);
    overlay.setAttribute("y", padding.top);
    overlay.setAttribute("width", chartWidth);
    overlay.setAttribute("height", chartHeight);
    overlay.setAttribute("class", "lap-chart-interaction-overlay");
    overlay.setAttribute("fill", "transparent");

    overlay.addEventListener("mousemove", event => {
        const svgRect = svg.getBoundingClientRect();
        const viewX = (event.clientX - svgRect.left) * (width / (svgRect.width || width));
        const nearestLap = validLaps.reduce((nearest, lap) => {
            const nearestX = getX(getLapXValue(nearest, qualifyingAxis));
            const lapX = getX(getLapXValue(lap, qualifyingAxis));
            return Math.abs(lapX - viewX) < Math.abs(nearestX - viewX) ? lap : nearest;
        });

        if (activeLapNumber !== nearestLap.lap_number) {
            clearLapChartHover();
            activeLapNumber = nearestLap.lap_number;

            const activeCircle = lapCircles.get(activeLapNumber);
            if (activeCircle) {
                activeCircle.classList.add("active");
                if (!activeCircle.classList.contains("chart-outlier-dot")) {
                    activeCircle.style.fill = `#${teamHex}`;
                }
            }

            const nearestPitAnnotation = getLapPitAnnotation(state.selectedDriverStats, nearestLap.lap_number);
            const nearestIsOutlier = hideOutliers && nearestLap.lap_duration > outlierThreshold;
            renderLapChartTooltip(tooltip, nearestLap, nearestPitAnnotation, nearestIsOutlier);

            const row = document.getElementById(`lap-row-${nearestLap.lap_number}`);
            if (row) {
                row.classList.add("lap-row-highlight");
                row.style.setProperty('--team-color', `#${teamHex}`);
                row.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        }

        tooltip.style.display = "block";
        tooltip.style.left = `${event.pageX - 80}px`;
        tooltip.style.top = `${event.pageY - tooltip.clientHeight - 12}px`;
    });

    const hideTooltip = () => {
        clearLapChartHover();
        tooltip.style.display = "none";
    };
    overlay.addEventListener("mouseleave", hideTooltip);
    svg.appendChild(overlay);

    DOM.lapsChartContainer.appendChild(svg);
}

// ===== Lap Telemetry (car_data deep-dive) =====

// Livetiming-compatible DRS values reported while the flap is open
const TELEMETRY_DRS_ACTIVE_VALUES = new Set([10, 12, 14]);

function isTelemetryDrsActive(value) {
    return TELEMETRY_DRS_ACTIVE_VALUES.has(Number(value));
}

// car_data is queried by date range, so only laps with a start date are selectable
function getTelemetrySelectableLaps(laps) {
    return (Array.isArray(laps) ? laps : []).filter(lap => lap && lap.date_start);
}

// Fastest selectable lap (used to preselect it in the lap dropdowns)
function fastestSelectableLap(laps) {
    return getTelemetrySelectableLaps(laps).reduce((best, lap) => {
        if (!lap.lap_duration) return best;
        return (!best || lap.lap_duration < best.lap_duration) ? lap : best;
    }, null);
}

// Shared "Lap N — 1:31.234 ★" option markup for both the main and compare selects.
// selectedLapNumber === null preselects the fastest lap (main-select default).
function buildTelemetryLapOptionsHtml(laps, selectedLapNumber) {
    const selectable = getTelemetrySelectableLaps(laps);
    const fastest = fastestSelectableLap(laps);
    const preselect = selectedLapNumber != null
        ? Number(selectedLapNumber)
        : (fastest ? fastest.lap_number : null);
    return selectable.map(lap => {
        const isFastest = fastest && lap.lap_number === fastest.lap_number;
        const isSelected = preselect != null && lap.lap_number === preselect;
        const timeLabel = lap.lap_duration ? formatLapTime(lap.lap_duration) : 'no time';
        return `<option value="${escapeHtml(lap.lap_number)}"${isSelected ? ' selected' : ''}>` +
               `Lap ${escapeHtml(lap.lap_number)} — ${timeLabel}${isFastest ? ' ★' : ''}</option>`;
    }).join('');
}

function setupTelemetrySection(laps) {
    if (!DOM.telemetrySection || !DOM.telemetryLapSelect) return;

    const selectable = getTelemetrySelectableLaps(laps);
    if (selectable.length === 0) {
        DOM.telemetrySection.style.display = 'none';
        return;
    }
    DOM.telemetrySection.style.display = 'block';

    DOM.telemetryLapSelect.innerHTML = buildTelemetryLapOptionsHtml(laps, null);
    setupTelemetryCompareControls();
    updateActiveLapTableSelection(DOM.telemetryLapSelect.value);

    renderTelemetryMessage('Telemetry loads when the Laps tab is open.');
    maybeAutoLoadTelemetry();
}

// Session load auto-selects a driver while another tab is on screen;
// defer the car_data fetch until the Laps tab is actually visible. A pending
// comparison loads here too when the tab becomes visible.
function maybeAutoLoadTelemetry() {
    if (state.currentTab !== 'laps-view') return;
    if (state.telemetryCompare) {
        loadTelemetryComparison();
    } else {
        loadSelectedLapTelemetry();
    }
}

// Populate the "vs" driver dropdown (all drivers, incl. the current one for
// same-driver lap-vs-lap). Restores an active comparison across a main-driver
// or main-lap change so the selection survives setupTelemetrySection re-runs.
function setupTelemetryCompareControls() {
    if (!DOM.telemetryCompareDriverSelect) return;
    const drivers = Array.isArray(state.drivers) ? state.drivers : [];
    const sorted = [...drivers].sort((a, b) => (a.team_name || '').localeCompare(b.team_name || ''));
    const active = state.telemetryCompare;

    const options = ['<option value="">No comparison</option>'];
    sorted.forEach(drv => {
        const dn = drv.driver_number;
        const acr = drv.name_acronym || `#${dn}`;
        const team = drv.team_name ? ` — ${drv.team_name}` : '';
        const isSel = active && Number(active.driverNumber) === Number(dn);
        options.push(
            `<option value="${escapeHtml(dn)}"${isSel ? ' selected' : ''}>` +
            `${escapeHtml(acr)}${escapeHtml(team)}</option>`
        );
    });
    DOM.telemetryCompareDriverSelect.innerHTML = options.join('');

    if (active) {
        populateCompareLapOptions(active.driverNumber, active.lapNumber);
    } else {
        hideTelemetryCompareLap();
    }
}

function hideTelemetryCompareLap() {
    if (DOM.telemetryCompareLapWrapper) DOM.telemetryCompareLapWrapper.style.display = 'none';
    if (DOM.telemetryDeltaWrapper) DOM.telemetryDeltaWrapper.style.display = 'none';
}

function populateCompareLapOptions(driverNumber, selectedLapNumber) {
    if (!DOM.telemetryCompareLapSelect) return;
    const html = buildTelemetryLapOptionsHtml(state.laps[driverNumber] || [], selectedLapNumber);
    DOM.telemetryCompareLapSelect.innerHTML = html;
    if (DOM.telemetryCompareLapWrapper) {
        DOM.telemetryCompareLapWrapper.style.display = html ? 'inline-flex' : 'none';
    }
}

async function onTelemetryCompareDriverChange() {
    if (!DOM.telemetryCompareDriverSelect) return;
    const value = DOM.telemetryCompareDriverSelect.value;
    if (!value) {
        state.telemetryCompare = null;
        hideTelemetryCompareLap();
        loadSelectedLapTelemetry();
        return;
    }
    const compareDriver = Number(value);
    // Reuse the laps-tab fetch to make the compare driver's laps available
    if (!state.laps[compareDriver] && state.selectedSession) {
        await fetchDriverLaps(state.selectedSession.session_key, compareDriver);
    }
    // The user may have changed the select again while awaiting
    if (Number(DOM.telemetryCompareDriverSelect.value) !== compareDriver) return;

    const fastest = fastestSelectableLap(state.laps[compareDriver] || []);
    const selectable = getTelemetrySelectableLaps(state.laps[compareDriver] || []);
    const lapNumber = fastest ? fastest.lap_number : (selectable[0] ? selectable[0].lap_number : null);
    if (lapNumber == null) {
        state.telemetryCompare = null;
        hideTelemetryCompareLap();
        loadSelectedLapTelemetry();
        return;
    }
    state.telemetryCompare = { driverNumber: compareDriver, lapNumber };
    populateCompareLapOptions(compareDriver, lapNumber);
    loadTelemetryComparison();
}

function onTelemetryCompareLapChange() {
    if (!state.telemetryCompare || !DOM.telemetryCompareLapSelect) return;
    const lapNumber = Number(DOM.telemetryCompareLapSelect.value);
    if (!Number.isFinite(lapNumber)) return;
    state.telemetryCompare = { ...state.telemetryCompare, lapNumber };
    loadTelemetryComparison();
}

function loadSelectedLapTelemetry() {
    if (!DOM.telemetryLapSelect || !state.selectedSession || state.selectedDriverStats === null) return;
    if (DOM.telemetrySection && DOM.telemetrySection.style.display === 'none') return;
    const lapNumber = Number(DOM.telemetryLapSelect.value);
    if (!Number.isFinite(lapNumber)) return;
    loadLapTelemetry(state.selectedDriverStats, lapNumber);
}

async function loadLapTelemetry(driverNumber, lapNumber) {
    const sessionKey = state.selectedSession.session_key;
    const cacheKey = `${sessionKey}_${driverNumber}_${lapNumber}`;

    // Responses can land after the user moved on to another driver/lap
    const isCurrentSelection = () => (
        Number(state.selectedDriverStats) === Number(driverNumber) &&
        Number(DOM.telemetryLapSelect && DOM.telemetryLapSelect.value) === Number(lapNumber)
    );

    const cached = state.telemetryCache[cacheKey];
    if (cached) {
        renderTelemetryStats(cached);
        renderTelemetryCharts(cached);
        return;
    }

    renderTelemetryMessage('Loading car telemetry...');

    try {
        const response = await customFetch(
            `/api/car_telemetry?session_key=${sessionKey}&driver_number=${driverNumber}&lap_number=${lapNumber}${sessionYearParam()}`
        );
        if (!isCurrentSelection()) return;
        if (!response.ok) {
            renderTelemetryMessage('No car telemetry available for this lap.');
            return;
        }
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.telemetry) || payload.telemetry.length === 0) {
            renderTelemetryMessage('No car telemetry recorded for this lap.');
            return;
        }
        state.telemetryCache[cacheKey] = payload;
        if (!isCurrentSelection()) return;
        renderTelemetryStats(payload);
        renderTelemetryCharts(payload);
    } catch (e) {
        console.error('Error loading lap telemetry:', e);
        if (isCurrentSelection()) {
            renderTelemetryMessage('Failed to load car telemetry.');
        }
    }
}

function renderTelemetryMessage(text) {
    if (DOM.telemetryStats) {
        DOM.telemetryStats.style.display = 'none';
    }
    // No payload on screen anymore: zoom/detail re-renders have nothing to redraw
    state.telemetryView.lastRender = null;
    [
        DOM.telemetrySpeedChart,
        DOM.telemetryInputsChart,
        DOM.telemetryThrottleChart,
        DOM.telemetryBrakeChart,
        DOM.telemetryGearChart
    ].forEach(container => {
        if (container) {
            container.innerHTML = `<div class="telemetry-chart-message">${escapeHtml(text)}</div>`;
        }
    });
}

// Show either the combined driver-inputs chart or the split detail charts
function applyTelemetryChartLayout() {
    const detail = !!state.telemetryView.detailMode;
    if (DOM.telemetryInputsWrapper) {
        DOM.telemetryInputsWrapper.style.display = detail ? 'none' : 'block';
    }
    [DOM.telemetryThrottleWrapper, DOM.telemetryBrakeWrapper, DOM.telemetryGearWrapper].forEach(wrapper => {
        if (wrapper) wrapper.style.display = detail ? 'block' : 'none';
    });
}

// Step-interpolated gear points: hold each gear until the next change
function buildGearStepPoints(samples, xKey = 't') {
    const points = [];
    let prevGear = null;
    samples.forEach(sample => {
        const x = Number(sample[xKey]);
        const gear = Number(sample.gear);
        if (!Number.isFinite(x) || !Number.isFinite(gear) || gear < 0) return;
        if (prevGear !== null && gear !== prevGear) points.push([x, prevGear]);
        points.push([x, gear]);
        prevGear = gear;
    });
    return points;
}

function renderTelemetryStats(payload) {
    if (!DOM.telemetryStats) return;
    const samples = payload.telemetry;

    const speeds = samples.map(s => Number(s.speed)).filter(Number.isFinite);
    const topSpeed = speeds.length ? Math.max(...speeds) : null;
    const avgSpeed = speeds.length ? speeds.reduce((acc, v) => acc + v, 0) / speeds.length : null;

    const throttleValues = samples.map(s => Number(s.throttle)).filter(Number.isFinite);
    const fullThrottlePct = throttleValues.length
        ? (throttleValues.filter(v => v >= 98).length / throttleValues.length) * 100
        : null;

    const brakeValues = samples.map(s => Number(s.brake)).filter(Number.isFinite);
    const brakingPct = brakeValues.length
        ? (brakeValues.filter(v => v > 0).length / brakeValues.length) * 100
        : null;

    let drsZones = 0;
    let drsOpen = false;
    samples.forEach(s => {
        const active = isTelemetryDrsActive(s.drs);
        if (active && !drsOpen) drsZones++;
        drsOpen = active;
    });

    const chips = [
        { label: 'Top Speed', value: topSpeed !== null ? `${Math.round(topSpeed)} km/h` : '--' },
        { label: 'Avg Speed', value: avgSpeed !== null ? `${Math.round(avgSpeed)} km/h` : '--' },
        { label: 'Full Throttle', value: fullThrottlePct !== null ? `${fullThrottlePct.toFixed(0)}%` : '--' },
        { label: 'Braking', value: brakingPct !== null ? `${brakingPct.toFixed(0)}%` : '--' },
        { label: 'DRS Zones', value: String(drsZones) }
    ];

    DOM.telemetryStats.innerHTML = chips.map(chip => `
        <div class="telemetry-stat-chip">
            <span class="stat-chip-label">${escapeHtml(chip.label)}</span>
            <span class="stat-chip-value">${escapeHtml(chip.value)}</span>
        </div>
    `).join('');
    DOM.telemetryStats.style.display = 'flex';
}

// ===== Telemetry zoom (drag an x-range on any chart, shared across all) =====

function isTelemetryZoomActive() {
    const win = state.telemetryView.window;
    return Number.isFinite(win.min) && Number.isFinite(win.max);
}

// Effective x-domain of the telemetry charts (seconds in single mode, metres in
// compare mode), clamped to the rendered lap's full range
function getTelemetryDomain(maxX) {
    if (isTelemetryZoomActive()) {
        const win = state.telemetryView.window;
        const min = Math.max(0, Math.min(win.min, win.max));
        const max = Math.min(maxX, Math.max(win.min, win.max));
        if (max > min) return { min, max };
    }
    return { min: 0, max: maxX };
}

function updateTelemetryZoomControl() {
    if (!DOM.telemetryResetZoom) return;
    DOM.telemetryResetZoom.style.display = isTelemetryZoomActive() ? 'inline-flex' : 'none';
}

function resetTelemetryZoom() {
    state.telemetryView.window = { min: null, max: null };
    state.telemetryView.zoomDrag = null;
    rerenderTelemetry();
}

// Re-render the current telemetry payload (zoom / detail-mode changes) without refetching
function rerenderTelemetry() {
    const last = state.telemetryView.lastRender;
    if (!last) return;
    if (last.mode === 'compare') {
        renderTelemetryComparison(last.payload);
    } else {
        renderTelemetryCharts(last.payload);
    }
}

// The zoom window only survives re-renders of the same lap/comparison payload
function syncTelemetryRenderState(key, mode, payload) {
    const last = state.telemetryView.lastRender;
    if (!last || last.key !== key) {
        state.telemetryView.window = { min: null, max: null };
    }
    state.telemetryView.lastRender = { key, mode, payload };
}

// Drag-to-zoom on a telemetry chart context, mirroring the Compare tab pattern
function attachTelemetryZoom(ctx) {
    if (!ctx || !ctx.overlay) return;

    const svgNamespace = "http://www.w3.org/2000/svg";
    const selection = document.createElementNS(svgNamespace, "rect");
    selection.setAttribute("y", ctx.padding.top);
    selection.setAttribute("height", ctx.chartHeight);
    selection.setAttribute("class", "telemetry-zoom-selection");
    selection.style.display = "none";
    ctx.svg.insertBefore(selection, ctx.overlay);

    const domain = ctx.domain || { min: 0, max: ctx.maxT };
    const pointerX = (event) => {
        const svgRect = ctx.svg.getBoundingClientRect();
        const scale = ctx.width / (svgRect.width || ctx.width || 1);
        const x = (event.clientX - svgRect.left) * scale;
        return Math.max(ctx.padding.left, Math.min(ctx.padding.left + ctx.chartWidth, x));
    };
    const valueAt = (x) => domain.min + ((x - ctx.padding.left) / (ctx.chartWidth || 1)) * (domain.max - domain.min);

    const updateSelection = (startX, currentX) => {
        const x = Math.min(startX, currentX);
        const width = Math.abs(currentX - startX);
        selection.setAttribute("x", x);
        selection.setAttribute("width", width);
        selection.style.display = width > 0 ? "block" : "none";
    };

    const finishDrag = (event) => {
        const drag = state.telemetryView.zoomDrag;
        if (!drag || drag.selection !== selection) return;

        const currentX = pointerX(event);
        state.telemetryView.zoomDrag = null;
        selection.style.display = "none";

        if (Math.abs(currentX - drag.startX) < 5) return;

        const start = valueAt(drag.startX);
        const end = valueAt(currentX);
        state.telemetryView.window = { min: Math.min(start, end), max: Math.max(start, end) };
        rerenderTelemetry();
    };

    ctx.overlay.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const startX = pointerX(event);
        state.telemetryView.zoomDrag = { selection, startX };
        updateSelection(startX, startX);
        event.preventDefault();

        const handleMouseUp = (upEvent) => {
            finishDrag(upEvent);
            window.removeEventListener("mouseup", handleMouseUp);
        };
        window.addEventListener("mouseup", handleMouseUp);
    });

    ctx.overlay.addEventListener("mousemove", (event) => {
        const drag = state.telemetryView.zoomDrag;
        if (!drag || drag.selection !== selection) return;
        updateSelection(drag.startX, pointerX(event));
    });
}

// Unique clip-path ids: telemetry charts are rebuilt often and ids are document-global
let telemetryClipIdCounter = 0;

// Build one telemetry SVG chart (grid, axes, series paths) and return a context
// used by the shared crosshair. seriesList: [{ points: [[t, value], ...], className, style }]
// options.domain zooms the x-axis to a sub-range; series are clipped to the plot area.
function buildTelemetryChart(container, height, maxT, yMax, seriesList, options = {}) {
    container.innerHTML = '';

    const width = container.clientWidth || 800;
    const padding = { top: 18, right: 20, bottom: 26, left: 48 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const domain = options.domain || { min: 0, max: maxT };
    const domainSpan = domain.max - domain.min;
    const getX = (t) => padding.left + (domainSpan > 0 ? ((t - domain.min) / domainSpan) * chartWidth : 0);
    const getY = (value) => padding.top + chartHeight - (yMax > 0 ? (value / yMax) * chartHeight : 0);

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    // Zoomed-out-of-range series geometry is clipped to the plot area
    const clipId = `telemetry-clip-${++telemetryClipIdCounter}`;
    const defs = document.createElementNS(svgNamespace, "defs");
    const clipPath = document.createElementNS(svgNamespace, "clipPath");
    clipPath.setAttribute("id", clipId);
    const clipRect = document.createElementNS(svgNamespace, "rect");
    clipRect.setAttribute("x", padding.left);
    clipRect.setAttribute("y", 0);
    clipRect.setAttribute("width", chartWidth);
    clipRect.setAttribute("height", height);
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

    // Y grid + labels
    const yGridLines = options.yGridLines || 4;
    for (let i = 0; i <= yGridLines; i++) {
        const value = (i / yGridLines) * yMax;
        const y = getY(value);

        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", padding.left + chartWidth);
        line.setAttribute("y2", y);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", padding.left - 8);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "end");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = options.formatYLabel ? options.formatYLabel(value) : Math.round(value);
        svg.appendChild(text);
    }

    // X grid + labels (seconds into the lap)
    const xGridLines = 6;
    for (let i = 0; i <= xGridLines; i++) {
        const t = domain.min + (i / xGridLines) * domainSpan;
        const x = getX(t);

        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", padding.top);
        line.setAttribute("x2", x);
        line.setAttribute("y2", padding.top + chartHeight);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", x);
        text.setAttribute("y", padding.top + chartHeight + 16);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "chart-axis-text");
        // Compare mode swaps the seconds axis for a distance axis via formatXLabel
        text.textContent = options.formatXLabel ? options.formatXLabel(t) : `${t.toFixed(domainSpan < 20 ? 1 : 0)}s`;
        svg.appendChild(text);
    }

    // DRS-active zones (speed chart only), clamped to the zoomed domain
    (options.drsZones || []).forEach(zone => {
        const zoneStart = Math.max(zone.start, domain.min);
        const zoneEnd = Math.min(zone.end, domain.max);
        if (zoneStart > zoneEnd) return;
        const xStart = getX(zoneStart);
        const xEnd = getX(zoneEnd);
        const zoneWidth = Math.max(xEnd - xStart, 2);

        const rect = document.createElementNS(svgNamespace, "rect");
        rect.setAttribute("x", xStart);
        rect.setAttribute("y", padding.top);
        rect.setAttribute("width", zoneWidth);
        rect.setAttribute("height", chartHeight);
        rect.setAttribute("class", "telemetry-drs-shading");
        svg.appendChild(rect);

        if (zoneWidth > 26) {
            const text = document.createElementNS(svgNamespace, "text");
            text.setAttribute("x", xStart + zoneWidth / 2);
            text.setAttribute("y", padding.top + 12);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("class", "telemetry-drs-text");
            text.textContent = "DRS";
            svg.appendChild(text);
        }
    });

    // Axis lines
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

    // Series paths (drawn full-length; the clip keeps zoomed views inside the plot)
    const seriesGroup = document.createElementNS(svgNamespace, "g");
    seriesGroup.setAttribute("clip-path", `url(#${clipId})`);
    seriesList.forEach(series => {
        if (series.points.length < 2) return;
        const d = series.points
            .map(([t, value], index) => `${index === 0 ? 'M' : 'L'} ${getX(t).toFixed(1)},${getY(value).toFixed(1)}`)
            .join(' ');
        const path = document.createElementNS(svgNamespace, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", series.className);
        if (series.style) {
            Object.entries(series.style).forEach(([prop, value]) => path.style.setProperty(prop, value));
        }
        seriesGroup.appendChild(path);
    });
    svg.appendChild(seriesGroup);

    // Crosshair (hidden until hover) + hover target
    const crosshair = document.createElementNS(svgNamespace, "line");
    crosshair.setAttribute("y1", padding.top);
    crosshair.setAttribute("y2", padding.top + chartHeight);
    crosshair.setAttribute("class", "telemetry-crosshair");
    crosshair.style.display = "none";
    svg.appendChild(crosshair);

    const overlay = document.createElementNS(svgNamespace, "rect");
    overlay.setAttribute("x", padding.left);
    overlay.setAttribute("y", padding.top);
    overlay.setAttribute("width", chartWidth);
    overlay.setAttribute("height", chartHeight);
    overlay.setAttribute("class", "telemetry-hover-target");
    svg.appendChild(overlay);

    container.appendChild(svg);

    return { svg, overlay, crosshair, getX, padding, chartWidth, chartHeight, width, maxT, domain };
}

function findNearestTelemetrySample(samples, t) {
    let nearest = null;
    let nearestDistance = Infinity;
    samples.forEach(sample => {
        const distance = Math.abs(Number(sample.t) - t);
        if (distance < nearestDistance) {
            nearest = sample;
            nearestDistance = distance;
        }
    });
    return nearest;
}

// Synchronized crosshair + tooltip across the speed and inputs charts
function attachTelemetryCrosshair(contexts, samples, payload) {
    let tooltip = document.querySelector(".chart-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }

    const hideAll = () => {
        contexts.forEach(ctx => { ctx.crosshair.style.display = "none"; });
        tooltip.style.display = "none";
    };

    contexts.forEach(ctx => {
        ctx.overlay.addEventListener("mousemove", (event) => {
            const svgRect = ctx.svg.getBoundingClientRect();
            if (svgRect.width === 0) return;
            const viewX = (event.clientX - svgRect.left) * (ctx.width / svgRect.width);
            const domain = ctx.domain || { min: 0, max: ctx.maxT };
            const t = domain.min + ((viewX - ctx.padding.left) / ctx.chartWidth) * (domain.max - domain.min);
            const sample = findNearestTelemetrySample(samples, t);
            if (!sample) return;

            contexts.forEach(c => {
                const x = c.getX(Number(sample.t));
                c.crosshair.setAttribute("x1", x);
                c.crosshair.setAttribute("x2", x);
                c.crosshair.style.display = "block";
            });

            const rows = [
                ['Speed', Number.isFinite(Number(sample.speed)) ? `${sample.speed} km/h` : '--'],
                ['Gear', Number.isFinite(Number(sample.gear)) && Number(sample.gear) > 0 ? sample.gear : 'N'],
                ['Throttle', Number.isFinite(Number(sample.throttle)) ? `${sample.throttle}%` : '--'],
                ['Brake', Number.isFinite(Number(sample.brake)) ? `${sample.brake}%` : '--'],
                ['DRS', sample.drs === null || sample.drs === undefined ? '--' : (isTelemetryDrsActive(sample.drs) ? 'Open' : 'Closed')]
            ];
            tooltip.innerHTML = `
                <div class="chart-tooltip-header">Lap ${escapeHtml(payload.lap_number)} — ${Number(sample.t).toFixed(2)}s</div>
                ${rows.map(([label, value]) => `
                    <div style="display:flex;justify-content:space-between;gap:14px;margin-bottom:2px;font-size:10px;">
                        <span style="color:var(--text-muted)">${escapeHtml(label)}:</span>
                        <span>${escapeHtml(value)}</span>
                    </div>
                `).join('')}
            `;
            tooltip.style.display = "block";
            tooltip.style.left = `${event.pageX + 14}px`;
            tooltip.style.top = `${event.pageY - tooltip.clientHeight / 2}px`;
        });

        ctx.overlay.addEventListener("mouseleave", hideAll);
    });
}

// The inputs legend is shared with compare mode; keep single-lap look here.
const TELEMETRY_LEGEND_DEFAULT_HTML =
    '<span><span class="telemetry-legend-swatch throttle"></span>Throttle</span>' +
    '<span><span class="telemetry-legend-swatch brake"></span>Brake</span>';

function getTelemetryLegendEl() {
    return document.querySelector('#telemetrySection .telemetry-legend');
}

function resetTelemetryLegend() {
    const legend = getTelemetryLegendEl();
    if (legend) legend.innerHTML = TELEMETRY_LEGEND_DEFAULT_HTML;
}

function renderTelemetryCharts(payload) {
    if (!DOM.telemetrySpeedChart || !DOM.telemetryInputsChart) return;
    resetTelemetryLegend();
    // Single-lap view never shows the delta chart (guards a failed-compare fallback)
    if (DOM.telemetryDeltaWrapper) DOM.telemetryDeltaWrapper.style.display = 'none';

    const samples = payload.telemetry.filter(s => Number.isFinite(Number(s.t)));
    if (samples.length < 2) {
        renderTelemetryMessage('Not enough telemetry samples to plot.');
        return;
    }

    syncTelemetryRenderState(
        `single_${payload.session_key}_${payload.driver_number}_${payload.lap_number}`,
        'single',
        payload
    );
    applyTelemetryChartLayout();

    const activeDriver = state.drivers.find(drv => Number(drv.driver_number) === Number(state.selectedDriverStats));
    const teamHex = getDriverTeamHex(activeDriver, 'ff1801');
    const teamRgb = getRGBColor(teamHex);

    const maxT = Math.max(Number(payload.lap_duration) || 0, Number(samples[samples.length - 1].t) || 0);

    // Contiguous DRS-open runs shade the speed trace
    const drsZones = [];
    let zoneStart = null;
    samples.forEach(sample => {
        const active = isTelemetryDrsActive(sample.drs);
        if (active && zoneStart === null) {
            zoneStart = Number(sample.t);
        } else if (!active && zoneStart !== null) {
            drsZones.push({ start: zoneStart, end: Number(sample.t) });
            zoneStart = null;
        }
    });
    if (zoneStart !== null) {
        drsZones.push({ start: zoneStart, end: maxT });
    }

    const speedPoints = samples
        .filter(s => Number.isFinite(Number(s.speed)))
        .map(s => [Number(s.t), Number(s.speed)]);
    const maxSpeed = speedPoints.length ? Math.max(...speedPoints.map(p => p[1])) : 0;
    const speedYMax = Math.max(Math.ceil(maxSpeed / 50) * 50, 50);

    const domain = getTelemetryDomain(maxT);

    const speedCtx = buildTelemetryChart(DOM.telemetrySpeedChart, 260, maxT, speedYMax, [
        {
            points: speedPoints,
            className: 'telemetry-speed-line',
            style: {
                '--team-color': `#${teamHex}`,
                '--team-color-glow': `rgba(${teamRgb}, 0.35)`
            }
        }
    ], { drsZones, formatYLabel: (v) => `${Math.round(v)}`, domain });

    const clampPct = (value) => Math.max(0, Math.min(100, Number(value)));
    const throttlePoints = samples
        .filter(s => Number.isFinite(Number(s.throttle)))
        .map(s => [Number(s.t), clampPct(s.throttle)]);
    const brakePoints = samples
        .filter(s => Number.isFinite(Number(s.brake)))
        .map(s => [Number(s.t), clampPct(s.brake)]);

    const contexts = [speedCtx];
    if (state.telemetryView.detailMode) {
        contexts.push(buildTelemetryChart(DOM.telemetryThrottleChart, 150, maxT, 100, [
            { points: throttlePoints, className: 'telemetry-throttle-line' }
        ], { yGridLines: 2, formatYLabel: (v) => `${Math.round(v)}%`, domain }));

        contexts.push(buildTelemetryChart(DOM.telemetryBrakeChart, 150, maxT, 100, [
            { points: brakePoints, className: 'telemetry-brake-line' }
        ], { yGridLines: 2, formatYLabel: (v) => `${Math.round(v)}%`, domain }));

        const gearPoints = buildGearStepPoints(samples, 't');
        const gearYMax = Math.max(gearPoints.reduce((m, p) => Math.max(m, p[1]), 0), 1);
        contexts.push(buildTelemetryChart(DOM.telemetryGearChart, 150, maxT, gearYMax, [
            {
                points: gearPoints,
                className: 'telemetry-gear-line',
                style: { '--team-color': `#${teamHex}` }
            }
        ], { yGridLines: gearYMax, formatYLabel: (v) => `${Math.round(v)}`, domain }));
    } else {
        contexts.push(buildTelemetryChart(DOM.telemetryInputsChart, 170, maxT, 100, [
            { points: throttlePoints, className: 'telemetry-throttle-line' },
            { points: brakePoints, className: 'telemetry-brake-line' }
        ], { yGridLines: 2, formatYLabel: (v) => `${Math.round(v)}%`, domain }));
    }

    attachTelemetryCrosshair(contexts, samples, payload);
    contexts.forEach(attachTelemetryZoom);
    updateTelemetryZoomControl();
}

// ===== Lap Telemetry Compare (two laps, distance-aligned) =====

async function loadTelemetryComparison() {
    if (!state.telemetryCompare || !state.selectedSession || state.selectedDriverStats === null) return;
    if (DOM.telemetrySection && DOM.telemetrySection.style.display === 'none') return;
    if (!DOM.telemetryLapSelect) return;

    const mainLap = Number(DOM.telemetryLapSelect.value);
    if (!Number.isFinite(mainLap)) return;
    const mainDriver = Number(state.selectedDriverStats);
    const refDriver = Number(state.telemetryCompare.driverNumber);
    const refLap = Number(state.telemetryCompare.lapNumber);
    if (!Number.isFinite(refLap)) return;

    const sessionKey = state.selectedSession.session_key;
    const cacheKey = `cmp_${sessionKey}_${mainDriver}_${mainLap}_${refDriver}_${refLap}`;

    // Responses can land after the user moved on to another lap/driver/comparison
    const isCurrentSelection = () => (
        Number(state.selectedDriverStats) === mainDriver &&
        Number(DOM.telemetryLapSelect.value) === mainLap &&
        state.telemetryCompare &&
        Number(state.telemetryCompare.driverNumber) === refDriver &&
        Number(state.telemetryCompare.lapNumber) === refLap
    );

    const cached = state.telemetryCache[cacheKey];
    if (cached) {
        renderTelemetryComparison(cached);
        return;
    }

    renderTelemetryMessage('Loading telemetry comparison...');

    try {
        const response = await customFetch(
            `/api/telemetry_compare?session_key=${sessionKey}&driver_number=${mainDriver}&lap_number=${mainLap}` +
            `&ref_driver_number=${refDriver}&ref_lap_number=${refLap}${sessionYearParam()}`
        );
        if (!isCurrentSelection()) return;
        if (!response.ok) {
            renderTelemetryMessage('No telemetry available for this comparison.');
            loadSelectedLapTelemetry();
            return;
        }
        const payload = await response.json();
        if (!payload || !payload.main || !Array.isArray(payload.main.telemetry) || payload.main.telemetry.length === 0) {
            renderTelemetryMessage('No telemetry recorded for this comparison.');
            loadSelectedLapTelemetry();
            return;
        }
        state.telemetryCache[cacheKey] = payload;
        if (!isCurrentSelection()) return;
        renderTelemetryComparison(payload);
    } catch (e) {
        console.error('Error loading telemetry comparison:', e);
        if (isCurrentSelection()) {
            renderTelemetryMessage('Failed to load telemetry comparison.');
            loadSelectedLapTelemetry();
        }
    }
}

// Contiguous DRS-open runs of a lap, keyed by cumulative distance (compare mode)
function buildDrsZonesByDistance(samples, maxX) {
    const zones = [];
    let start = null;
    samples.forEach(sample => {
        const active = isTelemetryDrsActive(sample.drs);
        if (active && start === null) {
            start = Number(sample.d);
        } else if (!active && start !== null) {
            zones.push({ start, end: Number(sample.d) });
            start = null;
        }
    });
    if (start !== null) zones.push({ start, end: maxX });
    return zones;
}

// Symmetric y-bound for the delta chart: smallest nice step covering max |gap|
function niceDeltaBound(maxGap) {
    if (!Number.isFinite(maxGap) || maxGap <= 0) return 0.5;
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    for (const step of steps) {
        if (maxGap <= step) return step;
    }
    return Math.ceil(maxGap);
}

// Time-delta chart: gap (s) vs distance, y-axis symmetric around a dashed zero line
function buildTelemetryDeltaChart(container, height, maxX, deltaSamples, formatXLabel, domainOverride = null) {
    container.innerHTML = '';

    const width = container.clientWidth || 800;
    const padding = { top: 16, right: 20, bottom: 26, left: 48 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxGap = deltaSamples.reduce((m, pt) => Math.max(m, Math.abs(Number(pt.gap) || 0)), 0);
    const yBound = niceDeltaBound(maxGap);

    const domain = domainOverride || { min: 0, max: maxX };
    const domainSpan = domain.max - domain.min;
    const getX = (d) => padding.left + (domainSpan > 0 ? ((d - domain.min) / domainSpan) * chartWidth : 0);
    const getY = (gap) => padding.top + chartHeight / 2 - (yBound > 0 ? (gap / yBound) * (chartHeight / 2) : 0);

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    // Same plot-area clip as buildTelemetryChart, for zoomed-out-of-range geometry
    const clipId = `telemetry-clip-${++telemetryClipIdCounter}`;
    const defs = document.createElementNS(svgNamespace, "defs");
    const clipPath = document.createElementNS(svgNamespace, "clipPath");
    clipPath.setAttribute("id", clipId);
    const clipRect = document.createElementNS(svgNamespace, "rect");
    clipRect.setAttribute("x", padding.left);
    clipRect.setAttribute("y", 0);
    clipRect.setAttribute("width", chartWidth);
    clipRect.setAttribute("height", height);
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

    // Y grid + labels (+bound .. 0 .. -bound)
    [yBound, yBound / 2, 0, -yBound / 2, -yBound].forEach(value => {
        const y = getY(value);
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", padding.left + chartWidth);
        line.setAttribute("y2", y);
        line.setAttribute("class", value === 0 ? "telemetry-delta-zero" : "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", padding.left - 8);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "end");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = `${value > 0 ? '+' : ''}${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
        svg.appendChild(text);
    });

    // X grid + labels (distance)
    const xGridLines = 6;
    for (let i = 0; i <= xGridLines; i++) {
        const d = domain.min + (i / xGridLines) * domainSpan;
        const x = getX(d);
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", padding.top);
        line.setAttribute("x2", x);
        line.setAttribute("y2", padding.top + chartHeight);
        line.setAttribute("class", "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", x);
        text.setAttribute("y", padding.top + chartHeight + 16);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = formatXLabel ? formatXLabel(d) : `${Math.round(d)}`;
        svg.appendChild(text);
    }

    // Axis lines
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

    // Delta line
    if (deltaSamples.length >= 2) {
        const d = deltaSamples
            .map((pt, index) => `${index === 0 ? 'M' : 'L'} ${getX(Number(pt.d)).toFixed(1)},${getY(Number(pt.gap)).toFixed(1)}`)
            .join(' ');
        const path = document.createElementNS(svgNamespace, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", "telemetry-delta-line");
        const deltaGroup = document.createElementNS(svgNamespace, "g");
        deltaGroup.setAttribute("clip-path", `url(#${clipId})`);
        deltaGroup.appendChild(path);
        svg.appendChild(deltaGroup);
    }

    // Crosshair + hover target (shared with the speed/inputs charts)
    const crosshair = document.createElementNS(svgNamespace, "line");
    crosshair.setAttribute("y1", padding.top);
    crosshair.setAttribute("y2", padding.top + chartHeight);
    crosshair.setAttribute("class", "telemetry-crosshair");
    crosshair.style.display = "none";
    svg.appendChild(crosshair);

    const overlay = document.createElementNS(svgNamespace, "rect");
    overlay.setAttribute("x", padding.left);
    overlay.setAttribute("y", padding.top);
    overlay.setAttribute("width", chartWidth);
    overlay.setAttribute("height", chartHeight);
    overlay.setAttribute("class", "telemetry-hover-target");
    svg.appendChild(overlay);

    container.appendChild(svg);
    return { svg, overlay, crosshair, getX, padding, chartWidth, chartHeight, width, maxT: maxX, domain };
}

function findNearestTelemetrySampleByDistance(samples, d) {
    let nearest = null;
    let nearestDistance = Infinity;
    samples.forEach(sample => {
        const distance = Math.abs(Number(sample.d) - d);
        if (distance < nearestDistance) {
            nearest = sample;
            nearestDistance = distance;
        }
    });
    return nearest;
}

// Shared distance crosshair across the speed, inputs and delta charts showing
// both laps' values plus the gap at the nearest distance.
function attachTelemetryCompareCrosshair(contexts, mainSamples, refSamples, deltaSamples, mainLabel, refLabel) {
    let tooltip = document.querySelector(".chart-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }

    const hideAll = () => {
        contexts.forEach(ctx => { ctx.crosshair.style.display = "none"; });
        tooltip.style.display = "none";
    };

    const fmt = (sample, key, unit) =>
        (sample && Number.isFinite(Number(sample[key]))) ? `${sample[key]}${unit}` : '--';
    const gearOf = (sample) =>
        (sample && Number.isFinite(Number(sample.gear)) && Number(sample.gear) > 0) ? sample.gear : 'N';

    contexts.forEach(ctx => {
        ctx.overlay.addEventListener("mousemove", (event) => {
            const svgRect = ctx.svg.getBoundingClientRect();
            if (svgRect.width === 0) return;
            const viewX = (event.clientX - svgRect.left) * (ctx.width / svgRect.width);
            const domain = ctx.domain || { min: 0, max: ctx.maxT };
            const d = domain.min + ((viewX - ctx.padding.left) / ctx.chartWidth) * (domain.max - domain.min);
            const mainSample = findNearestTelemetrySampleByDistance(mainSamples, d);
            const refSample = findNearestTelemetrySampleByDistance(refSamples, d);
            if (!mainSample) return;
            const anchorD = Number(mainSample.d);

            contexts.forEach(c => {
                const x = c.getX(anchorD);
                c.crosshair.setAttribute("x1", x);
                c.crosshair.setAttribute("x2", x);
                c.crosshair.style.display = "block";
            });

            const gapPt = deltaSamples.length ? findNearestTelemetrySampleByDistance(deltaSamples, anchorD) : null;
            const gapText = gapPt
                ? `${Number(gapPt.gap) >= 0 ? '+' : ''}${Number(gapPt.gap).toFixed(3)} s`
                : '--';
            const rows = [
                ['Distance', `${Math.round(anchorD)} m`],
                ['Speed', `${fmt(mainSample, 'speed', ' km/h')} / ${fmt(refSample, 'speed', ' km/h')}`],
                ['Gear', `${gearOf(mainSample)} / ${gearOf(refSample)}`],
                ['Throttle', `${fmt(mainSample, 'throttle', '%')} / ${fmt(refSample, 'throttle', '%')}`],
                ['Brake', `${fmt(mainSample, 'brake', '%')} / ${fmt(refSample, 'brake', '%')}`],
                ['Gap', gapText]
            ];
            tooltip.innerHTML = `
                <div class="chart-tooltip-header">${escapeHtml(mainLabel)} vs ${escapeHtml(refLabel)}</div>
                ${rows.map(([label, value]) => `
                    <div style="display:flex;justify-content:space-between;gap:14px;margin-bottom:2px;font-size:10px;">
                        <span style="color:var(--text-muted)">${escapeHtml(label)}:</span>
                        <span>${escapeHtml(value)}</span>
                    </div>
                `).join('')}
            `;
            tooltip.style.display = "block";
            tooltip.style.left = `${event.pageX + 14}px`;
            tooltip.style.top = `${event.pageY - tooltip.clientHeight / 2}px`;
        });

        ctx.overlay.addEventListener("mouseleave", hideAll);
    });
}

function renderTelemetryCompareStats(mainSamples, refSamples) {
    if (!DOM.telemetryStats) return;

    const statOf = (samples) => {
        const speeds = samples.map(s => Number(s.speed)).filter(Number.isFinite);
        const topSpeed = speeds.length ? Math.max(...speeds) : null;
        const avgSpeed = speeds.length ? speeds.reduce((acc, v) => acc + v, 0) / speeds.length : null;
        const throttleValues = samples.map(s => Number(s.throttle)).filter(Number.isFinite);
        const fullThrottle = throttleValues.length
            ? (throttleValues.filter(v => v >= 98).length / throttleValues.length) * 100 : null;
        const brakeValues = samples.map(s => Number(s.brake)).filter(Number.isFinite);
        const braking = brakeValues.length
            ? (brakeValues.filter(v => v > 0).length / brakeValues.length) * 100 : null;
        let drsZones = 0, drsOpen = false;
        samples.forEach(s => {
            const active = isTelemetryDrsActive(s.drs);
            if (active && !drsOpen) drsZones++;
            drsOpen = active;
        });
        return {
            topSpeed: topSpeed !== null ? Math.round(topSpeed) : null,
            avgSpeed: avgSpeed !== null ? Math.round(avgSpeed) : null,
            fullThrottle: fullThrottle !== null ? Math.round(fullThrottle) : null,
            braking: braking !== null ? Math.round(braking) : null,
            drsZones
        };
    };

    const m = statOf(mainSamples);
    const r = statOf(refSamples);
    const pair = (a, b) => `${a === null ? '--' : a} / ${b === null ? '--' : b}`;
    const chips = [
        { label: 'Top Speed', value: `${pair(m.topSpeed, r.topSpeed)} km/h` },
        { label: 'Avg Speed', value: `${pair(m.avgSpeed, r.avgSpeed)} km/h` },
        { label: 'Full Throttle', value: `${pair(m.fullThrottle, r.fullThrottle)}%` },
        { label: 'Braking', value: `${pair(m.braking, r.braking)}%` },
        { label: 'DRS Zones', value: pair(m.drsZones, r.drsZones) }
    ];

    DOM.telemetryStats.innerHTML = chips.map(chip => `
        <div class="telemetry-stat-chip">
            <span class="stat-chip-label">${escapeHtml(chip.label)}</span>
            <span class="stat-chip-value">${escapeHtml(chip.value)}</span>
        </div>
    `).join('');
    DOM.telemetryStats.style.display = 'flex';
}

function renderTelemetryCompareLegend(mainHex, refHex, mainLabel, refLabel) {
    const legend = getTelemetryLegendEl();
    if (!legend) return;
    // mainHex/refHex come from getDriverTeamHex (validated hex) so they are inline-style safe
    legend.innerHTML =
        `<span><span class="telemetry-legend-swatch" style="background:#${mainHex}"></span>${escapeHtml(mainLabel)}</span>` +
        `<span><span class="telemetry-legend-swatch ref" style="color:#${refHex}"></span>${escapeHtml(refLabel)}</span>` +
        '<span><span class="telemetry-legend-swatch throttle"></span>Throttle</span>' +
        '<span><span class="telemetry-legend-swatch brake"></span>Brake</span>';
}

function renderTelemetryComparison(payload) {
    if (!DOM.telemetrySpeedChart || !DOM.telemetryInputsChart) return;

    const main = payload.main || {};
    const ref = payload.ref || {};
    const mainSamples = (main.telemetry || []).filter(s => Number.isFinite(Number(s.d)));
    const refSamples = (ref.telemetry || []).filter(s => Number.isFinite(Number(s.d)));
    if (mainSamples.length < 2 || refSamples.length < 2) {
        renderTelemetryMessage('Not enough telemetry samples to compare.');
        return;
    }

    syncTelemetryRenderState(
        `compare_${main.session_key}_${main.driver_number}_${main.lap_number}_${ref.driver_number}_${ref.lap_number}`,
        'compare',
        payload
    );
    applyTelemetryChartLayout();

    const mainDriver = state.drivers.find(d => Number(d.driver_number) === Number(main.driver_number));
    const refDriver = state.drivers.find(d => Number(d.driver_number) === Number(ref.driver_number));
    const mainHex = getDriverTeamHex(mainDriver, 'ff1801');
    const mainRgb = getRGBColor(mainHex);
    const refHex = getDriverTeamHex(refDriver, '9aa4b2');
    const mainLabel = `${(mainDriver && mainDriver.name_acronym) || `#${main.driver_number}`} L${main.lap_number}`;
    const refLabel = `${(refDriver && refDriver.name_acronym) || `#${ref.driver_number}`} L${ref.lap_number}`;

    const lastD = (samples) => Number(samples[samples.length - 1].d) || 0;
    const maxX = Math.max(lastD(mainSamples), lastD(refSamples));
    const fmtXLabel = (d) => `${Math.round(d)}m`;

    renderTelemetryCompareStats(mainSamples, refSamples);
    renderTelemetryCompareLegend(mainHex, refHex, mainLabel, refLabel);

    // Speed chart — distance x-axis so corners align; DRS shading from the main lap only
    const toSpeedPoints = (samples) => samples
        .filter(s => Number.isFinite(Number(s.speed)))
        .map(s => [Number(s.d), Number(s.speed)]);
    const mainSpeed = toSpeedPoints(mainSamples);
    const refSpeed = toSpeedPoints(refSamples);
    const maxSpeed = Math.max(
        mainSpeed.length ? Math.max(...mainSpeed.map(p => p[1])) : 0,
        refSpeed.length ? Math.max(...refSpeed.map(p => p[1])) : 0
    );
    const speedYMax = Math.max(Math.ceil(maxSpeed / 50) * 50, 50);
    const mainDrsZones = buildDrsZonesByDistance(mainSamples, maxX);
    const domain = getTelemetryDomain(maxX);

    const speedCtx = buildTelemetryChart(DOM.telemetrySpeedChart, 260, maxX, speedYMax, [
        { points: refSpeed, className: 'telemetry-ref-speed-line', style: { '--ref-team-color': `#${refHex}` } },
        {
            points: mainSpeed,
            className: 'telemetry-speed-line',
            style: { '--team-color': `#${mainHex}`, '--team-color-glow': `rgba(${mainRgb}, 0.35)` }
        }
    ], { drsZones: mainDrsZones, formatYLabel: (v) => `${Math.round(v)}`, formatXLabel: fmtXLabel, domain });

    // Inputs chart — ref lines drawn underneath the main lines
    const clampPct = (value) => Math.max(0, Math.min(100, Number(value)));
    const toInputPoints = (samples, key) => samples
        .filter(s => Number.isFinite(Number(s[key])))
        .map(s => [Number(s.d), clampPct(s[key])]);

    const contexts = [speedCtx];
    if (state.telemetryView.detailMode) {
        contexts.push(buildTelemetryChart(DOM.telemetryThrottleChart, 150, maxX, 100, [
            { points: toInputPoints(refSamples, 'throttle'), className: 'telemetry-ref-throttle-line' },
            { points: toInputPoints(mainSamples, 'throttle'), className: 'telemetry-throttle-line' }
        ], { yGridLines: 2, formatYLabel: (v) => `${Math.round(v)}%`, formatXLabel: fmtXLabel, domain }));

        contexts.push(buildTelemetryChart(DOM.telemetryBrakeChart, 150, maxX, 100, [
            { points: toInputPoints(refSamples, 'brake'), className: 'telemetry-ref-brake-line' },
            { points: toInputPoints(mainSamples, 'brake'), className: 'telemetry-brake-line' }
        ], { yGridLines: 2, formatYLabel: (v) => `${Math.round(v)}%`, formatXLabel: fmtXLabel, domain }));

        const mainGear = buildGearStepPoints(mainSamples, 'd');
        const refGear = buildGearStepPoints(refSamples, 'd');
        const gearYMax = Math.max(
            mainGear.reduce((m, p) => Math.max(m, p[1]), 0),
            refGear.reduce((m, p) => Math.max(m, p[1]), 0),
            1
        );
        contexts.push(buildTelemetryChart(DOM.telemetryGearChart, 150, maxX, gearYMax, [
            { points: refGear, className: 'telemetry-ref-gear-line', style: { '--ref-team-color': `#${refHex}` } },
            { points: mainGear, className: 'telemetry-gear-line', style: { '--team-color': `#${mainHex}` } }
        ], { yGridLines: gearYMax, formatYLabel: (v) => `${Math.round(v)}`, formatXLabel: fmtXLabel, domain }));
    } else {
        contexts.push(buildTelemetryChart(DOM.telemetryInputsChart, 170, maxX, 100, [
            { points: toInputPoints(refSamples, 'throttle'), className: 'telemetry-ref-throttle-line' },
            { points: toInputPoints(refSamples, 'brake'), className: 'telemetry-ref-brake-line' },
            { points: toInputPoints(mainSamples, 'throttle'), className: 'telemetry-throttle-line' },
            { points: toInputPoints(mainSamples, 'brake'), className: 'telemetry-brake-line' }
        ], { yGridLines: 2, formatYLabel: (v) => `${Math.round(v)}%`, formatXLabel: fmtXLabel, domain }));
    }

    // Delta chart
    const deltaSamples = (payload.delta || [])
        .filter(pt => Number.isFinite(Number(pt.d)) && Number.isFinite(Number(pt.gap)));
    if (DOM.telemetryDeltaWrapper && DOM.telemetryDeltaChart && deltaSamples.length >= 2) {
        DOM.telemetryDeltaWrapper.style.display = 'block';
        if (DOM.telemetryDeltaHeading) {
            DOM.telemetryDeltaHeading.textContent = `Gap (s) — above zero = ${mainLabel} behind ${refLabel}`;
        }
        const deltaCtx = buildTelemetryDeltaChart(DOM.telemetryDeltaChart, 150, maxX, deltaSamples, fmtXLabel, domain);
        contexts.push(deltaCtx);
    } else if (DOM.telemetryDeltaWrapper) {
        DOM.telemetryDeltaWrapper.style.display = 'none';
    }

    attachTelemetryCompareCrosshair(contexts, mainSamples, refSamples, deltaSamples, mainLabel, refLabel);
    contexts.forEach(attachTelemetryZoom);
    updateTelemetryZoomControl();
}

// Helper: Show full dashboard loading
function showDashboardLoading() {
    DOM.emptyState.style.display = 'flex';
    DOM.emptyState.innerHTML = `
        <div class="spinner"></div>
        <h2 style="margin-top:16px;">Loading Session Details...</h2>
        <p>Fetching driver, lap, weather, and stint data from F1 Livetiming...</p>
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
