# Design Spec: Group Sessions by Meeting Key in Sidebar

Group individual session cards in the sidebar into a single card per meeting (Grand Prix weekend) to reduce clutter and make it easier to navigate.

## User Requirements
- Group sessions with the same `meeting_key` into one card.
- In each card, display the sessions as a horizontal list of small badges (e.g., `FP1`, `FP2`, `FP3`, `Q`, `Race`).
- Clicking a session badge directly selects and loads that session, highlighting the active one.
- Clicking the card body itself automatically selects the "primary" session of that meeting (Live session > Race > latest chronological session). If a session in the meeting is already active, keep it selected.

## Proposed Changes

### Grouping and Sorting
We will modify `renderSessionsList` to:
1. Group `state.filteredSessions` by `meeting_key`.
2. Keep the meetings ordered chronologically by the `date_start` of their earliest session.
3. Keep the sessions within each meeting ordered chronologically by `date_start`.

### Short Session Names
A map or function `getSessionShortName(sessionName)` will convert standard session names to compact labels:
- `"Practice 1"` -> `"FP1"`
- `"Practice 2"` -> `"FP2"`
- `"Practice 3"` -> `"FP3"`
- `"Qualifying"` -> `"QL"`
- `"Sprint Qualifying"` -> `"SQ"`
- `"Sprint Shootout"` -> `"SS"`
- `"Sprint"` -> `"SPR"`
- `"Race"` -> `"R"`
- Fallback: First 3 characters of the name.

### Meeting Date Range Formatting
A function `formatMeetingDateRange(sessions)` will compute the date range of the meeting:
- If all sessions are on the same day: `"Jul 3"`
- Same month: `"Jul 3 - 5"`
- Cross month: `"Jun 29 - Jul 1"`
- Cross year: `"Dec 30, 2025 - Jan 1, 2026"`

### Meeting Status Precedence
The overall meeting status badge will follow the precedence:
1. **Live**: If any session in the meeting is live right now.
2. **Upcoming**: If no sessions are live, but at least one session is upcoming.
3. **Past**: If all sessions are past (and not cancelled).
4. **Cancelled**: If all sessions are cancelled.

### CSS Styling Updates
Add styling in `static/css/styles.css` for:
- `.meeting-sessions-container`: Flex container for session badges at the bottom of the card.
- `.session-badge`: Small badge/button for each session with hover/active states.
- `.session-badge.active`: High-contrast styling for the selected session.
- Keep `.session-card` styles but adapt padding and spacing to support the session badges list.

## Verification Plan

### Automated Tests
- Run `.venv/bin/pytest tests/test_session_autofocus.py` to ensure autofocus helper logic still works perfectly.

### Manual Verification
- Start the server using `.venv/bin/python3 app.py` and navigate the dashboard in a browser.
- Verify that session cards are successfully grouped by Grand Prix weekend.
- Verify that selecting a session badge highlights the active session, loads its dashboard data, and keeps the parent card active.
- Verify that searching and filtering works correctly, dynamically updating the session pills inside each meeting card.
