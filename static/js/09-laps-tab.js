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
        let teamHex = d.team_colour || TEAM_COLORS[(d.team_name || '').toLowerCase()] || '787878';
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
                DOM.statsDriverWiki.href = d.wiki_url;
                DOM.statsDriverWiki.style.display = 'inline-flex';
            } else {
                DOM.statsDriverWiki.style.display = 'none';
            }
        }
        
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
            lapsTableHTML = '<tr><td colspan="6" style="text-align:center;">No lap data recorded for this driver.</td></tr>';
        } else {
            laps.forEach(lap => {
                const isFastest = lap.lap_duration === fastestDuration;
                const isBestS1 = lap.duration_sector_1 === bestS1;
                const isBestS2 = lap.duration_sector_2 === bestS2;
                const isBestS3 = lap.duration_sector_3 === bestS3;
                const pitAnnotation = getLapPitAnnotation(driverNumber, lap.lap_number);
                const rowClasses = [
                    pitAnnotation.isPitIn ? 'lap-row-pit-in' : '',
                    pitAnnotation.isPitOut ? 'lap-row-pit-out' : ''
                ].filter(Boolean).join(' ');

                lapsTableHTML += `
                    <tr id="lap-row-${lap.lap_number}" class="${rowClasses}">
                        <td>${lap.lap_number}</td>
                        <td class="pit-lap-cell">${renderPitLapBadges(pitAnnotation)}</td>
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
    
    const qualifyingAxis = buildQualifyingPhaseAxis(validLaps, state.raceControl, state.selectedSession);
    const minLap = Math.min(...validLaps.map(l => l.lap_number));
    const maxLap = Math.max(...validLaps.map(l => l.lap_number));
    const minXValue = qualifyingAxis ? qualifyingAxis.min : minLap;
    const maxXValue = qualifyingAxis ? qualifyingAxis.max : maxLap;

    // Chart margins and sizes
    const width = DOM.lapsChartContainer.clientWidth || 800;
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

        // Hover interactions
        circle.addEventListener("mouseenter", (e) => {
            circle.classList.add("active");
            if (!isOutlier) {
                circle.style.fill = `#${teamHex}`;
            }
            
            // Show Tooltip
            tooltip.style.display = "block";
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
                ${renderPitTooltipRows(pitAnnotation)}
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
