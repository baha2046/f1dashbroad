# Pit Lap Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark pit-in laps and the following pit-out laps in Race and Sprint lap timing views using OpenF1 pit data.

**Architecture:** Add a cached Quart `/api/pit` proxy and load pit records once per Race/Sprint session. Shared frontend helpers classify lap rows and chart points so the single-driver chart, compare chart, and All Lap Times table stay consistent.

**Tech Stack:** Quart, HTTPX, vanilla JavaScript, SVG, CSS, Python unittest.

---

## File Structure

- Modify `app.py` to add the cached pit endpoint.
- Modify `templates/index.html` to add a Pit column to All Lap Times.
- Modify `static/js/dashboard.js` to add pit state, Race/Sprint gating, fetch logic, annotation helpers, chart markers, tooltip text, and table badges.
- Modify `static/css/styles.css` to style pit badges, chart guides, and pit-specific points/rows.
- Create `tests/test_pit_annotations.py` for failing-first backend and static wiring coverage.
- Keep this implementation plan and the design note in `doc/`.

## Tasks

### Task 1: Failing Tests

**Files:**
- Create: `tests/test_pit_annotations.py`

- [ ] **Step 1: Write backend and static wiring tests**

Add tests that require `/api/pit`, Race/Sprint gating, frontend helpers, the table Pit column, and pit marker styles.

- [ ] **Step 2: Run focused tests to verify red**

Run: `.venv/bin/python3 -m unittest tests.test_pit_annotations`

Expected: `FAIL` because the endpoint and frontend wiring do not exist yet.

### Task 2: Backend Pit Proxy

**Files:**
- Modify: `app.py`
- Test: `tests/test_pit_annotations.py`

- [ ] **Step 1: Add `/api/pit`**

Create a route that validates `session_key`, calls `https://api.openf1.org/v1/pit?session_key=...`, caches to `pit_<session_key>.json`, and forwards the `X-OpenF1-Key` header.

- [ ] **Step 2: Run focused tests**

Run: `.venv/bin/python3 -m unittest tests.test_pit_annotations.PitApiTests`

Expected: `OK`.

### Task 3: Frontend Pit Data Flow

**Files:**
- Modify: `static/js/dashboard.js`
- Test: `tests/test_pit_annotations.py`

- [ ] **Step 1: Add state and fetch helpers**

Add `pitStops: []`, `isPitAnnotationSession(session)`, and `fetchSessionPits(sessionKey)`.

- [ ] **Step 2: Load pits only for Race/Sprint sessions**

Reset pit state on session changes and fetch `/api/pit` only when the selected session is Race or Sprint.

### Task 4: Pit Annotations in UI

**Files:**
- Modify: `templates/index.html`
- Modify: `static/js/dashboard.js`
- Modify: `static/css/styles.css`
- Test: `tests/test_pit_annotations.py`

- [ ] **Step 1: Add the All Lap Times Pit column**

Insert a Pit header and render `Pit in` / `Pit out` badges from `getLapPitAnnotation(driverNumber, lapNumber)`.

- [ ] **Step 2: Add chart markers**

Render pit-in and pit-out guides on the single-driver chart and pit-specific point styling/tooltips on both chart renderers.

- [ ] **Step 3: Add CSS**

Style pit badges, pit rows, chart guide lines, chart guide labels, and pit dots.

### Task 5: Verification

**Files:**
- Test: `tests/test_pit_annotations.py`
- Test: `tests/test_compare_tab.py`
- Test: `tests/test_race_control_feed.py`

- [ ] **Step 1: Run focused tests**

Run: `.venv/bin/python3 -m unittest tests.test_pit_annotations`

Expected: `OK`.

- [ ] **Step 2: Run full suite**

Run: `.venv/bin/python3 -m unittest discover tests`

Expected: all tests pass.

- [ ] **Step 3: Rendered QA**

Start the app with `.venv/bin/python3 app.py`, open `http://127.0.0.1:5300`, select a Race/Sprint session, and verify the chart/table pit markers render without console errors.
