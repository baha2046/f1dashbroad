# Phase 0 — Correctness Implementation Notes (2026-07-07)

Implements Phase 0 of doc/2026-07-07-project-review-and-enhancement-plan.md.
Suite: 258 tests passing (was 248 with 2 failures).

## 1. Qualifying-phase cooldown (restored green)

The +3-minute phase-end extension from 4961ad2 is now the named constant
`REPLAY_PHASE_COOLDOWN_MS` (static/js/10-track-replay.js). It applies to
phases closed by `Finished`; a live still-open phase runs to the latest known
session time and gets no cooldown (there is no chequered flag to cool down
from). Both full-qualifying replay tests updated to the cooldown contract,
with fixtures chosen so slice durations stay whole (15 min + 3 min → 9×120 s).

## 2. Interval rows no longer erase gaps

`normalize_livetiming_intervals` (livetiming_compat.py) only emits a row when
the TimingData delta actually touches `IntervalToPositionAhead.Value` or
`GapToLeader`, and carries the last known value of the other field forward
per driver. Previously every delta produced a row, so a position-only delta
emitted `interval: null` that latest-row-per-driver consumers (live timing
table, replay context) took as the current gap. The leader's explicit
empty-string gap still produces a row (regression-covered in
tests/test_livetiming_compat.py).

## 3. Stale-response guards on session switching

- `selectSession()` (05-session-load.js): monotonic `sessionLoadSequence`
  token. All response bodies are parsed first, then a single staleness check
  gates the state writes — writes are synchronous after the check, so an
  older load can never interleave with a newer one. A stale load's failure
  also no longer tears down the newer view (guard in catch).
- `loadSessions()` (04-sessions-sidebar.js): same pattern with
  `sessionsListSequence` guarding `state.sessions` and the error panel.
- Wiring covered by tests/test_session_load_guards.py.

## 4. Official points/DNS/DSQ on race results

`/api/results` left the generic endpoint factory (`RESULTS_ENDPOINT_CONFIG`
keeps the same feed + `results_v2` cache contract) for a bespoke handler that
merges Jolpica's official classification into the Livetiming rows for
Race/Sprint sessions (`enrich_results_with_jolpica` + `merge_jolpica_results`
in app.py):

- round resolved by session date via the cached Jolpica races index;
  `/results` vs `/sprint` chosen by session name
- `points` from Jolpica; `dnf` = positionText `R`, `dsq` = `D`/`E`,
  `dns` = `W` or status "Did not start"; status text passed through
- best-effort: rows are returned unchanged when the session isn't a
  Race/Sprint, the round isn't found, results aren't published yet, or
  Jolpica errors — so live sessions keep working and the enrichment appears
  once official results publish (Jolpica cache TTL: 1 h current year)
- merging happens post-cache at response time, so `results_v2_*.json` files
  cached before results publication are not frozen without points

Tests: tests/test_results_enrichment.py (merge mapping, sprint endpoint
selection, non-race passthrough, missing-results and upstream-error
passthrough). Verified in-browser against live 2026 data: Silverstone GP
results show 25/18/15… points and DNF flags.
