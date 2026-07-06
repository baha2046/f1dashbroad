# Plan: Team Radio in Race Control & Session Replay

Implementation order for `2026-07-06-team-radio-design.md` (TDD: tests
land first, then per-concern commits — docs / test / style / feat).

## 1. Tests first — `tests/test_team_radio.py`

- `TeamRadioApiTests` (async, patched `CACHE_DIR`):
  cached `team_radio_<key>.json` served by `/api/team_radio`;
  missing/invalid `session_key` → 400;
  `"team_radio"` registered in `OPENF1_SESSION_ENDPOINTS`.
- `TeamRadioStaticWiringTests` (index.html / concatenated JS / CSS
  string assertions, via `js_sources.read_dashboard_js`).

## 2. Styles — `static/css/styles.css`

`.race-control-toggles`, `.race-control-type-team-radio`,
`.team-radio-player`, `.team-radio-play-btn` (+ `.playing`),
`.team-radio-clip-time`, `.replay-team-radio-ticker`
(+ `[hidden]`, label, meta).

## 3. Feature

1. `app.py`: add `team_radio` to `OPENF1_SESSION_ENDPOINTS`.
2. `01-state-helpers.js`: `state.teamRadio`, replay-state fields
   `teamRadioIndex` / `lastTeamRadioTickMs`.
3. `templates/index.html`: Show Team Radio switch (header toggles
   wrapped in `.race-control-toggles`); replay team-radio ticker.
4. `02-dom.js`: `showTeamRadio`, `replayTeamRadioTicker`,
   `replayTeamRadioPlayBtn`, `replayTeamRadioMeta`.
5. `05-session-load.js`: reset + fetch + parse `state.teamRadio`.
6. `06-overview-tabs.js`: shared audio player helpers; merged feed
   entries (lap attribution via `state.allSessionLaps`, sticky grouping
   fallback); radio item renderer; summary count.
7. `12-replay-context.js`: `REPLAY_TEAM_RADIO_MAX_AGE_MS`,
   `latestReplayTeamRadioAt`, `updateReplayTeamRadioTicker`,
   `clearReplayTeamRadioTicker`.
8. `10-track-replay.js`: call ticker update from `renderReplayFrame`,
   clear from `resetReplay`.
9. `11-live-mode.js`: poll `/api/team_radio`, refresh state + feed,
   invalidate the replay radio index.
10. `03-api-settings.js`: listeners — `showTeamRadio` change, feed
    click delegation, ticker button click.

## 4. Verify

`.venv/bin/python3 -m unittest discover tests` from the repo root, then
browser check of both tabs against a 2025/2026 race session (feed items
play/pause, toggle hides clips, replay ticker follows the playhead).
