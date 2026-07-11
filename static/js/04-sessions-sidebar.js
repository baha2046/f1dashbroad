// Helper: Find the latest race event relative to current time
function findLatestRaceEvent(sessions, now = new Date()) {
    const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const sortedSessions = (Array.isArray(sessions) ? sessions : [])
        .filter(s => Number.isFinite(new Date(s.date_start).getTime()))
        .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    // Filter to only 'Race' type sessions (session_name 'Race' or 'Sprint', or session_type 'Race')
    const raceSessions = sortedSessions.filter(s => 
        s.session_name === 'Race' || s.session_name === 'Sprint' || s.session_type === 'Race'
    );
    
    if (raceSessions.length === 0) return null;
    
    // Prefer non-cancelled races if available
    const activeRaces = raceSessions.filter(s => !s.is_cancelled);
    const targets = activeRaces.length > 0 ? activeRaces : raceSessions;
    
    // Find the last completed or ongoing race
    const pastOrOngoing = targets.filter(s => new Date(s.date_start).getTime() <= nowTime);
    
    if (pastOrOngoing.length > 0) {
        // Return the one that started most recently
        return pastOrOngoing[pastOrOngoing.length - 1];
    } else {
        // Return the first upcoming race
        return targets[0];
    }
}

// Helper: Pick the best initial session focus for the current race weekend
function findInitialFocusSession(sessions, now = new Date()) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const nowTime = nowDate.getTime();
    if (!Number.isFinite(nowTime)) {
        return findLatestRaceEvent(sessions);
    }

    const datedSessions = (Array.isArray(sessions) ? sessions : [])
        .filter(s => Number.isFinite(new Date(s.date_start).getTime()))
        .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    if (datedSessions.length === 0) return null;

    const nonCancelledSessions = datedSessions.filter(s => !s.is_cancelled);
    const selectableSessions = nonCancelledSessions.length > 0 ? nonCancelledSessions : datedSessions;
    const sessionsByMeeting = new Map();
    selectableSessions.forEach(session => {
        if (session.meeting_key === undefined || session.meeting_key === null) return;
        if (!sessionsByMeeting.has(session.meeting_key)) {
            sessionsByMeeting.set(session.meeting_key, []);
        }
        sessionsByMeeting.get(session.meeting_key).push(session);
    });

    const weekendPaddingMs = 36 * 60 * 60 * 1000;
    const currentMeetings = Array.from(sessionsByMeeting.values())
        .map(meetingSessions => {
            const sortedMeetingSessions = meetingSessions
                .slice()
                .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
            const firstStart = new Date(sortedMeetingSessions[0].date_start).getTime();
            const lastEnd = sortedMeetingSessions.reduce((latest, session) => {
                const endTime = Number.isFinite(new Date(session.date_end).getTime())
                    ? new Date(session.date_end).getTime()
                    : new Date(session.date_start).getTime();
                return Math.max(latest, endTime);
            }, firstStart);

            return {
                sessions: sortedMeetingSessions,
                firstStart,
                lastEnd
            };
        })
        .filter(meeting => (
            meeting.firstStart - weekendPaddingMs <= nowTime &&
            nowTime <= meeting.lastEnd + weekendPaddingMs
        ))
        .sort((a, b) => a.firstStart - b.firstStart);

    if (currentMeetings.length > 0) {
        const currentMeeting = currentMeetings[currentMeetings.length - 1].sessions;
        const activeSessions = currentMeeting.filter(session => {
            const startTime = new Date(session.date_start).getTime();
            const endTime = Number.isFinite(new Date(session.date_end).getTime())
                ? new Date(session.date_end).getTime()
                : startTime;
            return startTime <= nowTime && nowTime <= endTime;
        });
        if (activeSessions.length > 0) {
            return activeSessions[activeSessions.length - 1];
        }

        const startedSessions = currentMeeting.filter(session => (
            new Date(session.date_start).getTime() <= nowTime
        ));
        if (startedSessions.length > 0) {
            return startedSessions[startedSessions.length - 1];
        }

        return currentMeeting[0];
    }

    return findLatestRaceEvent(selectableSessions, nowDate);
}

// Helper: Season-calendar races the livetiming archive doesn't cover yet.
// Livetiming only lists sessions that already ran, so anything on the Jolpica
// calendar whose weekend dates never appear there is an upcoming weekend.
function computeUpcomingRaces(schedule, sessions, now = new Date()) {
    const seenDates = new Set();
    (Array.isArray(sessions) ? sessions : []).forEach(session => {
        const day = String(session.date_start || '').slice(0, 10);
        if (day) seenDates.add(day);
    });

    const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();

    return (Array.isArray(schedule) ? schedule : []).filter(race => {
        const dates = [race.date, ...(race.sessions || []).map(s => s.date)].filter(Boolean);
        if (dates.length === 0) return false;
        if (dates.some(day => seenDates.has(day))) return false;
        // A finished weekend missing upstream is a data gap, not an upcoming race
        const lastDay = dates.slice().sort()[dates.length - 1];
        const weekendEnd = new Date(`${lastDay}T23:59:59Z`).getTime();
        return Number.isFinite(weekendEnd) && weekendEnd >= nowTime;
    });
}

// Monotonic token so a slow year's response can't overwrite a newer one
let sessionsListSequence = 0;

// Fetch and load F1 sessions list for selected year
async function loadSessions(year, autoFocus = false) {
    const loadToken = ++sessionsListSequence;
    const isStale = () => loadToken !== sessionsListSequence;
    // A year switch also invalidates any in-flight session detail load, so a
    // pending selectSession can't repaint the dashboard this call just hid
    sessionLoadSequence++;
    DOM.sessionsList.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading sessions...</p>
        </div>
    `;

    hideDashboard();

    try {
        // The schedule is a progressive enhancement; its failure must not
        // block the sessions list
        const [response, scheduleResponse] = await Promise.all([
            customFetch(`/api/sessions?year=${year}`),
            customFetch(`/api/schedule?year=${year}`).catch(() => null)
        ]);
        if (!response.ok) throw new Error('Failed to fetch sessions');

        const sessions = await response.json();
        let schedule = [];
        if (scheduleResponse && scheduleResponse.ok) {
            try {
                schedule = await scheduleResponse.json();
            } catch (e) {
                console.error('Schedule parse failed:', e);
            }
        }
        if (isStale()) return;
        state.sessions = sessions;
        state.upcomingRaces = computeUpcomingRaces(schedule, sessions);
        
        // Sort sessions by date (newest first, or oldest first)
        // Usually, order chronologically looks cleaner for F1 calendars
        state.sessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
        
        if (autoFocus) {
            const focusSession = findInitialFocusSession(state.sessions);
            if (focusSession) {
                state.selectedSession = focusSession;
            }
        }
        
        filterAndRenderSessions();
        
        if (autoFocus && state.selectedSession) {
            selectSession(state.selectedSession);
        }
    } catch (error) {
        console.error(error);
        if (isStale()) return;
        DOM.sessionsList.innerHTML = `
            <div class="error-state">
                <span class="material-icons-round" style="font-size:36px;color:var(--accent-red)">error_outline</span>
                <p>Could not load sessions. Please try again.</p>
                <button id="sessionsRetryBtn" class="filter-pill" style="margin-top:8px">Retry</button>
            </div>
        `;
        const retryBtn = document.getElementById('sessionsRetryBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => loadSessions(year));
    }
}

// Filter and render F1 sessions
function filterAndRenderSessions() {
    const searchQuery = DOM.sessionSearch.value.toLowerCase().trim();
    const typeFilter = document.querySelector('.filter-pill.active').dataset.type;
    const showCancelled = DOM.showCancelled ? DOM.showCancelled.checked : false;

    state.filteredSessions = state.sessions.filter(session => {
        // If session is cancelled and showCancelled toggle is OFF, hide it
        if (session.is_cancelled && !showCancelled) {
            return false;
        }

        const matchesSearch = 
            (session.session_name || '').toLowerCase().includes(searchQuery) ||
            (session.location || '').toLowerCase().includes(searchQuery) ||
            (session.circuit_short_name || '').toLowerCase().includes(searchQuery) ||
            (session.country_name || '').toLowerCase().includes(searchQuery);

        const matchesType = typeFilter === 'all' || 
            (session.session_type || '').includes(typeFilter) || 
            (typeFilter === 'Qualifying' && (session.session_name || '').includes('Qualifying')) ||
            (typeFilter === 'Practice' && (session.session_name || '').includes('Practice'));

        return matchesSearch && matchesType;
    });

    // Upcoming weekends have no per-session data yet, so only the text search
    // applies to them
    state.filteredUpcoming = (state.upcomingRaces || []).filter(race => (
        (race.race_name || '').toLowerCase().includes(searchQuery) ||
        (race.circuit_name || '').toLowerCase().includes(searchQuery) ||
        (race.locality || '').toLowerCase().includes(searchQuery) ||
        (race.country || '').toLowerCase().includes(searchQuery)
    ));

    // If currently selected session is filtered out, clear selection and hide dashboard
    if (state.selectedSession && !state.filteredSessions.some(s => s.session_key === state.selectedSession.session_key)) {
        hideDashboard();
        state.selectedSession = null;
    }

    renderSessionsList();
}

// Helper: Format a list of sessions into a date range string
function formatMeetingDateRange(sessions) {
    if (!sessions || sessions.length === 0) return '';
    
    // Sort chronologically by start date
    const sorted = [...sessions].sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    const firstDate = new Date(sorted[0].date_start);
    const lastDate = new Date(sorted[sorted.length - 1].date_start);
    
    if (isNaN(firstDate.getTime())) return '';
    
    const optionsMonth = { month: 'short' };
    const optionsDay = { day: 'numeric' };
    const optionsYear = { year: 'numeric' };
    
    const fMonth = firstDate.toLocaleDateString(undefined, optionsMonth);
    const fDay = firstDate.toLocaleDateString(undefined, optionsDay);
    const fYear = firstDate.getFullYear();
    
    if (isNaN(lastDate.getTime()) || firstDate.toDateString() === lastDate.toDateString()) {
        return `${fMonth} ${fDay}`;
    }
    
    const lMonth = lastDate.toLocaleDateString(undefined, optionsMonth);
    const lDay = lastDate.toLocaleDateString(undefined, optionsDay);
    const lYear = lastDate.getFullYear();
    
    if (fYear !== lYear) {
        return `${fMonth} ${fDay}, ${fYear} - ${lMonth} ${lDay}, ${lYear}`;
    }
    if (fMonth !== lMonth) {
        return `${fMonth} ${fDay} - ${lMonth} ${lDay}`;
    }
    return `${fMonth} ${fDay} - ${lDay}`;
}

// Helper: Get a short abbreviated name for a session
function getSessionShortName(sessionName) {
    if (!sessionName) return 'SES';
    const name = sessionName.trim();
    if (name === 'Practice 1') return 'FP1';
    if (name === 'Practice 2') return 'FP2';
    if (name === 'Practice 3') return 'FP3';
    if (name === 'Sprint Qualifying') return 'SQ';
    if (name === 'Sprint Shootout') return 'SS';
    if (name === 'Sprint') return 'SPR';
    if (name === 'Qualifying') return 'QL';
    if (name === 'Race') return 'R';
    return name.slice(0, 3).toUpperCase();
}

// Helper: Calculate overall meeting status based on its sessions
function getMeetingStatus(sessions) {
    let hasLive = false;
    let hasUpcoming = false;
    let hasPast = false;
    let allCancelled = true;
    
    sessions.forEach(session => {
        if (!session.is_cancelled) {
            allCancelled = false;
        }
        const status = getLiveSessionStatus(session);
        if (status.text === 'Live') {
            hasLive = true;
        } else if (status.text === 'Upcoming') {
            hasUpcoming = true;
        } else if (status.text === 'Past') {
            hasPast = true;
        }
    });
    
    if (hasLive) {
        return { text: 'Live', className: 'status-live' };
    }
    if (hasUpcoming) {
        return { text: 'Upcoming', className: 'status-upcoming' };
    }
    if (hasPast) {
        return { text: 'Past', className: 'status-past' };
    }
    if (allCancelled) {
        return { text: 'Cancelled', className: 'status-cancelled' };
    }
    return { text: 'Past', className: 'status-past' };
}

// Helper: "Fri 21:30" style local-time label for an upcoming schedule entry
function formatScheduleSessionTime(entry) {
    if (!entry || !entry.date) return 'TBC';
    if (!entry.time) {
        const day = new Date(`${entry.date}T00:00:00Z`);
        return isNaN(day.getTime()) ? 'TBC' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    const dateTime = new Date(`${entry.date}T${entry.time}`);
    if (isNaN(dateTime.getTime())) return 'TBC';
    return dateTime.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// Helper: Date-range label for an upcoming race weekend
function formatScheduleDateRange(race) {
    const days = [race.date, ...(race.sessions || []).map(s => s.date)]
        .filter(Boolean)
        .sort();
    if (days.length === 0) return '';
    const first = new Date(`${days[0]}T00:00:00Z`);
    const last = new Date(`${days[days.length - 1]}T00:00:00Z`);
    if (isNaN(first.getTime())) return '';
    const opts = { timeZone: 'UTC' };
    const fMonth = first.toLocaleDateString(undefined, { ...opts, month: 'short' });
    const fDay = first.toLocaleDateString(undefined, { ...opts, day: 'numeric' });
    if (isNaN(last.getTime()) || days[0] === days[days.length - 1]) {
        return `${fMonth} ${fDay}`;
    }
    const lMonth = last.toLocaleDateString(undefined, { ...opts, month: 'short' });
    const lDay = last.toLocaleDateString(undefined, { ...opts, day: 'numeric' });
    return fMonth === lMonth ? `${fMonth} ${fDay} - ${lDay}` : `${fMonth} ${fDay} - ${lMonth} ${lDay}`;
}

// Helper: Countdown label to the race start of an upcoming weekend
function formatRaceCountdown(race, now = new Date()) {
    if (!race || !race.date) return '';
    const start = new Date(`${race.date}T${race.time || '00:00:00Z'}`).getTime();
    const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(nowTime)) return '';
    const diff = start - nowTime;
    if (diff <= 0) return 'This weekend';
    const days = Math.floor(diff / 86400000);
    if (days === 0) {
        const hours = Math.max(1, Math.floor(diff / 3600000));
        return `In ${hours}h`;
    }
    if (days === 1) return 'Tomorrow';
    return `In ${days} days`;
}

// Helper: pill colour class for an upcoming schedule entry
function getScheduleSessionPillClass(name) {
    const label = String(name || '');
    if (label.includes('Quali')) return 'badge-quali';
    if (label.includes('Race') || label.includes('Sprint')) return 'badge-race';
    return 'badge-practice';
}

// Render upcoming race weekends (Jolpica calendar) below the session cards
function renderUpcomingSchedule(container) {
    const races = state.filteredUpcoming || [];
    if (races.length === 0) return;

    const divider = document.createElement('div');
    divider.className = 'list-section-divider';
    divider.innerHTML = `
        <span class="material-icons-round divider-icon" aria-hidden="true">event</span>
        <span class="divider-label">Upcoming Schedule</span>
        <span class="divider-count">${races.length}</span>
    `;
    container.appendChild(divider);

    races.forEach((race, index) => {
        const card = document.createElement('div');
        card.className = 'session-card upcoming-card';

        const flagEmoji = getCountryFlagByName(race.country);
        const placeName = [race.locality, race.country].filter(Boolean).join(', ');
        const countdown = formatRaceCountdown(race);
        const isNext = index === 0;
        const badgeClass = isNext ? 'status-next' : 'status-upcoming';
        const badgeText = isNext && countdown ? `Next · ${countdown}` : 'Upcoming';
        const roundChip = Number.isFinite(Number(race.round)) && race.round !== null
            ? `<span class="round-chip">R${escapeHtml(race.round)}</span>` : '';

        let scheduleHtml = '';
        (race.sessions || []).forEach(entry => {
            const shortName = getSessionShortName(entry.name);
            scheduleHtml += `
                <div class="upcoming-session-row" title="${escapeHtml(entry.name)}">
                    <span class="session-pill ${getScheduleSessionPillClass(entry.name)}" data-tooltip="${escapeHtml(entry.name)}">${escapeHtml(shortName)}</span>
                    <span class="upcoming-session-time">${escapeHtml(formatScheduleSessionTime(entry))}</span>
                </div>
            `;
        });

        card.innerHTML = `
            <div class="session-flag-tile" aria-hidden="true">
                <span class="loc-flag">${flagEmoji}</span>
            </div>
            <div class="session-card-main">
                <div class="card-top">
                    <span class="status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
                    <span class="session-date">${escapeHtml(formatScheduleDateRange(race))}</span>
                </div>
                <div class="session-gp">${escapeHtml(race.race_name || race.circuit_name || 'TBC')}${roundChip}</div>
                <div class="session-loc">
                    <span class="material-icons-round loc-pin" aria-hidden="true">place</span>
                    <span>${escapeHtml(placeName)}</span>
                </div>
                <div class="upcoming-schedule-grid">
                    ${scheduleHtml}
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

// Render F1 sessions list (grouped by meeting_key)
function renderSessionsList() {
    if (state.filteredSessions.length === 0 && (state.filteredUpcoming || []).length === 0) {
        DOM.sessionsList.innerHTML = `
            <div class="loading-state">
                <p>No sessions found matching criteria.</p>
            </div>
        `;
        return;
    }

    DOM.sessionsList.innerHTML = '';

    // Group sessions by meeting_key
    const meetingsMap = new Map();
    state.filteredSessions.forEach(session => {
        const key = session.meeting_key;
        if (!meetingsMap.has(key)) {
            meetingsMap.set(key, {
                meeting_key: key,
                circuit_short_name: session.circuit_short_name,
                location: session.location,
                country_name: session.country_name,
                country_code: session.country_code,
                sessions: []
            });
        }
        meetingsMap.get(key).sessions.push(session);
    });

    const meetings = Array.from(meetingsMap.values());

    meetings.forEach(meeting => {
        const isMeetingActive = state.selectedSession && meeting.sessions.some(s => s.session_key === state.selectedSession.session_key);
        const isAllCancelled = meeting.sessions.every(s => s.is_cancelled === true);
        const meetingCard = document.createElement('div');
        meetingCard.className = `session-card ${isAllCancelled ? 'cancelled' : ''} ${isMeetingActive ? 'active' : ''}`;

        const flagEmoji = COUNTRY_FLAGS[meeting.country_code] || '🏁';
        const placeName = [meeting.location, meeting.country_name].filter(Boolean).join(', ');
        const grandPrixName = `${meeting.circuit_short_name} GP`;
        const dateRangeText = formatMeetingDateRange(meeting.sessions);
        const meetingStatus = getMeetingStatus(meeting.sessions);

        let sessionsHtml = '';
        meeting.sessions.forEach(session => {
            const isSessionActive = state.selectedSession && state.selectedSession.session_key === session.session_key;
            let pillClass = 'session-pill';
            if (session.is_cancelled === true) {
                pillClass += ' badge-cancelled';
            } else if (session.session_name.includes('Quali')) {
                pillClass += ' badge-quali';
            } else if (session.session_name.includes('Race') || session.session_name.includes('Sprint')) {
                pillClass += ' badge-race';
            } else {
                pillClass += ' badge-practice';
            }
            if (isSessionActive) {
                pillClass += ' active';
            }
                        const shortName = getSessionShortName(session.session_name);
            sessionsHtml += `<button class="${pillClass}" data-session-key="${escapeHtml(session.session_key)}" data-tooltip="${escapeHtml(session.session_name)}">${escapeHtml(shortName)}</button>`;
        });

        meetingCard.innerHTML = `
            <div class="session-flag-tile" aria-hidden="true">
                <span class="loc-flag" style="${isAllCancelled ? 'filter: grayscale(1) opacity(0.6);' : ''}">${flagEmoji}</span>
            </div>
            <div class="session-card-main">
                <div class="card-top">
                    <span class="status-badge ${meetingStatus.className}">${escapeHtml(meetingStatus.text)}</span>
                    <span class="session-date">${escapeHtml(dateRangeText)}</span>
                </div>
                <div class="session-gp">${escapeHtml(grandPrixName)}</div>
                <div class="session-loc">
                    <span class="material-icons-round loc-pin" aria-hidden="true">place</span>
                    <span>${escapeHtml(placeName)}</span>
                </div>
                <div class="meeting-sessions-container">
                    ${sessionsHtml}
                </div>
            </div>
        `;

        meetingCard.addEventListener('click', (event) => {
            const pill = event.target.closest('.session-pill');
            if (pill) {
                const sessionKey = parseInt(pill.dataset.sessionKey || pill.dataset.session_key);
                const session = meeting.sessions.find(s => s.session_key === sessionKey);
                if (session) {
                    selectSession(session);
                    document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));
                    meetingCard.classList.add('active');
                    document.querySelectorAll('.session-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                }
                return;
            }

            // Clicked card body outside any pill
            const alreadySelected = state.selectedSession && meeting.sessions.some(s => s.session_key === state.selectedSession.session_key);
            if (alreadySelected) return;

            // Pick primary session: Live > Race > latest chronological session
            let targetSession = meeting.sessions.find(s => getLiveSessionStatus(s).text === 'Live');
            if (!targetSession) {
                targetSession = meeting.sessions.find(s => s.session_name === 'Race' || s.session_type === 'Race');
            }
            if (!targetSession) {
                targetSession = meeting.sessions[meeting.sessions.length - 1];
            }

            if (targetSession) {
                selectSession(targetSession);
                document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));
                meetingCard.classList.add('active');
                const pillToHighlight = meetingCard.querySelector(`.session-pill[data-session-key="${targetSession.session_key}"]`);
                if (pillToHighlight) {
                    document.querySelectorAll('.session-pill').forEach(p => p.classList.remove('active'));
                    pillToHighlight.classList.add('active');
                }
            }
        });

        DOM.sessionsList.appendChild(meetingCard);

        if (isMeetingActive) {
            setTimeout(() => {
                meetingCard.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }, 50);
        }
    });

    renderUpcomingSchedule(DOM.sessionsList);
}
