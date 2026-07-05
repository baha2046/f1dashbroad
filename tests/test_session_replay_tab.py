import json
import re
import subprocess
import textwrap
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


def extract_section(html, section_id):
    """Return the inner HTML of a top-level <section id="..."> tab view."""
    pattern = re.compile(
        r'<section[^>]*id="' + re.escape(section_id) + r'"[^>]*>(.*?)</section>',
        re.DOTALL,
    )
    match = pattern.search(html)
    return match.group(1) if match else None


class SessionReplayTabStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_index_has_session_replay_tab_button(self):
        self.assertIn('id="tab-replay"', self.index_html)
        self.assertIn('data-tab="replay-view"', self.index_html)
        self.assertIn("Session Replay", self.index_html)

    def test_replay_card_lives_in_replay_view_not_circuit_view(self):
        replay_view = extract_section(self.index_html, "replay-view")
        self.assertIsNotNone(replay_view, "replay-view section missing")
        for element_id in (
            'id="replayCard"',
            'id="replayDriverSelect"',
            'id="replayPlayBtn"',
            'id="replayScrubber"',
            'id="replayTimeline"',
            'id="replayMapContent"',
        ):
            self.assertIn(element_id, replay_view)

        circuit_view = extract_section(self.index_html, "circuit-view")
        self.assertIsNotNone(circuit_view, "circuit-view section missing")
        self.assertNotIn('id="replayCard"', circuit_view)
        # The lap dropdown is replaced by the timeline
        self.assertNotIn('id="replayLapSelect"', self.index_html)

    def test_dashboard_js_wires_timeline(self):
        self.assertIn("replayTimeline: document.getElementById('replayTimeline')", self.dashboard_js)
        self.assertIn("function buildReplayTimeline", self.dashboard_js)
        self.assertIn("function seekReplayToTimelineFraction", self.dashboard_js)
        self.assertIn("function advanceReplayToNextLap", self.dashboard_js)
        self.assertIn("function prefetchNextReplayLap", self.dashboard_js)
        self.assertIn("function updateReplayTimelinePlayhead", self.dashboard_js)

    def test_replay_loads_when_replay_tab_is_visible(self):
        # maybeAutoLoadReplay is keyed on the new tab id, and the tab handler
        # triggers it when switching to replay-view
        self.assertIn("state.currentTab !== 'replay-view'", self.dashboard_js)
        self.assertIn("targetTab === 'replay-view'", self.dashboard_js)
        self.assertNotIn("state.currentTab !== 'circuit-view'", self.dashboard_js)

    def test_selection_state_lives_on_state_not_dom(self):
        self.assertIn("state.replay.driverNumber", self.dashboard_js)
        self.assertIn("state.replay.lapNumber", self.dashboard_js)

    def test_styles_contain_timeline_classes(self):
        for css_class in (
            ".replay-timeline",
            ".replay-timeline-segment",
            ".replay-timeline-playhead",
            ".replay-timeline-label",
        ):
            self.assertIn(css_class, self.styles_css)


class ReplayRaceControlTimelineTests(unittest.TestCase):
    """Race-control-derived timeline + circuit state surfaces
    (doc/2026-07-05-replay-race-control-timeline-design.md)."""

    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_replay_view_has_state_chip(self):
        replay_view = extract_section(self.index_html, "replay-view")
        self.assertIsNotNone(replay_view, "replay-view section missing")
        self.assertIn('id="replayStateChip"', replay_view)

    def test_dom_map_wires_state_chip(self):
        self.assertIn("replayStateChip: document.getElementById('replayStateChip')", self.dashboard_js)

    def test_js_defines_circuit_state_helpers(self):
        for snippet in (
            "function extractCircuitStatePeriods",
            "function buildRaceControlTimeline",
            "function stateBandsForRange",
            "function circuitStateAt",
            "function updateReplayCircuitState",
            "function refreshReplayCircuitStates",
            "function getReplayAbsoluteMs",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_js_parses_grounded_race_control_signals(self):
        # Signal strings observed in real OpenF1 race_control payloads
        for signal in (
            "SAFETY CAR DEPLOYED",
            "VSC DEPLOYED",
            "RED FLAG",
            "DOUBLE YELLOW",
            "CHEQUERED",
        ):
            self.assertIn(signal, self.dashboard_js)

    def test_live_refresh_recomputes_circuit_states(self):
        self.assertIn("refreshReplayCircuitStates();", self.dashboard_js)

    def test_styles_contain_state_classes(self):
        for css_class in (
            ".replay-timeline-state",
            ".replay-timeline-base",
            ".replay-timeline-chequered",
            ".replay-state-chip",
            "state-yellow",
            "state-sc",
            "state-vsc",
            "state-red",
            'data-circuit-state',
        ):
            self.assertIn(css_class, self.styles_css)


class FullRaceReplayTests(unittest.TestCase):
    """Driver-less full-race replay mode
    (doc/2026-07-05-full-race-replay-design.md)."""

    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)

    def test_js_defines_full_race_helpers(self):
        for snippet in (
            "const REPLAY_FULL_RACE",
            "function replaySupportsFullRace",
            "function buildFullRaceTimeline",
            "function finalizeReplayTimeline",
            "function fetchAllSessionLaps",
            "function normalizeReplaySelection",
            "function isValidReplaySelection",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_full_race_option_offered_for_race_sessions(self):
        self.assertIn("Full race — whole field", self.dashboard_js)
        self.assertIn("replaySupportsFullRace()", self.dashboard_js)

    def test_full_race_requests_omit_driver_number(self):
        # The backend switches to race-lap windows when driver_number is absent
        self.assertIn("driverNumber === REPLAY_FULL_RACE ? ''", self.dashboard_js)


class ReplayRaceContextTests(unittest.TestCase):
    """Phase 1 race-context surfaces for Session Replay
    (doc/2026-07-05-session-replay-review-and-enhancement-plan.md)."""

    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def _extract_function(self, function_name):
        marker = f"function {function_name}"
        start = self.dashboard_js.find(marker)
        self.assertNotEqual(start, -1, f"{function_name} is missing from dashboard JS")

        body_start = self.dashboard_js.find("{", start)
        self.assertNotEqual(body_start, -1, f"{function_name} has no function body")

        depth = 0
        for index in range(body_start, len(self.dashboard_js)):
            char = self.dashboard_js[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return self.dashboard_js[start:index + 1]

        self.fail(f"{function_name} body was not closed")

    def _run_node(self, script):
        completed = subprocess.run(
            ["node", "-e", script],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        return json.loads(completed.stdout)

    def test_replay_view_has_race_context_surfaces(self):
        replay_view = extract_section(self.index_html, "replay-view")
        self.assertIsNotNone(replay_view, "replay-view section missing")
        for element_id in (
            'id="replayLapChip"',
            'id="replayRaceContext"',
            'id="replayRaceTower"',
            'id="replayTowerBody"',
        ):
            self.assertIn(element_id, replay_view)

    def test_dom_map_wires_race_context_nodes(self):
        for snippet in (
            "replayLapChip: document.getElementById('replayLapChip')",
            "replayRaceContext: document.getElementById('replayRaceContext')",
            "replayRaceTower: document.getElementById('replayRaceTower')",
            "replayTowerBody: document.getElementById('replayTowerBody')",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_js_defines_race_context_helpers(self):
        for snippet in (
            "const REPLAY_CONTEXT_TICK_MS = 250",
            "const REPLAY_INTERVAL_MAX_AGE_MS = 20000",
            "function buildDriverDateIndex",
            "function valueAtMs",
            "function buildReplayRaceOrder",
            "function buildReplayPitWindows",
            "function deriveDriverLapAt",
            "function updateReplayRaceContext",
            "lastContextTickMs",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_speed_reset_sets_toggle_back_to_1x(self):
        self.assertIn("function resetReplaySpeedToggle", self.dashboard_js)
        self.assertIn("resetReplaySpeedToggle();", self.dashboard_js)

    def test_replay_tab_fetches_historical_intervals_once(self):
        for snippet in (
            "function ensureReplayIntervalsLoaded",
            "ensureReplayIntervalsLoaded();",
            "state.replay.intervalsSessionKey",
            "customFetch(`/api/intervals?session_key=${state.selectedSession.session_key}`)",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_timeline_renders_reference_driver_pit_markers(self):
        for snippet in (
            "function appendReplayPitMarkers",
            "replay-timeline-pit-marker",
            "PIT IN",
            "state.replay.driverNumber !== REPLAY_FULL_RACE",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_styles_contain_race_context_classes(self):
        for css_class in (
            ".replay-context-layout",
            ".replay-race-context",
            ".replay-lap-chip",
            ".replay-tower-row",
            ".replay-tower-row.out",
            ".replay-tower-pit",
            ".replay-timeline-pit-marker",
        ):
            self.assertIn(css_class, self.styles_css)

    def test_value_at_ms_returns_latest_and_rejects_stale_records(self):
        helpers = "\n\n".join([
            self._extract_function("buildDriverDateIndex"),
            self._extract_function("valueAtMs"),
        ])
        script = textwrap.dedent(f"""
            {helpers}

            const records = [
                {{ driver_number: 1, position: 2, date: "2026-07-05T10:00:00Z" }},
                {{ driver_number: 1, position: 1, date: "2026-07-05T10:00:10Z" }}
            ];
            const index = buildDriverDateIndex(records);
            const fresh = valueAtMs(index.get(1), Date.parse("2026-07-05T10:00:15Z"), 20000);
            const stale = valueAtMs(index.get(1), Date.parse("2026-07-05T10:00:45Z"), 20000);
            console.log(JSON.stringify([fresh && fresh.position, stale]));
        """)
        self.assertEqual(self._run_node(script), [1, None])

    def test_replay_race_order_seeds_sparse_position_stream(self):
        helpers = "\n\n".join([
            self._extract_function("buildDriverDateIndex"),
            self._extract_function("valueAtMs"),
            self._extract_function("buildReplayRaceOrder"),
        ])
        positions = [
            {"driver_number": 44, "position": 1, "date": "2026-07-05T10:00:00Z"},
            {"driver_number": 1, "position": 2, "date": "2026-07-05T10:00:00Z"},
            {"driver_number": 16, "position": 3, "date": "2026-07-05T10:00:00Z"},
            {"driver_number": 1, "position": 1, "date": "2026-07-05T10:10:00Z"},
            {"driver_number": 44, "position": 2, "date": "2026-07-05T10:10:00Z"},
        ]
        script = textwrap.dedent(f"""
            {helpers}

            const index = buildDriverDateIndex({json.dumps(positions)});
            const order = buildReplayRaceOrder(index, Date.parse("2026-07-05T10:12:00Z"));
            console.log(JSON.stringify(order.map(row => [row.driverNumber, row.position])));
        """)
        self.assertEqual(self._run_node(script), [[1, 1], [44, 2], [16, 3]])

    def test_pit_windows_use_duration_padding_and_lap_fallback(self):
        helpers = "\n\n".join([
            self._extract_function("buildReplayPitWindows"),
            self._extract_function("isDriverInPitAtMs"),
        ])
        script = textwrap.dedent(f"""
            const REPLAY_PIT_WINDOW_PAD_SECONDS = 5;
            {helpers}

            const timeline = {{
                segments: [
                    {{ lapNumber: 12, startMs: Date.parse("2026-07-05T10:20:00Z"), endMs: Date.parse("2026-07-05T10:21:30Z") }}
                ]
            }};
            const windows = buildReplayPitWindows([
                {{
                    driver_number: 1,
                    lap_number: 11,
                    date: "2026-07-05T10:00:10Z",
                    pit_duration: 20
                }},
                {{
                    driver_number: 44,
                    lap_number: 12
                }}
            ], timeline);
            const cases = [
                isDriverInPitAtMs(windows, 1, Date.parse("2026-07-05T10:00:06Z")),
                isDriverInPitAtMs(windows, 1, Date.parse("2026-07-05T10:00:36Z")),
                isDriverInPitAtMs(windows, 44, Date.parse("2026-07-05T10:20:15Z"))
            ];
            console.log(JSON.stringify(cases));
        """)
        self.assertEqual(self._run_node(script), [True, False, True])

    def test_replay_view_has_phase2_context_surfaces(self):
        replay_view = extract_section(self.index_html, "replay-view")
        self.assertIsNotNone(replay_view, "replay-view section missing")
        for element_id in (
            'id="replayRaceControlTicker"',
            'id="replayRaceControlTickerType"',
            'id="replayRaceControlTickerMessage"',
        ):
            self.assertIn(element_id, replay_view)

    def test_dom_map_wires_phase2_context_nodes(self):
        for snippet in (
            "replayRaceControlTicker: document.getElementById('replayRaceControlTicker')",
            "replayRaceControlTickerType: document.getElementById('replayRaceControlTickerType')",
            "replayRaceControlTickerMessage: document.getElementById('replayRaceControlTickerMessage')",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_js_defines_phase2_context_helpers(self):
        for snippet in (
            "const REPLAY_TYRE_COMPOUND_LABELS",
            "function buildReplayStintIndex",
            "function stintForDriverLap",
            "function formatReplayTyreCompound",
            "function isHighSignalReplayRaceControl",
            "function latestReplayRaceControlAt",
            "function updateReplayRaceControlTicker",
            "function highlightReplayDriver",
            "function applyReplayHighlight",
            "function onReplayDriverHighlightClick",
            "highlightedDriverNumber",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_styles_contain_phase2_context_classes(self):
        for css_class in (
            ".replay-tower-tyre",
            ".replay-tower-tyre.compound-soft",
            ".replay-race-control-ticker",
            ".replay-car-group.highlighted",
            ".replay-tower-row.highlighted",
        ):
            self.assertIn(css_class, self.styles_css)

    def test_tower_layout_preserves_driver_code_space(self):
        self.assertIn("grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);", self.styles_css)
        self.assertIn("grid-template-columns: 22px 4px minmax(42px, 1fr) 22px minmax(32px, auto) minmax(58px, auto);", self.styles_css)

    def test_tyre_stint_helper_picks_current_compound_by_driver_lap(self):
        helpers = "\n\n".join([
            self._extract_function("buildReplayStintIndex"),
            self._extract_function("stintForDriverLap"),
        ])
        stints = [
            {"driver_number": 1, "lap_start": 1, "lap_end": 12, "compound": "SOFT"},
            {"driver_number": 1, "lap_start": 13, "lap_end": 42, "compound": "MEDIUM"},
            {"driver_number": 44, "lap_start": 1, "lap_end": 20, "compound": "HARD"},
        ]
        script = textwrap.dedent(f"""
            {helpers}

            const index = buildReplayStintIndex({json.dumps(stints)});
            const medium = stintForDriverLap(index, 1, 15);
            const missingLap = stintForDriverLap(index, 1, null);
            const missingDriver = stintForDriverLap(index, 16, 15);
            console.log(JSON.stringify([
                medium && medium.compound,
                missingLap,
                missingDriver
            ]));
        """)
        self.assertEqual(self._run_node(script), ["MEDIUM", None, None])

    def test_race_control_ticker_filters_to_high_signal_latest_message(self):
        helpers = "\n\n".join([
            self._extract_function("getRaceControlType"),
            self._extract_function("normalizeReplayDriverSet"),
            self._extract_function("raceControlRecordMentionsShownDriver"),
            self._extract_function("isHighSignalReplayRaceControl"),
            self._extract_function("latestReplayRaceControlAt"),
        ])
        records = [
            {
                "date": "2026-07-05T10:00:05Z",
                "category": "Timing",
                "message": "LAP TIME DELETED - CAR 1",
            },
            {
                "date": "2026-07-05T10:00:10Z",
                "category": "Flag",
                "flag": "YELLOW",
                "message": "YELLOW FLAG",
            },
            {
                "date": "2026-07-05T10:00:15Z",
                "category": "Other",
                "driver_number": 99,
                "message": "PENALTY - CAR 99",
            },
            {
                "date": "2026-07-05T10:00:20Z",
                "category": "Other",
                "driver_number": 44,
                "message": "INCIDENT INVOLVING CAR 44 (HAM) INVESTIGATED",
            },
            {
                "date": "2026-07-05T10:00:25Z",
                "category": "Other",
                "message": "NOTE - ADMIN MESSAGE",
            },
        ]
        script = textwrap.dedent(f"""
            {helpers}

            const records = {json.dumps(records)};
            const shown = new Set([1, 44]);
            const at17 = latestReplayRaceControlAt(records, Date.parse("2026-07-05T10:00:17Z"), shown);
            const at25 = latestReplayRaceControlAt(records, Date.parse("2026-07-05T10:00:25Z"), shown);
            const before = latestReplayRaceControlAt(records, Date.parse("2026-07-05T10:00:02Z"), shown);
            console.log(JSON.stringify([
                at17 && at17.flag,
                at25 && at25.driver_number,
                before
            ]));
        """)
        self.assertEqual(self._run_node(script), ["YELLOW", 44, None])

    def test_highlight_driver_does_not_switch_reference_driver(self):
        body = self._extract_function("highlightReplayDriver")
        self.assertIn("state.replay.highlightedDriverNumber", body)
        self.assertNotIn("state.replay.driverNumber =", body)
        self.assertNotIn("loadTrackReplay(", body)
        self.assertNotIn("setupReplayTimeline(", body)


if __name__ == "__main__":
    unittest.main()
