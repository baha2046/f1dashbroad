# Circuit tab redesign implementation

## Outcome

The Circuit tab is now a map-first track profile instead of a vertical metadata list. It combines circuit identity, event timing, circuit geometry, session timing data, and interactive exploration in one responsive dashboard.

## Implemented surfaces

- Circuit hero with event name, venue, country, round, and event window.
- Interactive SVG map with selectable marshal-sector and corner layers.
- Hover, focus, click, Enter, and Space interactions for map features.
- Start/finish marker, north indicator, track legend, and live feature inspector.
- Track-DNA summary for corner count, marshal-sector count, and direction.
- Lazy-loaded S1, S2, and S3 session benchmarks with driver and lap attribution.
- Local-context cards for circuit type and timezone.
- Container-query layouts for wide, medium, and mobile tab widths.
- Reduced-motion handling and inactive-layer accessibility guards.

## Data grounding

- Track outline, corners, and marshal sectors use the existing MultiViewer circuit payload returned by `/api/meetings`.
- Sector benchmarks use `duration_sector_1`, `duration_sector_2`, and `duration_sector_3` from `/api/laps` and are loaded only when the Circuit tab needs them.
- Session-load guards prevent an older lap request from replacing timing data after the user selects another session.

## Verification

- JavaScript syntax checked with `node --check` for every file in `static/js`.
- Full test suite: 331 tests passing.
- Browser checks completed at desktop and 390 × 844 mobile widths.
- Layer switching, feature selection, benchmark rendering, responsive reflow, and inactive-layer accessibility verified in the running app.
