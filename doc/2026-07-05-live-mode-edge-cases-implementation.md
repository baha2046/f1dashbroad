# Live Mode Edge Cases Implementation

## Summary

Finished the live-mode edge cases around session status consistency and
upcoming-session activation.

## Changes

- Added one frontend status helper, `getLiveSessionStatus`, that uses the same
  rule as live polling: cancelled sessions are cancelled, future sessions are
  upcoming, and started sessions remain live through `date_end + 30 minutes`.
- Updated both the sidebar cards and selected-session header to render status
  from that helper, so they no longer mark a session as past during the
  backend/frontend overrun window.
- Extended live-mode state with `liveStartTimerId` and made `setupLiveMode`
  schedule a one-shot timer for an already-selected upcoming session. When the
  start time arrives, the header and session list refresh and live polling
  starts without requiring the user to reselect the session.
- Ensured `stopLiveMode` clears the pending start timer as well as refresh and
  countdown intervals.
- Refreshed the sidebar status during live refreshes and at live-mode stop so
  the selected session transitions cleanly between upcoming, live, and past.

## Verification

- `.venv/bin/python3 -m unittest discover tests -p 'test_live_mode.py'`
