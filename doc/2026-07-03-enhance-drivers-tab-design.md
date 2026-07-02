# Spec: Enhance Drivers Tab Information

Enhance the "Drivers" tab in the F1 dashboard by integrating extra information from `https://f1api.dev/api/{year}/drivers`. This metadata includes nationality, birth date (to calculate age at the date of the race), and a Wikipedia link.

## Proposed Changes

### Backend (`app.py`)
- Define `NATIONALITY_TO_FLAG` dictionary mapping country/nationality strings to flag emojis.
- Implement `find_session_year(session_key)` to automatically detect the season year from the local data cache.
- Implement `get_f1api_drivers(year)` to fetch and cache driver data from `f1api.dev`.
- Update the `/api/drivers` endpoint to merge `nationality`, `nationality_flag`, `birthday`, and `wiki_url` into the driver objects.

### Frontend HTML (`templates/index.html`)
- Update the driver profile header in the Laps & Stints tab to include placeholder elements for:
  - Driver flag (`statsDriverFlag`)
  - Driver age (`statsDriverAge`)
  - Driver Wikipedia link (`statsDriverWiki`)

### Frontend JS (`static/js/dashboard.js`)
- Add selectors for the new DOM elements.
- Implement `calculateAgeAtDate(birthdayStr, targetDateStr)` to compute driver age dynamically based on the session's start date (`date_start`).
- Update `renderDriversGrid()` to construct and display the metadata row under the acronym on each card.
- Add `e.stopPropagation()` handling to the Wikipedia link on the card so it does not trigger the card click event.
- Update `selectDriverForStats()` to display the flag, age, and wiki link in the side panel header.

### Frontend CSS (`static/css/styles.css`)
- Style the driver card metadata row (`.driver-meta`, `.driver-flag`, `.driver-age`, `.driver-wiki-link`).
- Style the header metadata section in the Laps & Stints panel.

---

## Verification Plan

### Automated Verification
- Verify that `app.py` passes all Quart backend requirements.
- Verify that `api/drivers` returns the merged fields successfully.

### Manual Verification
- Load the dashboard and open the "Drivers" tab.
- Verify that the card displays flag, age, and a Wikipedia link icon.
- Hover over the Wikipedia link to check details, and click it to ensure it opens in a new tab without shifting to the Laps & Stints tab.
- Go to the Laps & Stints tab, select a driver, and verify their profile header shows the same flag, age, and Wikipedia link.
