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

// Fetch and load F1 sessions list for selected year
async function loadSessions(year, autoFocus = false) {
    DOM.sessionsList.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading sessions...</p>
        </div>
    `;
    
    hideDashboard();

    try {
        const response = await customFetch(`/api/sessions?year=${year}`);
        if (!response.ok) throw new Error('Failed to fetch sessions');
        
        state.sessions = await response.json();
        
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
        DOM.sessionsList.innerHTML = `
            <div class="error-state">
                <span class="material-icons-round" style="font-size:36px;color:var(--accent-red)">error_outline</span>
                <p>Could not load sessions. Please try again.</p>
                <button onclick="loadSessions('${year}')" class="filter-pill" style="margin-top:8px">Retry</button>
            </div>
        `;
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

    // If currently selected session is filtered out, clear selection and hide dashboard
    if (state.selectedSession && !state.filteredSessions.some(s => s.session_key === state.selectedSession.session_key)) {
        hideDashboard();
        state.selectedSession = null;
    }

    renderSessionsList();
}

// Render F1 sessions list
function renderSessionsList() {
    if (state.filteredSessions.length === 0) {
        DOM.sessionsList.innerHTML = `
            <div class="loading-state">
                <p>No sessions found matching criteria.</p>
            </div>
        `;
        return;
    }

    DOM.sessionsList.innerHTML = '';
    state.filteredSessions.forEach(session => {
        const card = document.createElement('div');
        const isCancelled = session.is_cancelled === true;
        card.className = `session-card ${isCancelled ? 'cancelled' : ''} ${state.selectedSession && state.selectedSession.session_key === session.session_key ? 'active' : ''}`;
        
        let badgeClass = 'badge-practice';
        let badgeText = session.session_name;
        
        if (isCancelled) {
            badgeClass = 'badge-cancelled';
            badgeText = 'Cancelled';
        } else if (session.session_name.includes('Quali')) {
            badgeClass = 'badge-quali';
        } else if (session.session_name.includes('Race') || session.session_name.includes('Sprint')) {
            badgeClass = 'badge-race';
        }

        // Determine status for badge
        const status = getLiveSessionStatus(session);

        const flagEmoji = COUNTRY_FLAGS[session.country_code] || '🏁';
        const sessionDate = new Date(session.date_start).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric'
        });
        const grandPrixName = `${session.circuit_short_name} GP`;
        const placeName = [session.location, session.country_name].filter(Boolean).join(', ');

        card.innerHTML = `
            <div class="session-flag-tile" aria-hidden="true">
                <span class="loc-flag" style="${isCancelled ? 'filter: grayscale(1) opacity(0.6);' : ''}">${flagEmoji}</span>
            </div>
            <div class="session-card-main">
                <div class="card-top">
                    <span class="session-type-badge ${badgeClass}">${badgeText}</span>
                    <div class="card-top-right">
                        <span class="status-badge ${status.className}">${status.text}</span>
                        <span class="session-date">${sessionDate}</span>
                    </div>
                </div>
                <div class="session-gp">${grandPrixName}</div>
                <div class="session-loc">
                    <span class="material-icons-round loc-pin" aria-hidden="true">place</span>
                    <span>${placeName}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            document.querySelectorAll('.session-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectSession(session);
        });

        DOM.sessionsList.appendChild(card);

        // Scroll active card into view
        if (state.selectedSession && state.selectedSession.session_key === session.session_key) {
            setTimeout(() => {
                card.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }, 50);
        }
    });
}
