# Championship Progression Chart — Design & Plan (2026-07-04)

First Phase 2 feature from `doc/2026-07-04-project-review-and-enhancement-plan.md`.

## Goal

An SVG line chart on the Results tab showing cumulative championship
points per round across the selected season, switchable between Drivers
and Constructors. Reuses the per-round Jolpica standings data that the
standings tables already consume (each round is individually cached, so a
season sweep is cheap after first load).

## Backend: `GET /api/season_progression?year=YYYY`

1. Validate `year` (integer, defaults to current season).
2. Load the season race list (`jolpica_races_{year}.json`, cached).
3. Keep races whose `date` <= today (UTC) — standings only exist for
   completed rounds. Rounds raced today but without published standings
   yet (empty `StandingsLists`) are skipped.
4. Fetch driver + constructor standings for each completed round through
   `get_cached_jolpica_api` under an `asyncio.Semaphore(4)` (Jolpica rate
   limits; `fetch_url` already retries 429s with backoff).
5. Assemble slim series (standings points are already cumulative totals):

```json
{
  "season": "2026",
  "rounds": [{"round": "1", "race_name": "...", "date": "..."}],
  "drivers": [{"id": "russell", "code": "RUS", "name": "George Russell",
               "team": "Mercedes", "points": [25, 51], "positions": [1, 1]}],
  "constructors": [{"id": "mercedes", "name": "Mercedes", "team": "Mercedes",
                    "points": [43, 98], "positions": [1, 1]}]
}
```

- Entrants absent from a round (mid-season swaps) get `null` padding so
  arrays stay aligned with `rounds`.
- Series are sorted by latest points, descending.
- The field is named `team` (not `constructor`) to avoid colliding with
  the JS `Object.prototype.constructor` footgun.
- Upstream failure without cache propagates as the standard 502
  `upstream_error` (Phase 0 semantics); the frontend hides the section.

## Frontend

- **Placement:** new `#progressionWrapper` section on the Results tab
  below the standings tables; same gating as standings
  (`isRaceStandingsSession`), hidden otherwise.
- **Fetch:** in `selectSession` alongside the standings request, but only
  when the cached `state.seasonProgression.season` differs from the
  session year (season data is session-independent).
- **Chart** (`renderChampionshipProgressionChart` in 06-overview-tabs.js):
  - viewBox 900×420, Y = cumulative points (5 gridline ticks),
    X = rounds (labels thinned to ≤ 12).
  - One polyline per entrant, colored via the existing `TEAM_COLORS` map;
    the second entrant of a team gets a dashed stroke to stay
    distinguishable.
  - Point markers carry `<title>` tooltips: name, race, points, position.
  - Top-5 series get an end-of-line label (driver code / team name).
  - Drivers/Constructors toggle buttons re-render from cached state; no
    refetch.

## Implementation notes (post-verification)

Verified in-browser against live 2026 data (8 completed rounds, 22 drivers,
11 constructors): chart, toggle, tooltips, and dashed teammate lines all
render with zero console errors. Two fixes found during verification:

- Jolpica constructor names ("RB F1 Team", "Alpine F1 Team") don't match
  the OpenF1-style `TEAM_COLORS` keys — `getProgressionTeamHex` now strips
  the "F1 Team" suffix and falls back to substring matching before
  defaulting to gray.
- Long constructor end-labels clipped at the right edge — labels drop the
  "F1 Team" suffix and the right padding was widened.

## Tests

`tests/test_season_progression.py`:
- endpoint aggregates mocked Jolpica rounds into cumulative series and
  never requests future rounds;
- mid-season entrant gets `null` padding;
- series sorted by final points; `team` populated from the latest round;
- invalid year → 400;
- static wiring: index.html ids, DOM refs, renderer + toggle wiring,
  dedicated CSS classes.
