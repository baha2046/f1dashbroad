# Pit Lap Annotations Design

## Goal

Use OpenF1 pit-stop data to clearly mark pit-in laps and the following pit-out laps in Race and Sprint lap timing views.

## Approved Approach

Fetch pit data once per selected session with a cached backend proxy to `https://api.openf1.org/v1/pit?session_key=...`. The frontend stores the session-level pit records in `state.pitStops` only when the selected session is a Race or Sprint. Other session types leave pit annotations empty even if lap data is loaded.

## UI

- The single-driver Lap Time Progression chart shows vertical pit-in and pit-out guides for the selected driver.
- Chart point tooltips include exact pit status when a lap is a pit-in or pit-out lap.
- The All Lap Times table adds a Pit column with compact `Pit in` and `Pit out` badges.
- Pit-in and pit-out rows receive subtle row styling so they remain visible while scanning.
- Compare chart points also expose pit status in their tooltips and point styling, using the same pit annotation helper.

## Data Flow

- Add `/api/pit?session_key=...` to the Quart app and cache responses as `pit_<session_key>.json`.
- Add `isPitAnnotationSession(session)` so Race and Sprint are the only session types that request pit data.
- Add `getLapPitAnnotation(driverNumber, lapNumber)` as the single frontend source for pit-in and pit-out classification.
- Treat `pit.lap_number` as the pit-in lap and `pit.lap_number + 1` as the pit-out lap.

## Error Handling

- Missing or failed pit data leaves the charts and table usable with no pit badges.
- Invalid pit records are ignored by the annotation helper.
- Multiple pit records on a lap render as a combined annotation rather than breaking the UI.

## Testing

- Add backend tests for the cached `/api/pit` endpoint.
- Add static wiring tests for Race/Sprint gating, frontend pit state/helpers, table markup, and styles.
- Run the full unittest suite with `.venv/bin/python3`.
