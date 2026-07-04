# Live Mode Implementation Plan

**Goal:** Auto-refresh the selected session while it is live: poll
`/api/position` + `/api/intervals` + `/api/race_control` every 30 s, show a
pulsing LIVE indicator with a next-update countdown in the session header, and
render a Live Timing table (current order + gaps from the new OpenF1
`intervals` endpoint) on the Drivers tab.

**Design:** see `2026-07-04-live-mode-design.md`.

**Tech Stack:** Python (Quart, httpx), JavaScript (vanilla), CSS, Python
unittest (+ Node subprocess for JS helpers).

## Global Constraints

- Keep implementation documents under the `doc/` directory.
- Use Python in `.venv/bin/python3` for testing (run via
  `.venv/bin/python3 -m unittest discover tests`).
- Endpoint params are integers only.
- All timers cleaned up on session switch; no polling for non-live sessions.

---

### Task 1: TDD tests

**Files:** Create `tests/test_live_mode.py`

- [ ] `/api/intervals` param validation (400s), cached-file serving, upstream
  URL construction on cache miss.
- [ ] `is_session_live` unit cases; live session → 30 s TTL (stale cache
  refetched), non-live session → 5 min TTL (same-age cache served).
- [ ] Node tests for `isLiveSessionNow` and `buildLiveTimingRows`.
- [ ] Static wiring tests: index.html ids + `11-live-mode.js` script tag, JS
  functions/DOM refs, `.live-*` CSS classes.
- [ ] Run suite → new tests FAIL.
- [ ] Commit: `test: add TDD tests for live mode polling, intervals endpoint, and wiring`

### Task 2: CSS styles

**Files:** Modify `static/css/styles.css`

- [ ] Live indicator (pulsing dot, countdown), live timing card/table styles.
- [ ] Commit: `style: add styles for live indicator and live timing table`

### Task 3: Backend

**Files:** Modify `app.py`

- [ ] `"intervals"` entry in `OPENF1_SESSION_ENDPOINTS`.
- [ ] `LIVE_CACHE_TTL_SECONDS`, `LIVE_SESSION_OVERRUN_SECONDS`,
  `is_session_live()`; live-aware TTL selection in `get_cached_api`.
- [ ] Backend tests PASS.

### Task 4: Frontend

**Files:** Create `static/js/11-live-mode.js`; modify `templates/index.html`,
`static/js/01-state-helpers.js`, `static/js/02-dom.js`,
`static/js/05-session-load.js`

- [ ] index.html: `#liveIndicator` in the session header, `#liveTimingCard`
  atop the Drivers view, script tag for `11-live-mode.js`.
- [ ] State: `state.intervals`, `state.live` + `createLiveState()`; reset +
  `stopLiveMode()` on session select; `setupLiveMode()` after render.
- [ ] DOM refs for the new elements.
- [ ] 11-live-mode.js: `isLiveSessionNow`, `setupLiveMode`, `stopLiveMode`,
  `refreshLiveData` (parallel customFetch, stale-response guard, auto-stop),
  countdown ticker, `buildLiveTimingRows`, `renderLiveTiming`, `formatLiveGap`.
- [ ] Full suite PASS; verify in browser preview.
- [ ] Commit: `feat: add live mode with auto-refresh, LIVE indicator, and live timing table`
