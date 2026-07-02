# Walkthrough: Enhance Drivers Tab Information

This walkthrough documents the implementation of the enhanced driver details in the dashboard.

## Changes Made
We updated the frontend and backend to fetch, parse, and display additional driver metadata (nationality flag, birthday-based age at session date, and Wikipedia profile link).

### 1. Backend API Merging
Modified `/api/drivers` in [app.py](file:///Users/ericchan/IdeaProjects/F1/app.py) to:
- Detect the season year of the session using a custom helper `find_session_year`.
- Query and cache `f1api.dev` driver list (`https://f1api.dev/api/{year}/drivers`).
- Fall back to three-letter abbreviation (`name_acronym` / `shortName`) matching if driver numbers differ between OpenF1 and f1api.dev.
- Map the driver's nationality to flag emojis.
- Append `nationality`, `nationality_flag`, `birthday`, and `wiki_url` to the response.

### 2. Frontend HTML Structure
Updated [index.html](file:///Users/ericchan/IdeaProjects/F1/templates/index.html) to add placeholders for the flag emoji, age text, and Wikipedia external link icon in the driver statistics header section.

### 3. Frontend Logic Integration
Modified [dashboard.js](file:///Users/ericchan/IdeaProjects/F1/static/js/dashboard.js) to:
- Bind the new HTML elements in the Laps/Stints tab header.
- Add `calculateAgeAtDate(birthdayStr, targetDateStr)` which dynamically computes the driver's exact age at the start of the selected session/race.
- Render an inline `.driver-meta` row under the name acronym in each card in the "Drivers" grid.
- Use `e.stopPropagation()` on the Wikipedia link elements to allow opening Wikipedia in a new tab without triggering standard card clicks (e.g. switching tabs).
- Display the nationality flag, computed age at the session date, and a clickable Wikipedia link in the details panel header on the "Laps & Stints" tab when a driver is selected.

### 4. Styles
Added styles in [styles.css](file:///Users/ericchan/IdeaProjects/F1/static/css/styles.css) for `.driver-meta`, `.driver-flag`, `.driver-age`, and `.driver-wiki-link` matching the modern glassmorphism aesthetic of the dashboard.

---

## Verification Results

### Automated Tests
Running the python unit tests confirms that the static checks pass successfully:
```bash
.venv/bin/python3 -m unittest discover tests
```
Output:
```text
Ran 38 tests in 0.078s

OK
```

### Manual Verification
1. Open the dashboard.
2. Select a session.
3. Open the "Drivers" tab and observe each driver card.
4. Verify the cards show a flag emoji, computed age (e.g., "19 yrs"), and a Wikipedia icon link.
5. Click on a Wikipedia icon link and verify it opens the page in a new tab without triggering the parent card click event (it shouldn't switch tabs).
6. Click on a driver card to open the "Laps & Stints" tab.
7. Verify that the stats profile header next to the driver headshot displays the flag emoji, computed age at the date of the session, and the Wikipedia link.
