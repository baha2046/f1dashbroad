# Results and Session Replay redesign

Date: 2026-07-10

## Goal

Bring the Results and Session Replay tabs into the same premium, data-led visual system as the Circuit and Weather dashboards while preserving the existing session data contracts.

## Results

- Added an official-classification hero with session-aware summary cards.
- Race summaries show the winner, fastest lap, classified field, and awarded points.
- Qualifying summaries switch to pole position, pole time, field size, and the final Q/SQ segment.
- Practice sessions use neutral timing language, leader gap, field running, and total-lap metrics instead of race/points labels.
- Live and incomplete sessions are marked as current/live classifications; missing points remain unavailable instead of being presented as zero.
- Wrapped the full order in a dedicated classification panel with a dynamic entry count.
- Added team-colour row edges, podium treatments, and refreshed status/fastest-lap pills.
- Restyled driver standings, constructor standings, and championship progression as one visual family.
- The Drivers/Constructors progression toggle now synchronizes `aria-pressed` state.

## Session Replay

- Reorganized the tab into a broadcast-style header, transport bar, timeline panel, track stage, event feed, and timing tower.
- Preserved all existing replay IDs and data-rendering hooks.
- Added visible shortcut hints, a custom scrubber, replay-state grouping, and a timeline state legend.
- Added a grid-backed track stage and a standalone, scrollable timing tower.
- The track-stage status now reflects idle, loading, unavailable, error, and synchronized replay states.
- Car markers and timing rows remain cross-linked. Selection now dims the rest of the field, can be toggled with a click, and supports Enter/Space from the keyboard.
- Timing rows keep DOM/focus order synchronized with the running order and expose position, tyre, status, and gap in their accessible names.
- Replay play/pause, speed, and scrubber controls now expose updated accessible labels and values.
- Global replay shortcuts ignore focused buttons and button-like controls.

## Responsive design

- Both tabs establish inline-size containers.
- Results highlights collapse from four columns to two and then one.
- Replay transport controls stack before the map and timing tower collapse into a single-column layout.
- Motion-heavy effects are disabled when `prefers-reduced-motion` is enabled.

## Files

- `templates/index.html`
- `static/css/styles.css`
- `static/js/02-dom.js`
- `static/js/03-api-settings.js`
- `static/js/06-overview-tabs.js`
- `static/js/10-track-replay.js`
- `static/js/12-replay-context.js`
- `tests/test_results_replay_redesign.py`

## Verification

- Run: `.venv/bin/python3 -m unittest discover -s tests`
- Visual checks: Race Results, championship progression toggle, Replay play/pause, speed selection, timeline seek, driver focus, and compact-width layouts.
