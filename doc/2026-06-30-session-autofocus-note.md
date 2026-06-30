# Session Auto-Focus Update

## Summary

Initial auto-focus now prefers the current race weekend before falling back to the latest race. The dashboard selects an active session first, then the most recently started session from the same weekend, then the first upcoming session from that weekend.

## Implementation

- Updated `static/js/dashboard.js` with `findInitialFocusSession(sessions, now)`.
- Kept `findLatestRaceEvent(sessions, now)` as the off-weekend fallback.
- Updated `loadSessions(year, autoFocus)` to use the new selector when auto-focus is enabled.

## Verification

```bash
.venv/bin/python3 -m unittest tests/test_session_autofocus.py
```
