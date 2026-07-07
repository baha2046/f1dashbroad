# Phase 2 — Hardening Implementation Notes (2026-07-08)

Implements Phase 2 of doc/2026-07-07-project-review-and-enhancement-plan.md.
Suite: 272 tests passing. The mechanical escaping sweep was executed by
gpt-5.5 (Codex) against a fixed spec; structural pieces, helpers, backend
changes and verification are first-party.

## 1. Systematic HTML escaping + CSP

- New helpers (static/js/01-state-helpers.js): `safeUrl()` — only absolute
  http(s) URLs reach `href`/`src`, everything else (javascript:, data:,
  malformed) renders empty; `getDriverTeamHex()` now validates hex before it
  lands in style attributes.
- Every upstream-derived interpolation in the innerHTML templates of
  04-sessions-sidebar, 05-session-load, 06-overview-tabs, 07-driver-grids,
  08-compare-charts, 09-laps-tab, 10-track-replay, 11-live-mode is wrapped in
  `escapeHtml()` (attribute contexts included) or `safeUrl()`. Numeric /
  formatter-controlled outputs stay unescaped. ~50 interpolations hardened.
- Inline handlers removed everywhere (`onerror` image fallbacks ×5, retry
  `onclick`): a delegated capture-phase `error` listener in 03-api-settings
  swaps broken driver/track images; the retry button binds after render.
  This is what allows a strict `script-src 'self'`.
- `Content-Security-Policy` + `X-Content-Type-Options: nosniff` on HTML
  responses (app.py): `default-src 'self'`, strict script-src, style-src
  allows inline styles + Google Fonts, img-src any https (F1 media CDN),
  media-src livetiming.formula1.com (team radio), connect-src 'self'.
- Verified in-browser with CSP enforced: all tabs render, zero console
  violations, and an injected-driver canary (`<script>` names,
  `javascript:` URLs, CSS-injection team colour) renders inert — no
  execution, empty src, fallback colour.

## 2. Delta normalizer robustness (livetiming_compat.py)

`iter_timing_lines` skips non-numeric line keys (`_deleted` markers) and
non-dict lines; race-control messages, team-radio captures, weather payloads,
driver-list entries and stint collections all gained isinstance/to_int guards.
Covered by `test_normalizers_survive_deletion_markers_and_malformed_entries`.

## 3. Logging + periodic eviction (app.py)

- `logging.basicConfig` + `logging.getLogger("f1_dashboard")`; every `print`
  replaced (errors → `warning`, cache stats → `info`), so the systemd journal
  is level-filterable.
- Cache eviction now also runs hourly via a background task started in
  `before_serving` and cancelled in `after_serving`
  (`CACHE_EVICTION_INTERVAL_SECONDS = 3600`) — a live weekend generating
  replay-window and raw-feed files no longer overshoots the size cap on a
  long-running server.

## Tests

New tests/test_phase2_hardening.py: no `print(` in backend modules, CSP +
nosniff on `/` (and absent on `/api/*`), maintenance-task lifecycle, and a
repo-wide ban on inline `onerror=`/`onclick=` in templates and JS.
