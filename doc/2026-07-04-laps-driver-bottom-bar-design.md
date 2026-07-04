# Laps Driver Bottom Bar Design

## Goal

Move the Laps & Stints "Select Driver" control from the left rail to a fixed bottom horizontal bar, matching the Compare tab interaction and giving the lap charts the full available content width.

## Design

The Laps & Stints view becomes a single-column content layout. The driver selector remains inside the Laps tab markup but is styled as a fixed bottom bar with the same placement model as the Compare selector: it spans from the app sidebar edge to the right viewport edge on desktop, then full width below the content on small screens.

Driver buttons become compact horizontal pills with acronym, driver number, and team color dot. The selected driver remains visually active and continues to call `selectDriverForStats(driverNumber)` through the existing event handler. No data-loading behavior changes.

## Files

- `templates/index.html`: rename the selector wrapper to the new bottom-bar class while preserving `id="lapsDriverList"`.
- `static/js/07-driver-grids.js`: emit compact pill markup compatible with horizontal selector styling.
- `static/css/styles.css`: change `.laps-layout`, `.laps-sidebar`, `.driver-pills`, and `.driver-pill` to fixed bottom bar behavior.
- `tests/test_laps_driver_bottom_bar.py`: assert the static wiring and layout contract.

## Edge Cases

- With many drivers, the selector scrolls horizontally instead of increasing content width.
- On mobile, the bar uses the same full-width bottom placement as Compare and the content gains bottom padding so graphs and tables are not hidden.
- Empty and loaded Laps states keep using the same `lapsContent`, `lapsEmpty`, and `lapsData` nodes.

## Testing

Run the focused static test with `.venv/bin/python3`, then run the relevant existing Compare/Laps wiring tests to make sure the shared visual pattern did not regress.
