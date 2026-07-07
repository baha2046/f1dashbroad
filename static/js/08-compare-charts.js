
function getLapEndTime(lap) {
    if (!lap || !lap.date_start) return null;
    const start = new Date(lap.date_start).getTime();
    const duration = Number(lap.lap_duration);
    if (!Number.isFinite(start) || !Number.isFinite(duration)) return null;
    return start + duration * 1000;
}

function buildPositionByLapMap() {
    const positionByLap = {};
    const eventsByDriver = {};

    if (!Array.isArray(state.position) || state.position.length === 0) {
        state.positionByLap = positionByLap;
        return positionByLap;
    }

    state.position.forEach(event => {
        const driverNumber = Number(event.driver_number);
        const position = Number(event.position);
        const timestamp = new Date(event.date).getTime();
        if (!Number.isFinite(driverNumber) || !Number.isFinite(position) || !Number.isFinite(timestamp)) return;
        if (!eventsByDriver[driverNumber]) eventsByDriver[driverNumber] = [];
        eventsByDriver[driverNumber].push({ ...event, driverNumber, position, timestamp });
    });

    Object.keys(eventsByDriver).forEach(driverKey => {
        const driverNumber = Number(driverKey);
        const events = eventsByDriver[driverNumber].sort((a, b) => a.timestamp - b.timestamp);
        const laps = (state.laps[driverNumber] || [])
            .filter(lap => Number.isFinite(Number(lap.lap_number)))
            .sort((a, b) => Number(a.lap_number) - Number(b.lap_number));

        if (events.length === 0 || laps.length === 0) return;

        positionByLap[driverNumber] = {};
        let eventIndex = 0;

        laps.forEach(lap => {
            const lapNumber = Number(lap.lap_number);
            const lapEnd = getLapEndTime(lap);
            if (!Number.isFinite(lapEnd)) return;

            while (eventIndex + 1 < events.length && events[eventIndex + 1].timestamp <= lapEnd) {
                eventIndex += 1;
            }

            const event = events[eventIndex].timestamp <= lapEnd ? events[eventIndex] : events[0];
            positionByLap[driverNumber][lapNumber] = event.position;
        });
    });

    state.positionByLap = positionByLap;
    return positionByLap;
}

function formatComparePositionDelta(delta) {
    if (!Number.isFinite(delta) || delta === 0) {
        return '<span class="compare-position-delta-even">-</span>';
    }
    if (delta > 0) {
        return `<span class="compare-position-delta-gain">▲${delta}</span>`;
    }
    return `<span class="compare-position-delta-loss">▼${Math.abs(delta)}</span>`;
}

function formatSignedDelta(value) {
    const delta = Number(value);
    if (!Number.isFinite(delta)) return '--';
    if (delta === 0) return '0.000s';
    return `${delta > 0 ? '+' : ''}${delta.toFixed(3)}s`;
}

function getCompareLapsByDriver(resolvedDrivers = null) {
    const lapsByDriver = {};
    if (state.allSessionLaps && state.allSessionLaps.length > 0) {
        state.allSessionLaps.forEach(lap => {
            const dn = Number(lap.driver_number);
            if (!Number.isFinite(dn)) return;
            if (!lapsByDriver[dn]) {
                lapsByDriver[dn] = [];
            }
            lapsByDriver[dn].push(lap);
        });
    } else {
        (resolvedDrivers || []).forEach(driver => {
            const dn = Number(driver.driver_number);
            lapsByDriver[dn] = state.laps[dn] || [];
        });
    }
    return lapsByDriver;
}

function buildCompareCumulativeTimes(resolvedDrivers = null) {
    const lapsByDriver = getCompareLapsByDriver(resolvedDrivers);
    const allDriversCumulative = {};

    for (const dn in lapsByDriver) {
        lapsByDriver[dn].sort((a, b) => Number(a.lap_number) - Number(b.lap_number));
        let cumulative = 0;
        allDriversCumulative[dn] = {};
        for (const lap of lapsByDriver[dn]) {
            const lapNum = Number(lap.lap_number);
            const duration = Number(lap.lap_duration);
            if (duration && !isNaN(duration)) {
                cumulative += duration;
                allDriversCumulative[dn][lapNum] = cumulative;
            } else {
                break;
            }
        }
    }

    const leaderCumulativeAtLap = {};
    let maxLapNum = 0;
    for (const dn in allDriversCumulative) {
        for (const lapStr in allDriversCumulative[dn]) {
            const lapNum = Number(lapStr);
            if (lapNum > maxLapNum) {
                maxLapNum = lapNum;
            }
        }
    }

    for (let lapNum = 1; lapNum <= maxLapNum; lapNum++) {
        let minCume = Infinity;
        for (const dn in allDriversCumulative) {
            const cume = allDriversCumulative[dn][lapNum];
            if (cume !== undefined && cume < minCume) {
                minCume = cume;
            }
        }
        if (minCume !== Infinity) {
            leaderCumulativeAtLap[lapNum] = minCume;
        }
    }

    return { lapsByDriver, allDriversCumulative, leaderCumulativeAtLap, maxLapNum };
}

function chooseHeadToHeadReference(selectedDrivers, allDriversCumulative = null) {
    const selectedNumbers = selectedDrivers.map(driver => Number(driver.driver_number));
    const currentRef = Number(state.compareView.headToHeadRef);
    if (selectedNumbers.includes(currentRef)) {
        return currentRef;
    }

    let bestDriver = null;
    let bestCumulative = Infinity;
    selectedNumbers.forEach(driverNumber => {
        const cumulativeByLap = (allDriversCumulative || {})[driverNumber] || {};
        const lapNumbers = Object.keys(cumulativeByLap).map(Number).filter(Number.isFinite);
        if (lapNumbers.length === 0) return;

        const finalLap = Math.max(...lapNumbers);
        const finalCumulative = cumulativeByLap[finalLap];
        if (Number.isFinite(finalCumulative) && finalCumulative < bestCumulative) {
            bestCumulative = finalCumulative;
            bestDriver = driverNumber;
        }
    });

    if (bestDriver !== null) {
        state.compareView.headToHeadRef = bestDriver;
    }
    return bestDriver;
}

function populateHeadToHeadReferencePicker(selectedDrivers, refDriverNumber) {
    if (!DOM.compareHeadToHeadRef) return;

    DOM.compareHeadToHeadRef.innerHTML = selectedDrivers.map(driver => {
        const driverNumber = Number(driver.driver_number);
        return `<option value="${driverNumber}"${driverNumber === Number(refDriverNumber) ? ' selected' : ''}>${escapeHtml(getCompareDriverLabel(driver))}</option>`;
    }).join('');
}

async function toggleCompareDriver(driverNumber) {
    const normalizedDriverNumber = Number(driverNumber);
    if (Number.isNaN(normalizedDriverNumber)) return;

    const existingIndex = state.selectedCompareDrivers.indexOf(normalizedDriverNumber);
    if (existingIndex >= 0) {
        state.selectedCompareDrivers.splice(existingIndex, 1);
        state.compareView.mutedDrivers.delete(normalizedDriverNumber);
        if (state.compareView.highlightedDriver === normalizedDriverNumber) {
            state.compareView.highlightedDriver = null;
        }
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

function isCompareZoomActive() {
    const lapWindow = state.compareView.lapWindow;
    return Number.isFinite(lapWindow.min) && Number.isFinite(lapWindow.max);
}

function updateCompareZoomControl() {
    if (!DOM.compareResetZoom) return;
    DOM.compareResetZoom.style.display = isCompareZoomActive() && state.selectedCompareDrivers.length > 0
        ? 'inline-flex'
        : 'none';
}

function getCompareDriverLabel(driver) {
    return driver.name_acronym || driver.last_name || driver.driver_number;
}

function pruneCompareViewState(selectedDrivers) {
    const selectedNumbers = new Set(selectedDrivers.map(driver => Number(driver.driver_number)));
    state.compareView.mutedDrivers.forEach(driverNumber => {
        if (!selectedNumbers.has(Number(driverNumber))) {
            state.compareView.mutedDrivers.delete(driverNumber);
        }
    });

    if (
        state.compareView.highlightedDriver !== null &&
        !selectedNumbers.has(Number(state.compareView.highlightedDriver))
    ) {
        state.compareView.highlightedDriver = null;
    }

    if (
        state.compareView.headToHeadRef !== null &&
        !selectedNumbers.has(Number(state.compareView.headToHeadRef))
    ) {
        state.compareView.headToHeadRef = null;
    }
}

function isCompareDriverMuted(driverNumber) {
    return state.compareView.mutedDrivers.has(Number(driverNumber));
}

function getCompareItemStateClasses(driverNumber) {
    const muted = isCompareDriverMuted(driverNumber);
    const highlighted = state.compareView.highlightedDriver;
    return [
        muted ? 'dimmed' : '',
        highlighted !== null && Number(driverNumber) !== Number(highlighted) ? 'dimmed' : '',
        highlighted !== null && Number(driverNumber) === Number(highlighted) ? 'highlighted' : ''
    ].filter(Boolean).join(' ');
}

function updateCompareHighlightClasses() {
    const highlighted = state.compareView.highlightedDriver;
    document.querySelectorAll('[data-compare-driver-number]').forEach(element => {
        const driverNumber = Number(element.dataset.compareDriverNumber);
        const muted = isCompareDriverMuted(driverNumber);
        element.classList.remove('hidden');
        element.classList.toggle('dimmed', muted || (highlighted !== null && driverNumber !== Number(highlighted)));
        element.classList.toggle('highlighted', highlighted !== null && driverNumber === Number(highlighted));
    });
}

function renderCompareLegendInteractive(selectedDrivers) {
    if (!DOM.compareLegend) return;

    DOM.compareLegend.innerHTML = '';

    if (selectedDrivers.length === 0) {
        DOM.compareLegend.innerHTML = '<span class="compare-legend-empty">No drivers selected</span>';
        return;
    }

    selectedDrivers.forEach(driver => {
        const driverNumber = Number(driver.driver_number);
        const teamHex = getDriverTeamHex(driver);
        const label = getCompareDriverLabel(driver);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `compare-legend-item ${getCompareItemStateClasses(driverNumber)}`.trim();
        button.dataset.compareDriverNumber = String(driverNumber);
        button.style.setProperty('--team-color', `#${teamHex}`);
        button.setAttribute('aria-pressed', String(!isCompareDriverMuted(driverNumber)));
        button.title = isCompareDriverMuted(driverNumber)
            ? `Restore ${label}`
            : `Dim ${label}`;
        button.innerHTML = `
            <span class="compare-legend-swatch"></span>
            <span>${escapeHtml(label)}</span>
        `;

        button.addEventListener('click', () => {
            if (isCompareDriverMuted(driverNumber)) {
                state.compareView.mutedDrivers.delete(driverNumber);
            } else {
                state.compareView.mutedDrivers.add(driverNumber);
            }
            state.compareView.hoverLap = null;
            renderCompareLapChart();
        });

        button.addEventListener('mouseenter', () => {
            state.compareView.highlightedDriver = driverNumber;
            updateCompareHighlightClasses();
        });

        button.addEventListener('mouseleave', () => {
            state.compareView.highlightedDriver = null;
            updateCompareHighlightClasses();
        });

        DOM.compareLegend.appendChild(button);
    });
}

function renderCompareContainerEmptyState(container, icon, title, text) {
    if (!container) return;
    container.innerHTML = `
        <div class="compare-empty">
            <span class="material-icons-round">${icon}</span>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(text)}</p>
        </div>
    `;
}

function renderCompareEmptyState(icon, title, text) {
    renderCompareContainerEmptyState(DOM.compareChartContainer, icon, title, text);
}

function getCompareChartDomain(lapNumbers) {
    const finiteLaps = lapNumbers.map(Number).filter(Number.isFinite);
    if (finiteLaps.length === 0) return null;

    const fullMinLap = Math.min(...finiteLaps);
    const fullMaxLap = Math.max(...finiteLaps);
    let minLap = fullMinLap;
    let maxLap = fullMaxLap;

    if (isCompareZoomActive()) {
        const requestedMin = Math.min(state.compareView.lapWindow.min, state.compareView.lapWindow.max);
        const requestedMax = Math.max(state.compareView.lapWindow.min, state.compareView.lapWindow.max);
        minLap = Math.max(fullMinLap, requestedMin);
        maxLap = Math.min(fullMaxLap, requestedMax);

        if (minLap > maxLap) {
            minLap = fullMinLap;
            maxLap = fullMaxLap;
        }
    }

    return { fullMinLap, fullMaxLap, minLap, maxLap };
}

function lapWithinCompareWindow(lapNumber, minLap, maxLap) {
    const normalizedLap = Number(lapNumber);
    return Number.isFinite(normalizedLap) && normalizedLap >= minLap && normalizedLap <= maxLap;
}

function getCompareTooltip() {
    let tooltip = document.querySelector(".chart-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }
    tooltip.classList.add("compare-unified-tooltip");
    return tooltip;
}

function hideCompareTooltip() {
    const tooltip = document.querySelector(".chart-tooltip");
    if (!tooltip) return;
    tooltip.style.display = "none";
    tooltip.classList.remove("compare-unified-tooltip");
    tooltip.classList.remove("compare-strategy-tooltip");
}

function getComparePointerX(event, ctx) {
    const rect = ctx.svg.getBoundingClientRect();
    const scaleX = ctx.width / (rect.width || ctx.width || 1);
    const pointerX = (event.clientX - rect.left) * scaleX;
    return Math.max(ctx.padding.left, Math.min(ctx.padding.left + ctx.chartWidth, pointerX));
}

function getCompareLapFromX(x, ctx) {
    if (ctx.maxLap === ctx.minLap) return ctx.minLap;
    const ratio = (x - ctx.padding.left) / (ctx.chartWidth || 1);
    return Math.round(ctx.minLap + ratio * (ctx.maxLap - ctx.minLap));
}

function getCompareHoverValueFromX(x, ctx) {
    if (typeof ctx.getHoverValueFromX === 'function') {
        return ctx.getHoverValueFromX(x, ctx);
    }
    return getCompareLapFromX(x, ctx);
}

function renderCompareUnifiedTooltip(ctx, event) {
    const hoverLap = state.compareView.hoverLap;
    if (hoverLap === null || hoverLap === undefined) {
        hideCompareTooltip();
        return;
    }

    const rows = ctx.series
        .map(item => {
            const value = ctx.valueFor(hoverLap, item.driverNumber);
            return {
                item,
                value,
                detail: ctx.detailFor ? ctx.detailFor(hoverLap, item.driverNumber) : ''
            };
        })
        .sort((a, b) => {
            if (a.value === null && b.value === null) return 0;
            if (a.value === null) return 1;
            if (b.value === null) return -1;
            return a.value - b.value;
        });

    if (rows.length === 0) {
        hideCompareTooltip();
        return;
    }

    const tooltip = getCompareTooltip();
    tooltip.classList.remove("compare-strategy-tooltip");
    const hoverLabel = typeof ctx.formatHoverLabel === 'function'
        ? ctx.formatHoverLabel(hoverLap)
        : `Lap ${hoverLap}`;
    tooltip.innerHTML = `
        <div class="chart-tooltip-header">${escapeHtml(ctx.title)} - ${escapeHtml(hoverLabel)}</div>
        <div class="compare-tooltip-rows">
            ${rows.map(row => {
                const label = getCompareDriverLabel(row.item.driver);
                const displayValue = row.value === null ? '--' : ctx.formatValue(row.value, row.item.driverNumber);
                return `
                    <div class="compare-tooltip-row" style="--team-color: #${row.item.teamHex};">
                        <div class="compare-tooltip-main">
                            <span class="compare-tooltip-swatch"></span>
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(displayValue)}</strong>
                        </div>
                        ${row.detail}
                    </div>
                `;
            }).join('')}
        </div>
    `;

    const rect = ctx.container.getBoundingClientRect();
    const pointerX = getComparePointerX(event, ctx);
    const left = rect.left + window.scrollX + Math.min(pointerX + 14, ctx.padding.left + ctx.chartWidth - 120);
    const top = rect.top + window.scrollY + ctx.padding.top + 10;
    tooltip.style.left = `${Math.max(rect.left + window.scrollX + ctx.padding.left, left)}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.display = "block";
}

function renderCompareContextTooltip(ctx, event) {
    if (typeof ctx.renderTooltip === 'function') {
        ctx.renderTooltip(ctx, event);
        return;
    }
    renderCompareUnifiedTooltip(ctx, event);
}

function drawCompareCrosshairs(sourceCtx = null, event = null) {
    const hoverLap = state.compareView.hoverLap;
    let tooltipRendered = false;

    compareInteractionContexts.forEach(ctx => {
        if (!ctx.crosshairGroup || !ctx.crosshairLine) return;

        if (hoverLap === null || hoverLap === undefined || hoverLap < ctx.minLap || hoverLap > ctx.maxLap) {
            ctx.crosshairGroup.style.display = "none";
            return;
        }

        const x = ctx.getX(hoverLap);
        ctx.crosshairLine.setAttribute("x1", x);
        ctx.crosshairLine.setAttribute("x2", x);
        ctx.crosshairLine.setAttribute("y1", ctx.padding.top);
        ctx.crosshairLine.setAttribute("y2", ctx.padding.top + ctx.chartHeight);
        ctx.crosshairGroup.style.display = "block";

        if (sourceCtx && event && ctx.kind === sourceCtx.kind) {
            renderCompareContextTooltip(ctx, event);
            tooltipRendered = true;
        }
    });

    if (!tooltipRendered) {
        hideCompareTooltip();
    }
}

function attachCompareCrosshair(svg, ctx) {
    const crosshairGroup = document.createElementNS(ctx.svgNamespace, "g");
    crosshairGroup.setAttribute("class", "compare-crosshair");
    crosshairGroup.style.display = "none";

    const crosshairLine = document.createElementNS(ctx.svgNamespace, "line");
    crosshairLine.setAttribute("class", "compare-crosshair-line");
    crosshairGroup.appendChild(crosshairLine);
    svg.appendChild(crosshairGroup);

    const overlay = document.createElementNS(ctx.svgNamespace, "rect");
    overlay.setAttribute("x", ctx.padding.left);
    overlay.setAttribute("y", ctx.padding.top);
    overlay.setAttribute("width", ctx.chartWidth);
    overlay.setAttribute("height", ctx.chartHeight);
    overlay.setAttribute("class", "compare-interaction-overlay");
    overlay.setAttribute("fill", "transparent");
    overlay.dataset.compareChartKind = ctx.kind;

    ctx.crosshairGroup = crosshairGroup;
    ctx.crosshairLine = crosshairLine;
    ctx.interactionOverlay = overlay;

    overlay.addEventListener("mousemove", event => {
        const x = getComparePointerX(event, ctx);
        state.compareView.hoverLap = getCompareHoverValueFromX(x, ctx);
        drawCompareCrosshairs(ctx, event);
    });

    overlay.addEventListener("mouseleave", () => {
        if (state.compareView.zoomDrag) return;
        state.compareView.hoverLap = null;
        drawCompareCrosshairs();
    });

    svg.appendChild(overlay);
    compareInteractionContexts.push(ctx);
}

function attachCompareZoom(svg, ctx) {
    if (!ctx.interactionOverlay) return;

    const selection = document.createElementNS(ctx.svgNamespace, "rect");
    selection.setAttribute("y", ctx.padding.top);
    selection.setAttribute("height", ctx.chartHeight);
    selection.setAttribute("class", "compare-zoom-selection");
    selection.style.display = "none";
    ctx.zoomSelection = selection;
    svg.insertBefore(selection, ctx.interactionOverlay);

    const updateSelection = (startX, currentX) => {
        const x = Math.min(startX, currentX);
        const width = Math.abs(currentX - startX);
        selection.setAttribute("x", x);
        selection.setAttribute("width", width);
        selection.style.display = width > 0 ? "block" : "none";
    };

    const finishDrag = event => {
        const drag = state.compareView.zoomDrag;
        if (!drag || drag.kind !== ctx.kind) return;

        const currentX = getComparePointerX(event, ctx);
        const dragDistance = Math.abs(currentX - drag.startX);
        state.compareView.zoomDrag = null;
        selection.style.display = "none";

        if (dragDistance < 5) {
            return;
        }

        const startLap = getCompareHoverValueFromX(drag.startX, ctx);
        const endLap = getCompareHoverValueFromX(currentX, ctx);
        state.compareView.lapWindow = {
            min: Math.min(startLap, endLap),
            max: Math.max(startLap, endLap)
        };
        state.compareView.hoverLap = null;
        renderCompareLapChart();
    };

    ctx.interactionOverlay.addEventListener("mousedown", event => {
        if (event.button !== 0) return;
        const startX = getComparePointerX(event, ctx);
        state.compareView.zoomDrag = { kind: ctx.kind, startX };
        updateSelection(startX, startX);
        event.preventDefault();

        const handleMouseUp = upEvent => {
            finishDrag(upEvent);
            window.removeEventListener("mouseup", handleMouseUp);
        };
        window.addEventListener("mouseup", handleMouseUp);
    });

    ctx.interactionOverlay.addEventListener("mousemove", event => {
        const drag = state.compareView.zoomDrag;
        if (!drag || drag.kind !== ctx.kind) return;
        updateSelection(drag.startX, getComparePointerX(event, ctx));
    });
}

function renderCompareSafetyCarPeriods(svg, getX, minLap, maxLap, padding, chartHeight, svgNamespace, includeLabels = true) {
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

        if (includeLabels && width > 12) {
            const text = document.createElementNS(svgNamespace, "text");
            text.setAttribute("x", xStart + width / 2);
            text.setAttribute("y", padding.top + 15);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("class", isVSC ? "chart-vsc-text" : "chart-safety-car-text");
            text.textContent = isVSC ? "VSC" : (width < 50 ? "SC" : "Safety Car");
            svg.appendChild(text);
        }
    });
}

function renderQualifyingPhaseRegions(svg, axis, getX, padding, chartHeight, svgNamespace, includeLabels = true) {
    if (!axis || !Array.isArray(axis.phases)) return;

    axis.phases.forEach((phase, index) => {
        const start = Math.max(phase.startTime, axis.min);
        const end = Math.min(phase.endTime, axis.max);
        if (start > end) return;

        const xStart = getX(start);
        const xEnd = getX(end);
        const width = Math.max(xEnd - xStart, 2);

        const rect = document.createElementNS(svgNamespace, "rect");
        rect.setAttribute("x", xStart);
        rect.setAttribute("y", padding.top);
        rect.setAttribute("width", width);
        rect.setAttribute("height", chartHeight);
        rect.setAttribute("class", `chart-qualifying-phase-shading phase-${index % 2 === 0 ? 'even' : 'odd'}`);
        svg.appendChild(rect);

        [xStart, xStart + width].forEach(x => {
            const line = document.createElementNS(svgNamespace, "line");
            line.setAttribute("x1", x);
            line.setAttribute("y1", padding.top);
            line.setAttribute("x2", x);
            line.setAttribute("y2", padding.top + chartHeight);
            line.setAttribute("class", "chart-qualifying-phase-boundary");
            svg.appendChild(line);
        });

        if (includeLabels && width > 20) {
            const text = document.createElementNS(svgNamespace, "text");
            text.setAttribute("x", xStart + width / 2);
            text.setAttribute("y", padding.top + chartHeight + 20);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("class", "chart-qualifying-phase-text");
            text.textContent = phase.label;
            svg.appendChild(text);
        }
    });
}

function renderVisibleSecondaryCompareCharts(selectedDrivers) {
    renderCompareGapChart(selectedDrivers);
    renderComparePositionChart(selectedDrivers);
    renderCompareHeadToHeadChart(selectedDrivers);
    renderCompareTyreStrategyChart(selectedDrivers);
    updateCompareChartToggles();
}

function renderCompareLapChart() {
    if (!DOM.compareChartContainer) return;

    compareInteractionContexts = [];
    hideCompareTooltip();
    updateCompareSelectedCount();
    updateCompareChartToggles();

    const selectedDrivers = state.selectedCompareDrivers
        .map(driverNumber => state.drivers.find(d => Number(d.driver_number) === Number(driverNumber)))
        .filter(Boolean);

    pruneCompareViewState(selectedDrivers);
    renderCompareLegendInteractive(selectedDrivers);
    updateCompareZoomControl();

    if (selectedDrivers.length === 0) {
        setCompareChartSectionVisibility(DOM.compareLapTimesChartSection, isCompareChartVisible('lapTimes'));
        if (isCompareChartVisible('lapTimes')) {
            renderCompareEmptyState('stacked_line_chart', 'No Drivers Selected', 'Select drivers from the list to compare lap time progression.');
        } else {
            DOM.compareChartContainer.innerHTML = '';
        }
        renderVisibleSecondaryCompareCharts(selectedDrivers);
        return;
    }

    const showLapTimes = isCompareChartVisible('lapTimes');
    setCompareChartSectionVisibility(DOM.compareLapTimesChartSection, showLapTimes);
    if (!showLapTimes) {
        DOM.compareChartContainer.innerHTML = '';
        renderVisibleSecondaryCompareCharts(selectedDrivers);
        drawCompareCrosshairs();
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
            ))
            .sort((a, b) => Number(a.lap_number) - Number(b.lap_number));
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
            lapByNumber: new Map(validLaps.map(lap => [Number(lap.lap_number), lap])),
            outlierThreshold
        };
    }).filter(item => item.validLaps.length > 0);

    if (series.length === 0) {
        renderCompareEmptyState('query_stats', 'No Lap Times Available', 'The selected drivers do not have lap times recorded for this session.');
        renderVisibleSecondaryCompareCharts(selectedDrivers);
        return;
    }

    const activeSeries = series;

    const qualifyingAxis = buildQualifyingPhaseAxis(activeSeries.flatMap(item => item.validLaps), state.raceControl, state.selectedSession);
    let minLap;
    let maxLap;

    if (qualifyingAxis) {
        minLap = qualifyingAxis.min;
        maxLap = qualifyingAxis.max;
        if (isCompareZoomActive()) {
            const requestedMin = Math.min(state.compareView.lapWindow.min, state.compareView.lapWindow.max);
            const requestedMax = Math.max(state.compareView.lapWindow.min, state.compareView.lapWindow.max);
            const clampedMin = Math.max(qualifyingAxis.min, requestedMin);
            const clampedMax = Math.min(qualifyingAxis.max, requestedMax);
            if (clampedMin <= clampedMax) {
                minLap = clampedMin;
                maxLap = clampedMax;
            }
        }
    } else {
        const domain = getCompareChartDomain(activeSeries.flatMap(item => item.validLaps.map(lap => Number(lap.lap_number))));
        if (!domain) {
            renderCompareEmptyState('query_stats', 'No Lap Times Available', 'The selected drivers do not have lap times recorded for this session.');
            renderVisibleSecondaryCompareCharts(selectedDrivers);
            return;
        }
        minLap = domain.minLap;
        maxLap = domain.maxLap;
    }

    let plotDurations = activeSeries
        .flatMap(item => item.plottableLaps
            .filter(lap => chartValueWithinWindow(getLapXValue(lap, qualifyingAxis), minLap, maxLap))
            .map(lap => Number(lap.lap_duration)))
        .filter(Number.isFinite);

    if (plotDurations.length === 0) {
        plotDurations = activeSeries
            .flatMap(item => item.validLaps
                .filter(lap => chartValueWithinWindow(getLapXValue(lap, qualifyingAxis), minLap, maxLap))
                .map(lap => Number(lap.lap_duration)))
            .filter(Number.isFinite);
    }

    if (plotDurations.length === 0) {
        renderCompareEmptyState('zoom_out_map', 'No Laps In Range', 'Reset zoom or choose a wider lap range to see comparison data.');
        renderVisibleSecondaryCompareCharts(selectedDrivers);
        return;
    }

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

    if (qualifyingAxis) {
        const windowedAxis = {
            ...qualifyingAxis,
            min: minLap,
            max: maxLap
        };
        renderQualifyingPhaseRegions(svg, windowedAxis, getX, padding, chartHeight, svgNamespace, true);
    } else {
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

    if (!qualifyingAxis) {
        renderCompareSafetyCarPeriods(svg, getX, minLap, maxLap, padding, chartHeight, svgNamespace, true);
    }

    series.forEach(item => {
        const rgb = getRGBColor(item.teamHex);
        const stateClasses = getCompareItemStateClasses(item.driverNumber);
        const points = item.plottableLaps
            .filter(lap => chartValueWithinWindow(getLapXValue(lap, qualifyingAxis), minLap, maxLap))
            .map(lap => `${getX(getLapXValue(lap, qualifyingAxis)).toFixed(1)},${getY(Number(lap.lap_duration)).toFixed(1)}`);

        if (points.length > 1) {
            const path = document.createElementNS(svgNamespace, "path");
            path.setAttribute("d", `M ${points.join(" L ")}`);
            path.setAttribute("class", `compare-chart-line ${stateClasses}`.trim());
            path.dataset.compareDriverNumber = String(item.driverNumber);
            path.style.stroke = `#${item.teamHex}`;
            path.style.setProperty('--team-color', `#${item.teamHex}`);
            path.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.35)`);
            svg.appendChild(path);
        }

        item.validLaps
            .filter(lap => chartValueWithinWindow(getLapXValue(lap, qualifyingAxis), minLap, maxLap))
            .forEach(lap => {
                const isOutlier = hideOutliers && Number(lap.lap_duration) > item.outlierThreshold;
                const pitAnnotation = getLapPitAnnotation(item.driverNumber, lap.lap_number);
                const pitDotClasses = [
                    pitAnnotation.isPitIn ? 'chart-pit-in-dot' : '',
                    pitAnnotation.isPitOut ? 'chart-pit-out-dot' : ''
                ].filter(Boolean).join(' ');
                const x = getX(getLapXValue(lap, qualifyingAxis));
                const y = isOutlier ? padding.top : getY(Number(lap.lap_duration));
                const circle = document.createElementNS(svgNamespace, "circle");
                circle.setAttribute("cx", x);
                circle.setAttribute("cy", y);
                circle.setAttribute("r", isOutlier ? 3.5 : 4.2);
                circle.setAttribute(
                    "class",
                    `${isOutlier ? "chart-outlier-dot compare-chart-outlier-dot" : "compare-chart-dot"}${pitDotClasses ? ` ${pitDotClasses}` : ''} ${stateClasses}`.trim()
                );
                circle.dataset.compareDriverNumber = String(item.driverNumber);
                circle.style.stroke = `#${item.teamHex}`;
                circle.style.setProperty('--team-color', `#${item.teamHex}`);
                svg.appendChild(circle);
            });
    });

    const seriesByDriver = new Map(series.map(item => [item.driverNumber, item]));
    const ctx = {
        kind: 'lap',
        title: 'Lap Time',
        svgNamespace,
        svg,
        width,
        height,
        container: DOM.compareChartContainer,
        getX,
        getY,
        series,
        minLap,
        maxLap,
        padding,
        chartWidth,
        chartHeight,
        valueFor(lapNumber, driverNumber) {
            const item = seriesByDriver.get(Number(driverNumber));
            if (qualifyingAxis) {
                const nearestLap = item ? findNearestLapByAxisValue(item.validLaps, lapNumber) : null;
                return nearestLap ? Number(nearestLap.lap_duration) : null;
            }
            const lap = item ? item.lapByNumber.get(Number(lapNumber)) : null;
            return lap ? Number(lap.lap_duration) : null;
        },
        formatValue(value) {
            return formatLapTime(value);
        },
        detailFor(lapNumber, driverNumber) {
            const item = seriesByDriver.get(Number(driverNumber));
            const lap = qualifyingAxis
                ? (item ? findNearestLapByAxisValue(item.validLaps, lapNumber) : null)
                : (item ? item.lapByNumber.get(Number(lapNumber)) : null);
            if (!lap) return '';

            const effectiveLapNumber = Number(lap.lap_number);
            const pitAnnotation = getLapPitAnnotation(driverNumber, effectiveLapNumber);
            const isOutlier = hideOutliers && Number(lap.lap_duration) > item.outlierThreshold;
            return `
                <div class="compare-tooltip-sectors">
                    ${qualifyingAxis ? `<span>${escapeHtml(getQualifyingLapLabel(lap, qualifyingAxis))}</span>` : ''}
                    <span>S1 ${lap.duration_sector_1 ? Number(lap.duration_sector_1).toFixed(3) + 's' : '--'}</span>
                    <span>S2 ${lap.duration_sector_2 ? Number(lap.duration_sector_2).toFixed(3) + 's' : '--'}</span>
                    <span>S3 ${lap.duration_sector_3 ? Number(lap.duration_sector_3).toFixed(3) + 's' : '--'}</span>
                </div>
                ${renderPitTooltipRows(pitAnnotation)}
                ${isOutlier ? '<div class="compare-tooltip-note">Outlier</div>' : ''}
            `;
        },
        getHoverValueFromX(x) {
            if (!qualifyingAxis) return getCompareLapFromX(x, ctx);
            if (maxLap === minLap) return minLap;
            const ratio = (x - padding.left) / (chartWidth || 1);
            return minLap + ratio * (maxLap - minLap);
        },
        formatHoverLabel(value) {
            if (!qualifyingAxis) return `Lap ${value}`;
            return getQualifyingPhaseLabelForValue(qualifyingAxis, value) || formatRaceControlTime(value);
        }
    };

    attachCompareCrosshair(svg, ctx);
    attachCompareZoom(svg, ctx);

    DOM.compareChartContainer.appendChild(svg);
    updateCompareHighlightClasses();
    drawCompareCrosshairs();

    renderVisibleSecondaryCompareCharts(selectedDrivers);
}

function renderCompareGapChart(selectedDrivers = null) {
    if (!DOM.compareGapChartContainer || !DOM.compareGapChartSection) return;

    const resolvedDrivers = selectedDrivers || state.selectedCompareDrivers
        .map(driverNumber => state.drivers.find(d => Number(d.driver_number) === Number(driverNumber)))
        .filter(Boolean);

    const shouldShow = isCompareChartVisible('gap') && isCompareChartAvailable('gap');
    setCompareChartSectionVisibility(DOM.compareGapChartSection, shouldShow);
    if (!shouldShow) {
        DOM.compareGapChartContainer.innerHTML = '';
        return;
    }

    DOM.compareGapChartContainer.innerHTML = '';

    if (resolvedDrivers.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareGapChartContainer,
            'stacked_line_chart',
            'No Drivers Selected',
            'Select drivers from the list to compare their gap to the leader.'
        );
        return;
    }

    const { allDriversCumulative, leaderCumulativeAtLap } = buildCompareCumulativeTimes(resolvedDrivers);

    const series = resolvedDrivers.map(driver => {
        const driverNumber = Number(driver.driver_number);
        const driverLaps = state.laps[driverNumber] || [];
        const gaps = [];

        driverLaps.forEach(lap => {
            const lapNum = Number(lap.lap_number);
            const cume = allDriversCumulative[driverNumber]?.[lapNum];
            const leaderCume = leaderCumulativeAtLap[lapNum];
            if (cume !== undefined && leaderCume !== undefined) {
                gaps.push({
                    lap_number: lapNum,
                    gap: cume - leaderCume,
                    lap_duration: lap.lap_duration,
                    duration_sector_1: lap.duration_sector_1,
                    duration_sector_2: lap.duration_sector_2,
                    duration_sector_3: lap.duration_sector_3
                });
            }
        });

        return {
            driver,
            driverNumber,
            teamHex: getDriverTeamHex(driver),
            gaps,
            gapByNumber: new Map(gaps.map(gap => [Number(gap.lap_number), gap]))
        };
    }).filter(item => item.gaps.length > 0);

    if (series.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareGapChartContainer,
            'query_stats',
            'No Gap Data Available',
            'Telemetry for calculating gaps is not available for this session.'
        );
        return;
    }

    const activeSeries = series;

    const domain = getCompareChartDomain(activeSeries.flatMap(item => item.gaps.map(g => Number(g.lap_number))));
    if (!domain) {
        renderCompareContainerEmptyState(
            DOM.compareGapChartContainer,
            'query_stats',
            'No Gap Data Available',
            'Telemetry for calculating gaps is not available for this session.'
        );
        return;
    }

    const { minLap, maxLap } = domain;
    const gapValues = activeSeries
        .flatMap(item => item.gaps
            .filter(g => lapWithinCompareWindow(g.lap_number, minLap, maxLap))
            .map(g => Number(g.gap)))
        .filter(Number.isFinite);

    if (gapValues.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareGapChartContainer,
            'zoom_out_map',
            'No Gaps In Range',
            'Reset zoom or choose a wider lap range to see gap data.'
        );
        return;
    }

    const maxGap = Math.max(...gapValues, 1);
    const width = DOM.compareGapChartContainer.clientWidth || 900;
    const height = 460;
    const padding = { top: 24, right: 34, bottom: 34, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const getX = (lapNum) => {
        if (maxLap === minLap) return padding.left + chartWidth / 2;
        return padding.left + ((lapNum - minLap) / (maxLap - minLap)) * chartWidth;
    };

    const getY = (gap) => padding.top + (gap / maxGap) * chartHeight;

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    const yGridLines = 4;
    for (let i = 0; i <= yGridLines; i++) {
        const gapVal = (i / yGridLines) * maxGap;
        const y = getY(gapVal);

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
        text.textContent = gapVal === 0 ? "Leader" : `+${gapVal.toFixed(1)}s`;
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

    renderCompareSafetyCarPeriods(svg, getX, minLap, maxLap, padding, chartHeight, svgNamespace, false);

    series.forEach(item => {
        const rgb = getRGBColor(item.teamHex);
        const stateClasses = getCompareItemStateClasses(item.driverNumber);
        const points = item.gaps
            .filter(g => lapWithinCompareWindow(g.lap_number, minLap, maxLap))
            .map(g => `${getX(g.lap_number).toFixed(1)},${getY(g.gap).toFixed(1)}`);

        if (points.length > 1) {
            const path = document.createElementNS(svgNamespace, "path");
            path.setAttribute("d", `M ${points.join(" L ")}`);
            path.setAttribute("class", `compare-chart-line ${stateClasses}`.trim());
            path.dataset.compareDriverNumber = String(item.driverNumber);
            path.style.stroke = `#${item.teamHex}`;
            path.style.setProperty('--team-color', `#${item.teamHex}`);
            path.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.35)`);
            svg.appendChild(path);
        }

        item.gaps
            .filter(g => lapWithinCompareWindow(g.lap_number, minLap, maxLap))
            .forEach(g => {
                const pitAnnotation = getLapPitAnnotation(item.driverNumber, g.lap_number);
                const pitDotClasses = [
                    pitAnnotation.isPitIn ? 'chart-pit-in-dot' : '',
                    pitAnnotation.isPitOut ? 'chart-pit-out-dot' : ''
                ].filter(Boolean).join(' ');

                const circle = document.createElementNS(svgNamespace, "circle");
                circle.setAttribute("cx", getX(g.lap_number));
                circle.setAttribute("cy", getY(g.gap));
                circle.setAttribute("r", 4.2);
                circle.setAttribute("class", `compare-chart-dot${pitDotClasses ? ` ${pitDotClasses}` : ''} ${stateClasses}`.trim());
                circle.dataset.compareDriverNumber = String(item.driverNumber);
                circle.style.stroke = `#${item.teamHex}`;
                circle.style.setProperty('--team-color', `#${item.teamHex}`);
                svg.appendChild(circle);
            });
    });

    const seriesByDriver = new Map(series.map(item => [item.driverNumber, item]));
    const ctx = {
        kind: 'gap',
        title: 'Gap to Leader',
        svgNamespace,
        svg,
        width,
        height,
        container: DOM.compareGapChartContainer,
        getX,
        getY,
        series,
        minLap,
        maxLap,
        padding,
        chartWidth,
        chartHeight,
        valueFor(lapNumber, driverNumber) {
            const item = seriesByDriver.get(Number(driverNumber));
            const gap = item ? item.gapByNumber.get(Number(lapNumber)) : null;
            return gap ? Number(gap.gap) : null;
        },
        formatValue(value) {
            return value === 0 ? 'Leader' : `+${value.toFixed(3)}s`;
        }
    };

    attachCompareCrosshair(svg, ctx);
    attachCompareZoom(svg, ctx);

    DOM.compareGapChartContainer.appendChild(svg);
    updateCompareHighlightClasses();
    drawCompareCrosshairs();
}

function renderComparePositionChart(selectedDrivers = null) {
    if (!DOM.comparePositionChartContainer || !DOM.comparePositionChartSection) return;

    const resolvedDrivers = selectedDrivers || state.selectedCompareDrivers
        .map(driverNumber => state.drivers.find(d => Number(d.driver_number) === Number(driverNumber)))
        .filter(Boolean);
    const shouldShow = isCompareChartVisible('position') && isCompareChartAvailable('position');
    setCompareChartSectionVisibility(DOM.comparePositionChartSection, shouldShow);
    if (!shouldShow) {
        DOM.comparePositionChartContainer.innerHTML = '';
        return;
    }

    DOM.comparePositionChartContainer.innerHTML = '';

    if (resolvedDrivers.length === 0) {
        renderCompareContainerEmptyState(
            DOM.comparePositionChartContainer,
            'format_list_numbered',
            'No Drivers Selected',
            'Select drivers from the list to compare their track position.'
        );
        return;
    }

    if (!state.positionByLap || Object.keys(state.positionByLap).length === 0) {
        buildPositionByLapMap();
    }

    const series = resolvedDrivers.map(driver => {
        const driverNumber = Number(driver.driver_number);
        const positionsByLap = state.positionByLap[driverNumber] || {};
        const positions = Object.keys(positionsByLap)
            .map(lapNumber => ({
                lap_number: Number(lapNumber),
                position: Number(positionsByLap[lapNumber])
            }))
            .filter(point => Number.isFinite(point.lap_number) && Number.isFinite(point.position))
            .sort((a, b) => a.lap_number - b.lap_number);

        return {
            driver,
            driverNumber,
            teamHex: getDriverTeamHex(driver),
            positions,
            positionByNumber: new Map(positions.map(point => [point.lap_number, point.position]))
        };
    }).filter(item => item.positions.length > 0);

    if (series.length === 0) {
        renderCompareContainerEmptyState(
            DOM.comparePositionChartContainer,
            'query_stats',
            'No Position Data Available',
            'Position events are not available for this session.'
        );
        return;
    }

    const activeSeries = series;

    const domain = getCompareChartDomain(activeSeries.flatMap(item => item.positions.map(point => point.lap_number)));
    if (!domain) {
        renderCompareContainerEmptyState(
            DOM.comparePositionChartContainer,
            'query_stats',
            'No Position Data Available',
            'Position events are not available for this session.'
        );
        return;
    }

    const { minLap, maxLap } = domain;
    const positionValues = activeSeries
        .flatMap(item => item.positions
            .filter(point => lapWithinCompareWindow(point.lap_number, minLap, maxLap))
            .map(point => point.position))
        .filter(Number.isFinite);

    if (positionValues.length === 0) {
        renderCompareContainerEmptyState(
            DOM.comparePositionChartContainer,
            'zoom_out_map',
            'No Positions In Range',
            'Reset zoom or choose a wider lap range to see position data.'
        );
        return;
    }

    const minPosition = 1;
    const maxPosition = Math.max(...positionValues, resolvedDrivers.length, 2);
    const width = DOM.comparePositionChartContainer.clientWidth || 900;
    const height = 460;
    const padding = { top: 24, right: 34, bottom: 34, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const getX = (lapNum) => {
        if (maxLap === minLap) return padding.left + chartWidth / 2;
        return padding.left + ((lapNum - minLap) / (maxLap - minLap)) * chartWidth;
    };

    const getY = (position) => {
        if (maxPosition === minPosition) return padding.top + chartHeight / 2;
        return padding.top + ((position - minPosition) / (maxPosition - minPosition)) * chartHeight;
    };

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    const yTicks = Array.from({ length: Math.min(maxPosition, 10) }, (_, index) => {
        if (maxPosition <= 10) return index + 1;
        return Math.round(1 + (index / 9) * (maxPosition - 1));
    }).filter((value, index, values) => values.indexOf(value) === index);

    yTicks.forEach(position => {
        const y = getY(position);
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
        text.textContent = `P${position}`;
        svg.appendChild(text);
    });

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

    renderCompareSafetyCarPeriods(svg, getX, minLap, maxLap, padding, chartHeight, svgNamespace, false);

    series.forEach(item => {
        const rgb = getRGBColor(item.teamHex);
        const stateClasses = getCompareItemStateClasses(item.driverNumber);
        const visiblePoints = item.positions
            .filter(point => lapWithinCompareWindow(point.lap_number, minLap, maxLap))
            .map(point => ({
                ...point,
                x: getX(point.lap_number),
                y: getY(point.position)
            }));

        if (visiblePoints.length > 1) {
            let d = `M ${visiblePoints[0].x.toFixed(1)},${visiblePoints[0].y.toFixed(1)}`;
            for (let i = 1; i < visiblePoints.length; i++) {
                d += ` L ${visiblePoints[i].x.toFixed(1)},${visiblePoints[i - 1].y.toFixed(1)} L ${visiblePoints[i].x.toFixed(1)},${visiblePoints[i].y.toFixed(1)}`;
            }

            const path = document.createElementNS(svgNamespace, "path");
            path.setAttribute("d", d);
            path.setAttribute("class", `compare-chart-line compare-position-line ${stateClasses}`.trim());
            path.dataset.compareDriverNumber = String(item.driverNumber);
            path.style.stroke = `#${item.teamHex}`;
            path.style.setProperty('--team-color', `#${item.teamHex}`);
            path.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.35)`);
            svg.appendChild(path);
        }

        visiblePoints.forEach(point => {
            const circle = document.createElementNS(svgNamespace, "circle");
            circle.setAttribute("cx", point.x);
            circle.setAttribute("cy", point.y);
            circle.setAttribute("r", 4.2);
            circle.setAttribute("class", `compare-chart-dot ${stateClasses}`.trim());
            circle.dataset.compareDriverNumber = String(item.driverNumber);
            circle.style.stroke = `#${item.teamHex}`;
            circle.style.setProperty('--team-color', `#${item.teamHex}`);
            svg.appendChild(circle);
        });
    });

    const seriesByDriver = new Map(series.map(item => [item.driverNumber, item]));
    const ctx = {
        kind: 'position',
        title: 'Position',
        svgNamespace,
        svg,
        width,
        height,
        container: DOM.comparePositionChartContainer,
        getX,
        getY,
        series,
        minLap,
        maxLap,
        padding,
        chartWidth,
        chartHeight,
        valueFor(lapNumber, driverNumber) {
            const item = seriesByDriver.get(Number(driverNumber));
            return item ? item.positionByNumber.get(Number(lapNumber)) ?? null : null;
        },
        formatValue(value) {
            return `P${value}`;
        },
        detailFor(lapNumber, driverNumber) {
            const item = seriesByDriver.get(Number(driverNumber));
            if (!item) return '';
            const current = item.positionByNumber.get(Number(lapNumber));
            const previous = item.positionByNumber.get(Number(lapNumber) - 1);
            if (!Number.isFinite(current) || !Number.isFinite(previous)) return '';
            return `<div class="compare-position-delta">${formatComparePositionDelta(previous - current)}</div>`;
        }
    };

    attachCompareCrosshair(svg, ctx);
    attachCompareZoom(svg, ctx);

    DOM.comparePositionChartContainer.appendChild(svg);
    updateCompareHighlightClasses();
    drawCompareCrosshairs();
}

function renderCompareHeadToHeadChart(selectedDrivers = null) {
    if (!DOM.compareHeadToHeadChartContainer || !DOM.compareHeadToHeadChartSection) return;

    const resolvedDrivers = selectedDrivers || state.selectedCompareDrivers
        .map(driverNumber => state.drivers.find(d => Number(d.driver_number) === Number(driverNumber)))
        .filter(Boolean);
    const shouldShow = isCompareChartVisible('headToHead') && isCompareChartAvailable('headToHead');
    setCompareChartSectionVisibility(DOM.compareHeadToHeadChartSection, shouldShow);
    if (!shouldShow) {
        DOM.compareHeadToHeadChartContainer.innerHTML = '';
        return;
    }

    DOM.compareHeadToHeadChartContainer.innerHTML = '';

    if (resolvedDrivers.length === 0) {
        populateHeadToHeadReferencePicker([], null);
        renderCompareContainerEmptyState(
            DOM.compareHeadToHeadChartContainer,
            'compare_arrows',
            'No Drivers Selected',
            'Select drivers from the list to compare their delta to a reference driver.'
        );
        return;
    }

    const { allDriversCumulative } = buildCompareCumulativeTimes(resolvedDrivers);
    const refDriverNumber = chooseHeadToHeadReference(resolvedDrivers, allDriversCumulative);
    populateHeadToHeadReferencePicker(resolvedDrivers, refDriverNumber);

    if (refDriverNumber === null) {
        renderCompareContainerEmptyState(
            DOM.compareHeadToHeadChartContainer,
            'query_stats',
            'No Delta Data Available',
            'Lap timing data is not available for these drivers.'
        );
        return;
    }

    const refCumulative = allDriversCumulative[refDriverNumber] || {};
    const series = resolvedDrivers.map(driver => {
        const driverNumber = Number(driver.driver_number);
        const driverCumulative = allDriversCumulative[driverNumber] || {};
        const deltas = Object.keys(driverCumulative)
            .map(Number)
            .filter(lapNumber => Number.isFinite(lapNumber) && refCumulative[lapNumber] !== undefined)
            .map(lapNumber => ({
                lap_number: lapNumber,
                delta: driverCumulative[lapNumber] - refCumulative[lapNumber]
            }))
            .sort((a, b) => a.lap_number - b.lap_number);

        return {
            driver,
            driverNumber,
            teamHex: getDriverTeamHex(driver),
            deltas,
            deltaByNumber: new Map(deltas.map(delta => [delta.lap_number, delta.delta]))
        };
    }).filter(item => item.deltas.length > 0);

    if (series.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareHeadToHeadChartContainer,
            'query_stats',
            'No Delta Data Available',
            'Lap timing data is not available for these drivers.'
        );
        return;
    }

    const activeSeries = series;

    const domain = getCompareChartDomain(activeSeries.flatMap(item => item.deltas.map(delta => delta.lap_number)));
    if (!domain) {
        renderCompareContainerEmptyState(
            DOM.compareHeadToHeadChartContainer,
            'query_stats',
            'No Delta Data Available',
            'Lap timing data is not available for these drivers.'
        );
        return;
    }

    const { minLap, maxLap } = domain;
    const deltaValues = activeSeries
        .flatMap(item => item.deltas
            .filter(delta => lapWithinCompareWindow(delta.lap_number, minLap, maxLap))
            .map(delta => Math.abs(delta.delta)))
        .filter(Number.isFinite);

    if (deltaValues.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareHeadToHeadChartContainer,
            'zoom_out_map',
            'No Deltas In Range',
            'Reset zoom or choose a wider lap range to see delta data.'
        );
        return;
    }

    const maxAbsDelta = Math.max(...deltaValues, 1);
    const width = DOM.compareHeadToHeadChartContainer.clientWidth || 900;
    const height = 460;
    const padding = { top: 24, right: 34, bottom: 34, left: 58 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const getX = (lapNum) => {
        if (maxLap === minLap) return padding.left + chartWidth / 2;
        return padding.left + ((lapNum - minLap) / (maxLap - minLap)) * chartWidth;
    };

    const getY = (delta) => padding.top + chartHeight / 2 + (delta / maxAbsDelta) * (chartHeight / 2);

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    [-maxAbsDelta, 0, maxAbsDelta].forEach(delta => {
        const y = getY(delta);
        const line = document.createElementNS(svgNamespace, "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", padding.left + chartWidth);
        line.setAttribute("y2", y);
        line.setAttribute("class", delta === 0 ? "compare-zero-line" : "chart-grid-line");
        svg.appendChild(line);

        const text = document.createElementNS(svgNamespace, "text");
        text.setAttribute("x", padding.left - 10);
        text.setAttribute("y", y + 4);
        text.setAttribute("text-anchor", "end");
        text.setAttribute("class", "chart-axis-text");
        text.textContent = delta === 0 ? "REF" : formatSignedDelta(delta);
        svg.appendChild(text);
    });

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

    renderCompareSafetyCarPeriods(svg, getX, minLap, maxLap, padding, chartHeight, svgNamespace, false);

    series.forEach(item => {
        const rgb = getRGBColor(item.teamHex);
        const stateClasses = getCompareItemStateClasses(item.driverNumber);
        const points = item.deltas
            .filter(delta => lapWithinCompareWindow(delta.lap_number, minLap, maxLap))
            .map(delta => `${getX(delta.lap_number).toFixed(1)},${getY(delta.delta).toFixed(1)}`);

        if (points.length > 1) {
            const path = document.createElementNS(svgNamespace, "path");
            path.setAttribute("d", `M ${points.join(" L ")}`);
            path.setAttribute("class", `compare-chart-line ${stateClasses}`.trim());
            path.dataset.compareDriverNumber = String(item.driverNumber);
            path.style.stroke = `#${item.teamHex}`;
            path.style.setProperty('--team-color', `#${item.teamHex}`);
            path.style.setProperty('--team-color-glow', `rgba(${rgb}, 0.35)`);
            svg.appendChild(path);
        }

        item.deltas
            .filter(delta => lapWithinCompareWindow(delta.lap_number, minLap, maxLap))
            .forEach(delta => {
                const circle = document.createElementNS(svgNamespace, "circle");
                circle.setAttribute("cx", getX(delta.lap_number));
                circle.setAttribute("cy", getY(delta.delta));
                circle.setAttribute("r", 4.2);
                circle.setAttribute("class", `compare-chart-dot ${stateClasses}`.trim());
                circle.dataset.compareDriverNumber = String(item.driverNumber);
                circle.style.stroke = `#${item.teamHex}`;
                circle.style.setProperty('--team-color', `#${item.teamHex}`);
                svg.appendChild(circle);
            });
    });

    const seriesByDriver = new Map(series.map(item => [item.driverNumber, item]));
    const ctx = {
        kind: 'headToHead',
        title: 'Head-to-Head Delta',
        svgNamespace,
        svg,
        width,
        height,
        container: DOM.compareHeadToHeadChartContainer,
        getX,
        getY,
        series,
        minLap,
        maxLap,
        padding,
        chartWidth,
        chartHeight,
        valueFor(lapNumber, driverNumber) {
            const item = seriesByDriver.get(Number(driverNumber));
            return item ? item.deltaByNumber.get(Number(lapNumber)) ?? null : null;
        },
        formatValue(value, driverNumber) {
            return Number(driverNumber) === Number(refDriverNumber) ? 'REF' : formatSignedDelta(value);
        }
    };

    attachCompareCrosshair(svg, ctx);
    attachCompareZoom(svg, ctx);

    DOM.compareHeadToHeadChartContainer.appendChild(svg);
    updateCompareHighlightClasses();
    drawCompareCrosshairs();
}

function getTyreCompoundClass(compound) {
    const normalized = String(compound || 'UNKNOWN').trim().toUpperCase();
    const supported = new Set(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET']);
    return `stint-compound-${supported.has(normalized) ? normalized : 'UNKNOWN'}`;
}

function getTyreCompoundColor(compound) {
    const normalized = String(compound || 'UNKNOWN').trim().toUpperCase();
    return {
        SOFT: '#ff3c30',
        MEDIUM: '#ffd60a',
        HARD: '#f3f3f7',
        INTERMEDIATE: '#34c759',
        WET: '#007aff'
    }[normalized] || '#6c6c80';
}

function getDriverStints(driverNumber) {
    return (state.stints || [])
        .filter(stint => Number(stint.driver_number) === Number(driverNumber))
        .filter(stint => Number.isFinite(Number(stint.lap_start)) && Number.isFinite(Number(stint.lap_end)))
        .sort((a, b) => Number(a.lap_start) - Number(b.lap_start));
}

function getStintAtLap(driverNumber, lapNumber) {
    return getDriverStints(driverNumber).find(stint => (
        Number(stint.lap_start) <= Number(lapNumber) &&
        Number(stint.lap_end) >= Number(lapNumber)
    ));
}

function renderCompareStrategyTooltip(ctx, event) {
    const hoverLap = state.compareView.hoverLap;
    if (hoverLap === null || hoverLap === undefined) {
        hideCompareTooltip();
        return;
    }

    const rows = ctx.series
        .map(item => {
            const stint = getStintAtLap(item.driverNumber, hoverLap);
            return { item, stint };
        });

    if (rows.length === 0) {
        hideCompareTooltip();
        return;
    }

    const tooltip = getCompareTooltip();
    tooltip.classList.add("compare-strategy-tooltip");
    tooltip.innerHTML = `
        <div class="chart-tooltip-header">Tyre Strategy - Lap ${hoverLap}</div>
        <div class="compare-tooltip-rows">
            ${rows.map(row => {
                const label = getCompareDriverLabel(row.item.driver);
                if (!row.stint) {
                    return `
                        <div class="compare-tooltip-row" style="--team-color: #${row.item.teamHex};">
                            <div class="compare-tooltip-main">
                                <span class="compare-tooltip-swatch"></span>
                                <span>${escapeHtml(label)}</span>
                                <strong>--</strong>
                            </div>
                        </div>
                    `;
                }
                const start = Number(row.stint.lap_start);
                const end = Number(row.stint.lap_end);
                const length = end - start + 1;
                const compound = row.stint.compound || 'Unknown';
                return `
                    <div class="compare-tooltip-row" style="--team-color: #${row.item.teamHex};">
                        <div class="compare-tooltip-main">
                            <span class="compare-tooltip-swatch"></span>
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(compound)}</strong>
                        </div>
                        <div class="compare-tooltip-sectors">
                            <span>Stint ${escapeHtml(row.stint.stint_number ?? '--')}</span>
                            <span>L${start}-${end}</span>
                            <span>${length} laps</span>
                            <span>Age ${escapeHtml(row.stint.tyre_age_at_start ?? 0)}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    const rect = ctx.container.getBoundingClientRect();
    const pointerX = getComparePointerX(event, ctx);
    const left = rect.left + window.scrollX + Math.min(pointerX + 14, ctx.padding.left + ctx.chartWidth - 120);
    const top = rect.top + window.scrollY + ctx.padding.top + 10;
    tooltip.style.left = `${Math.max(rect.left + window.scrollX + ctx.padding.left, left)}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.display = "block";
}

function renderCompareTyreStrategyChart(selectedDrivers = null) {
    if (!DOM.compareTyreStrategyChartContainer || !DOM.compareTyreStrategyChartSection) return;

    const resolvedDrivers = selectedDrivers || state.selectedCompareDrivers
        .map(driverNumber => state.drivers.find(d => Number(d.driver_number) === Number(driverNumber)))
        .filter(Boolean);
    const shouldShow = isCompareChartVisible('tyreStrategy') && isCompareChartAvailable('tyreStrategy');
    setCompareChartSectionVisibility(DOM.compareTyreStrategyChartSection, shouldShow);
    if (!shouldShow) {
        DOM.compareTyreStrategyChartContainer.innerHTML = '';
        return;
    }

    DOM.compareTyreStrategyChartContainer.innerHTML = '';

    if (resolvedDrivers.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareTyreStrategyChartContainer,
            'tire_repair',
            'No Drivers Selected',
            'Select drivers from the list to compare tyre strategy.'
        );
        return;
    }

    const series = resolvedDrivers.map(driver => {
        const driverNumber = Number(driver.driver_number);
        return {
            driver,
            driverNumber,
            teamHex: getDriverTeamHex(driver),
            stints: getDriverStints(driverNumber)
        };
    }).filter(item => item.stints.length > 0);

    if (series.length === 0) {
        renderCompareContainerEmptyState(
            DOM.compareTyreStrategyChartContainer,
            'query_stats',
            'No Stint Data Available',
            'Tyre stint data is not available for the selected drivers.'
        );
        return;
    }

    const activeSeries = series;

    const domain = getCompareChartDomain(activeSeries.flatMap(item => item.stints.flatMap(stint => [
        Number(stint.lap_start),
        Number(stint.lap_end)
    ])));

    if (!domain) {
        renderCompareContainerEmptyState(
            DOM.compareTyreStrategyChartContainer,
            'query_stats',
            'No Stint Data Available',
            'Tyre stint data is not available for the selected drivers.'
        );
        return;
    }

    const { minLap, maxLap } = domain;
    const width = DOM.compareTyreStrategyChartContainer.clientWidth || 900;
    const rowHeight = 44;
    const chartHeight = Math.max(activeSeries.length * rowHeight, rowHeight);
    const height = chartHeight + 58;
    const padding = { top: 18, right: 34, bottom: 34, left: 96 };
    const chartWidth = width - padding.left - padding.right;

    const getX = (lapNum) => {
        if (maxLap === minLap) return padding.left + chartWidth / 2;
        return padding.left + ((lapNum - minLap) / (maxLap - minLap)) * chartWidth;
    };

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    activeSeries.forEach((item, index) => {
        const y = padding.top + index * rowHeight + 8;
        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("x", padding.left - 12);
        label.setAttribute("y", y + 20);
        label.setAttribute("text-anchor", "end");
        label.setAttribute("class", "compare-tyre-row-label");
        label.textContent = getCompareDriverLabel(item.driver);
        svg.appendChild(label);

        const rowLine = document.createElementNS(svgNamespace, "line");
        rowLine.setAttribute("x1", padding.left);
        rowLine.setAttribute("y1", y + 15);
        rowLine.setAttribute("x2", padding.left + chartWidth);
        rowLine.setAttribute("y2", y + 15);
        rowLine.setAttribute("class", "chart-grid-line");
        svg.appendChild(rowLine);

        item.stints.forEach(stint => {
            const startLap = Math.max(Number(stint.lap_start), minLap);
            const endLap = Math.min(Number(stint.lap_end), maxLap);
            if (startLap > endLap) return;

            const x = getX(startLap);
            const endX = getX(endLap);
            const widthPx = Math.max(endX - x, 4);
            const compound = String(stint.compound || 'UNKNOWN').toUpperCase();
            const stateClasses = getCompareItemStateClasses(item.driverNumber);
            const rect = document.createElementNS(svgNamespace, "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", widthPx);
            rect.setAttribute("height", 30);
            rect.setAttribute("rx", 5);
            rect.setAttribute("class", `compare-tyre-segment ${getTyreCompoundClass(compound)} ${stateClasses}`.trim());
            rect.dataset.compareDriverNumber = String(item.driverNumber);
            rect.style.fill = getTyreCompoundColor(compound);
            svg.appendChild(rect);

            if (widthPx > 38) {
                const text = document.createElementNS(svgNamespace, "text");
                text.setAttribute("x", x + widthPx / 2);
                text.setAttribute("y", y + 19);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("class", "compare-tyre-segment-label");
                text.textContent = `${compound.charAt(0)} L${Number(stint.lap_start)}-${Number(stint.lap_end)}`;
                svg.appendChild(text);
            }
        });
    });

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

    const ctx = {
        kind: 'tyreStrategy',
        title: 'Tyre Strategy',
        svgNamespace,
        svg,
        width,
        height,
        container: DOM.compareTyreStrategyChartContainer,
        getX,
        series,
        minLap,
        maxLap,
        padding,
        chartWidth,
        chartHeight,
        renderTooltip: renderCompareStrategyTooltip
    };

    attachCompareCrosshair(svg, ctx);
    attachCompareZoom(svg, ctx);

    DOM.compareTyreStrategyChartContainer.appendChild(svg);
    updateCompareHighlightClasses();
    drawCompareCrosshairs();
}
