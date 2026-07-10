# Replay Inactive Driver Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide DNS and time-appropriate `OUT` driver dots in Session Replay while showing `DNS` in the running-order status column.

**Architecture:** Derive one replay status object from enriched race results and the existing time-indexed position history. Both the SVG frame renderer and running-order tower consume that shared status so marker visibility and status text cannot disagree.

**Tech Stack:** Browser JavaScript, SVG DOM, Python `unittest`, Node.js JavaScript runtime invoked by the Python tests.

## Global Constraints

- Keep implementation documents in `doc/`.
- Run Python tests with `.venv/bin/python3`.
- Do not filter or rewrite backend `Position.z` placeholder coordinates.
- DNS dots are hidden for the entire replay; DNF dots disappear only after the driver's final position record.
- DNS and DNF running-order rows remain visible and show `DNS` or `OUT` respectively.

---

### Task 1: Add shared inactive-driver replay status

**Files:**
- Modify: `tests/test_session_replay_tab.py:508-640`
- Modify: `static/js/12-replay-context.js:598-614`

**Interfaces:**
- Consumes: `state.results`, `isReplayDriverRetiredAtMs(driverNumber, ms, positionRecords)`.
- Produces: `isReplayDriverDidNotStart(driverNumber) -> boolean` and `getReplayDriverStatusAtMs(driverNumber, ms, positionRecords) -> { didNotStart, retired, markerVisible, label }`.

- [ ] **Step 1: Write the failing status-model test**

Add a Node-backed test that builds position history for a DNS driver, a future DNF, and an active driver, then asserts:

```python
self.assertEqual(self._run_node(script), [
    {"didNotStart": True, "retired": False, "markerVisible": False, "label": "DNS"},
    {"didNotStart": False, "retired": False, "markerVisible": True, "label": ""},
    {"didNotStart": False, "retired": True, "markerVisible": False, "label": "OUT"},
    {"didNotStart": False, "retired": False, "markerVisible": True, "label": ""},
])
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
.venv/bin/python3 -m unittest tests.test_session_replay_tab.ReplayRaceContextTests.test_replay_driver_status_controls_dns_and_time_aware_out -v
```

Expected: `FAIL` because `isReplayDriverDidNotStart` and `getReplayDriverStatusAtMs` do not exist.

- [ ] **Step 3: Implement the shared status model**

Add result lookup and status normalization around the existing retirement helper:

```js
function getReplayDriverResult(driverNumber) {
    return (Array.isArray(state.results) ? state.results : [])
        .find(item => Number(item && item.driver_number) === Number(driverNumber)) || null;
}

function isReplayDriverDidNotStart(driverNumber) {
    const result = getReplayDriverResult(driverNumber);
    if (!result) return false;
    const status = String(result.status || '').trim().toUpperCase();
    return result.dns === true || status === 'DNS' || status === 'DID NOT START';
}

function getReplayDriverStatusAtMs(driverNumber, ms, positionRecords) {
    const didNotStart = isReplayDriverDidNotStart(driverNumber);
    const retired = !didNotStart && isReplayDriverRetiredAtMs(driverNumber, ms, positionRecords);
    return {
        didNotStart,
        retired,
        markerVisible: !didNotStart && !retired,
        label: didNotStart ? 'DNS' : (retired ? 'OUT' : '')
    };
}
```

Refactor `isReplayDriverRetiredAtMs` to use `getReplayDriverResult` without changing its time-aware behavior.

- [ ] **Step 4: Run the focused status test and verify GREEN**

Run the command from Step 2. Expected: `PASS`.

### Task 2: Wire status into graph markers and running order

**Files:**
- Modify: `tests/test_session_replay_tab.py:608-660`
- Modify: `static/js/10-track-replay.js:1453-1465`
- Modify: `static/js/12-replay-context.js:794-820`

**Interfaces:**
- Consumes: `getReplayDriverStatusAtMs(driverNumber, ms, positionRecords)` from Task 1.
- Produces: result-aware SVG marker visibility and `DNS`/`OUT` running-order labels.

- [ ] **Step 1: Write failing renderer and tower-wiring tests**

Add a Node-backed frame test with valid interpolated samples for DNS, retiring, and active drivers. Render once before and once after the retiring driver's final position record; assert DNS is always hidden, DNF transitions from visible to hidden, and the active driver stays visible. Also assert `updateReplayRaceContext` assigns `driverStatus.label` and uses it when deciding inactive row/gap state.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
.venv/bin/python3 -m unittest \
  tests.test_session_replay_tab.ReplayRaceContextTests.test_replay_frame_hides_dns_and_out_driver_markers \
  tests.test_session_replay_tab.ReplayRaceContextTests.test_running_order_uses_dns_and_out_status_labels -v
```

Expected: `FAIL` because `renderReplayFrame` ignores result status and the tower does not render `DNS`.

- [ ] **Step 3: Implement marker visibility**

In `renderReplayFrame`, calculate absolute replay time and reuse the memoized position index. Iterate `Object.entries(state.replay.carNodes)` so each node has its driver number, and hide the group when no interpolated position exists or `driverStatus.markerVisible` is false.

```js
const absoluteMs = getReplayAbsoluteMs(t);
const positionIndex = state.replay.positionIndex || buildDriverDateIndex(state.position);
state.replay.positionIndex = positionIndex;

Object.entries(state.replay.carNodes).forEach(([driverNumber, node]) => {
    const pos = interpolateReplaySample(node.samples, t);
    const driverStatus = getReplayDriverStatusAtMs(
        driverNumber,
        absoluteMs,
        positionIndex.get(Number(driverNumber))
    );
    if (!pos || !driverStatus.markerVisible) {
        node.group.style.display = 'none';
        return;
    }
```

- [ ] **Step 4: Implement DNS in the running order**

Replace the separate retirement boolean with `driverStatus`. Keep `PIT` above `OUT`, while DNS uses its explicit label and inactive styling:

```js
const driverStatus = getReplayDriverStatusAtMs(raceRow.driverNumber, absoluteMs, positionRecords);
const inactive = driverStatus.didNotStart || driverStatus.retired;
row.row.classList.toggle('out', driverStatus.didNotStart || (driverStatus.retired && !inPit));
row.status.textContent = driverStatus.didNotStart
    ? driverStatus.label
    : (inPit ? 'PIT' : driverStatus.label);
row.gap.textContent = inactive ? '\u2014' : formatReplayGap(gapValue, isLeader);
```

- [ ] **Step 5: Run focused replay tests and verify GREEN**

Run:

```bash
.venv/bin/python3 -m unittest tests.test_session_replay_tab -v
```

Expected: all Session Replay tests pass.

- [ ] **Step 6: Run full regression verification**

Run:

```bash
.venv/bin/python3 -m unittest discover -s tests -v
```

Expected: the complete test suite passes without errors or failures.

- [ ] **Step 7: Commit the implementation**

```bash
git add doc/2026-07-10-replay-inactive-driver-markers-plan.md \
  tests/test_session_replay_tab.py \
  static/js/10-track-replay.js \
  static/js/12-replay-context.js
git commit -m "fix: hide inactive drivers in session replay"
```
