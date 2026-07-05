# Group Sessions by Meeting Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group session cards in the sidebar into a single card per meeting (Grand Prix weekend) to reduce clutter and make it easier to navigate.

**Architecture:** We will update `static/js/04-sessions-sidebar.js` to group filtered sessions by `meeting_key`, format dates as range, compute the overall status of the meeting, render badges, and handle clicks on specific sessions. We will add custom styles in `static/css/styles.css` for the grouped session badges.

**Tech Stack:** JavaScript (client-side), CSS.

## Global Constraints
- Keep implementation documents in `doc/`.
- Use python in `.venv/bin/python3` for testing the web app.

---

### Task 1: Add Custom CSS Styling for Grouped Sessions

**Files:**
- Modify: `static/css/styles.css`

**Interfaces:**
- Produces: CSS classes `.meeting-sessions-container`, `.session-pill`, and active state modifiers for each badge type (`.badge-race`, `.badge-quali`, `.badge-practice`, `.badge-cancelled`).

- [ ] **Step 1: Edit styles.css to append grouped sessions styles**
  Add the CSS styles to `static/css/styles.css` for `.meeting-sessions-container` and `.session-pill`.

- [ ] **Step 2: Verify CSS builds and loads**
  We will verify there are no syntax errors in the CSS and the file parses successfully.

---

### Task 2: Implement Grouping and Rendering Logic in Javascript

**Files:**
- Modify: `static/js/04-sessions-sidebar.js`

**Interfaces:**
- Consumes: `state.filteredSessions`, `COUNTRY_FLAGS`, `getLiveSessionStatus`, `selectSession`
- Produces: Updated `renderSessionsList` function, `formatMeetingDateRange`, `getSessionShortName`, `getMeetingStatus`.

- [ ] **Step 1: Write helper functions and update renderSessionsList**
  Modify `static/js/04-sessions-sidebar.js` to define `formatMeetingDateRange`, `getSessionShortName`, `getMeetingStatus`, and refactor `renderSessionsList` to group sessions by `meeting_key`, render session pills, and implement custom click handlers.

- [ ] **Step 2: Run automated tests to verify JS functions**
  Run `pytest tests/test_session_autofocus.py` to ensure that our JS file still loads and is syntax error free under Pytest/Node context.

---

### Task 3: Manual E2E Testing and Verification

- [ ] **Step 1: Run manual verification**
  Start the app and check that cards are grouped and clickable.
