# Phase 0 Hardening — Implementation Note (2026-07-04)

Implements Phase 0 of `doc/2026-07-04-project-review-and-enhancement-plan.md`.
Backend-only hardening plus one small frontend change; no feature changes.

## Changes in `app.py`

1. **Query-param validation (path-traversal fix).** All identifier params
   (`session_key`, `driver_number`, `meeting_key`, `year`, `season`,
   `round`) are parsed with `parse_int_param()` and rejected with 400 when
   non-integer. `date` on `/api/race_standings` must match `YYYY-MM-DD`.
   Previously these values were interpolated raw into cache file paths and
   upstream URLs.
2. **Shared HTTP client.** One lazily created `httpx.AsyncClient`
   (`get_http_client()`) replaces the per-request clients; closed in
   `after_serving`. The OpenF1 key is now sent only as
   `Authorization: Bearer`, not sprayed across four header names.
3. **Atomic cache writes.** `write_cache()` writes to a tempfile in
   `data_cache/` and `os.replace()`s it into place, so a crash mid-write
   can no longer leave a truncated JSON file.
4. **Async cache I/O.** All cache file reads/writes and the
   `find_session_year` directory scan run via `asyncio.to_thread`, keeping
   the event loop unblocked.
5. **Cache-stampede protection.** Per-cache-file `asyncio.Lock`
   (`get_cache_lock()`, scoped per event loop): concurrent misses on the
   same key result in a single upstream fetch; waiters read the fresh cache.
6. **Upstream failures are surfaced.** When a fetch fails and no stale
   cache exists, `get_cached_api` / `get_cached_jolpica_api` raise
   `UpstreamAPIError` → HTTP 502 `{"error": "upstream_error"}` instead of
   silently returning `[]`/`{}`. Stale-cache fallback behavior is unchanged.
7. **Latent bug fix in `fetch_url`.** The `raise OpenF1AuthError` sat
   inside its own `except Exception: pass` block, so the 401/403
   live-restriction error was swallowed server-side and never reached the
   client as `live_session_restriction`. It now propagates correctly
   (regression test added).
8. **Season year derived from the clock.** `current_season_year()` replaces
   all hardcoded `2026` values (defaults, `is_historical`, TTL selection),
   so cache semantics roll over correctly in future seasons.
9. **Debug gate.** `app.run(debug=...)` is controlled by
   `F1_DASHBOARD_DEBUG` (defaults to `1` for local dev).

## Changes in `static/js/dashboard.js`

- `customFetch` now recognizes 502/503 `upstream_error` responses and shows
  the existing restriction banner with the failure detail. Known limitation
  (pre-existing pattern): a subsequent OK response hides the banner, so a
  partial outage may only flash it.

## Behavior changes visible to the API consumer

- Invalid params → 400 (previously either 400 for missing only, or raw
  interpolation).
- Total upstream failure with no cache → 502 (previously 200 with `[]`).
  All frontend consumers already guard with `response.ok` /
  `Array.isArray`, so the UI degrades to empty sections plus the banner.
- 400 message changed to `"<param> is required and must be an integer"`
  (two existing tests updated).

## Tests

- New: `tests/test_phase0_hardening.py` — traversal/format rejection across
  all routes, 502 on uncached upstream failure, stale-cache fallback,
  atomic write leaves no temp files, concurrent requests share one fetch,
  dynamic season year, frontend banner wiring.
- Updated: `tests/test_openf1_retry.py` (shared-client seam + new 403 auth
  propagation test), expected 400 message in `test_pit_annotations.py` and
  `test_compare_position_chart.py`.
- Suite: 60 tests, all passing. Smoke-tested the live server: cached
  endpoints 200, traversal 400, Jolpica standings served from cache.
