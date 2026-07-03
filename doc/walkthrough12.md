# Walkthrough: Hide/Show Blue Flag Messages in Race Control Tab

This walkthrough documents the implementation of the show/hide blue flag toggle in the Race Control tab feed.

## Changes Made
We updated the frontend UI and Javascript feed rendering to support filtering out blue flag messages based on user selection.

### 1. Frontend HTML Layout
Modified [index.html](file:///Users/ericchan/IdeaProjects/F1/templates/index.html) to:
- Insert a `.race-control-toggle` container on the right side of `.race-control-header`.
- Use the existing styled toggle switch controls (`.switch` and `.slider`) with checkbox id `showBlueFlags` to control visibility.

### 2. Frontend Styles
Added layout styles in [styles.css](file:///Users/ericchan/IdeaProjects/F1/static/css/styles.css) to:
- Align `.race-control-toggle` container nicely with the main heading block using flex alignment and minor margin adjustments.

### 3. Frontend JS Logic
Modified [dashboard.js](file:///Users/ericchan/IdeaProjects/F1/static/js/dashboard.js) to:
- Add a reference to the `showBlueFlags` checkbox element in `DOM`.
- Bind a `change` event listener on `showBlueFlags` checkbox that triggers `renderRaceControlFeed()`.
- Update `renderRaceControlFeed()` to read the state of `showBlueFlags` checkbox.
- Filter out any messages where `getRaceControlType(item) === 'BLUE'`.
- Update the empty state summary message to `'No session messages recorded (excluding blue flags)'` if all messages are filtered out.

### 4. Automated Tests
Modified [test_race_control_feed.py](file:///Users/ericchan/IdeaProjects/F1/tests/test_race_control_feed.py) to:
- Assert that `index.html` contains the `showBlueFlags` checkbox toggle element.
- Assert that `dashboard.js` references the checkbox element in its DOM selectors.
- Assert that `styles.css` contains the `.race-control-toggle` styles.

---

## Verification Results

### Automated Tests
Ran the python unit tests to verify wiring and logic:
```bash
.venv/bin/python3 -m unittest discover tests
```
Output:
```text
Ran 39 tests in 0.072s

OK
```

### Manual Verification
1. Load a session containing blue flag notifications (e.g., GP sessions with multiple blue flags).
2. Go to the "Race Control" tab.
3. Uncheck the "Show Blue Flags" toggle switch.
4. Verify blue flag messages disappear from the timeline feed.
5. Check the "Show Blue Flags" toggle switch.
6. Verify blue flag messages reappear in chronological order.
