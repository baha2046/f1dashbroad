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


class ReplayKeyboardShortcutTests(unittest.TestCase):
    """Phase 3 replay interaction polish
    (doc/2026-07-05-session-replay-review-and-enhancement-plan.md)."""

    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(self.root)

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

    def test_keyboard_shortcut_handler_is_wired_on_document(self):
        self.assertIn("document.addEventListener('keydown', onReplayKeyboardShortcut);", self.dashboard_js)

    def test_keyboard_shortcuts_are_gated_to_replay_tab_and_non_form_focus(self):
        body = self._extract_function("onReplayKeyboardShortcut")
        self.assertIn("state.currentTab !== 'replay-view'", body)
        self.assertIn("isReplayKeyboardShortcutTarget(event.target)", body)
        self.assertIn("event.preventDefault();", body)

        focus_guard = self._extract_function("isReplayKeyboardShortcutTarget")
        for tag_name in ("INPUT", "SELECT", "TEXTAREA"):
            self.assertIn(tag_name, focus_guard)
        self.assertIn("isContentEditable", focus_guard)

    def test_keyboard_shortcuts_map_expected_replay_actions(self):
        body = self._extract_function("onReplayKeyboardShortcut")
        for snippet in (
            "event.code === 'Space'",
            "toggleReplayPlayback();",
            "event.key === 'ArrowLeft'",
            "seekReplayBySeconds(-REPLAY_KEYBOARD_SEEK_SECONDS);",
            "event.key === 'ArrowRight'",
            "seekReplayBySeconds(REPLAY_KEYBOARD_SEEK_SECONDS);",
            "event.key === 'ArrowUp'",
            "selectAdjacentReplayLap(-1);",
            "event.key === 'ArrowDown'",
            "selectAdjacentReplayLap(1);",
        ):
            self.assertIn(snippet, body)

    def test_keyboard_seek_uses_timeline_boundary_machinery(self):
        for snippet in (
            "const REPLAY_KEYBOARD_SEEK_SECONDS = 5",
            "function getPreviousTimelineSegment",
            "function seekReplayBySeconds",
            "advanceReplayToNextLap(leftover);",
            "seekReplayToTimelineFraction",
            "renderReplayFrame(Math.max(0, Math.min(targetT, windowSeconds)));",
            "function selectAdjacentReplayLap",
        ):
            self.assertIn(snippet, self.dashboard_js)


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
            "function extractCircuitStatePeriodsFromStatus",
            "function getReplayCircuitStates",
            "function buildRaceControlTimeline",
            "function stateBandsForRange",
            "function circuitStateAt",
            "function updateReplayCircuitState",
            "function refreshReplayCircuitStates",
            "function getReplayAbsoluteMs",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_js_prefers_session_status_series_for_circuit_states(self):
        # SessionData StatusSeries is the authoritative source; the session
        # loader and live refresh both fetch it, and the replay consumes it
        # ahead of race-control text parsing.
        self.assertIn("/api/session_status?session_key=${session.session_key}", self.dashboard_js)
        self.assertIn("/api/session_status?session_key=${sessionKey}", self.dashboard_js)
        self.assertIn("extractCircuitStatePeriodsFromStatus(state.sessionStatusSeries)", self.dashboard_js)
        for status in ("'YELLOW'", "'SCDEPLOYED'", "'VSCDEPLOYED'", "'RED'"):
            self.assertIn(status, self.dashboard_js)
        self.assertNotIn("states: extractCircuitStatePeriods(state.raceControl)", self.dashboard_js)

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


class FullQualifyingReplayTests(unittest.TestCase):
    """Driver-less full-qualifying replay mode + Q1/Q2/Q3 region labels
    (doc/2026-07-07-full-qualifying-replay-design.md)."""

    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
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

    def test_js_defines_full_session_helpers(self):
        for snippet in (
            "const REPLAY_FULL_SESSION",
            "const REPLAY_SESSION_SLICE_SECONDS",
            "function replaySupportsFullSession",
            "function isReplayWholeFieldSelection",
            "function qualifyingPhasePrefix",
            "function extractQualifyingPhases",
            "function annotateQualifyingPhases",
            "function buildFullSessionTimeline",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_full_session_option_offered_for_qualifying_sessions(self):
        self.assertIn("Full qualifying — whole field", self.dashboard_js)
        self.assertIn("replaySupportsFullSession()", self.dashboard_js)

    def test_full_session_requests_use_explicit_windows(self):
        # The backend serves an explicit start/end window when lap-derived
        # windows are meaningless (quali lap numbers are per-driver)
        self.assertIn("session_key=${sessionKey}&start=${start}&end=${end}", self.dashboard_js)

    def test_timeline_renders_phase_region_labels(self):
        self.assertIn("replay-timeline-label phase", self.dashboard_js)
        self.assertIn("phase-start", self.dashboard_js)
        self.assertIn("annotateQualifyingPhases(segments);", self.dashboard_js)

    def test_styles_contain_phase_classes(self):
        for css_class in (
            ".replay-timeline-segment.phase-start",
            ".replay-timeline-label.phase",
        ):
            self.assertIn(css_class, self.styles_css)

    def test_extract_qualifying_phases_spans_red_flag_pauses(self):
        helpers = "\n\n".join([
            self._extract_function("qualifyingPhasePrefix"),
            self._extract_function("extractQualifyingPhases"),
        ])
        status_rows = [
            {"session_status": "Started", "date": "2026-07-04T14:00:00Z"},
            {"session_status": None, "track_status": "Yellow", "date": "2026-07-04T14:05:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T14:18:00Z"},
            {"session_status": "Started", "date": "2026-07-04T14:25:00Z"},
            # Red flag: Aborted pauses Q2, the next Started resumes it
            {"session_status": "Aborted", "date": "2026-07-04T14:30:00Z"},
            {"session_status": "Started", "date": "2026-07-04T14:40:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T14:50:00Z"},
            {"session_status": "Started", "date": "2026-07-04T14:58:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T15:10:00Z"},
            {"session_status": "Finalised", "date": "2026-07-04T15:12:00Z"},
        ]
        script = textwrap.dedent(f"""
            const state = {{
                sessionStatusSeries: {json.dumps(status_rows)},
                selectedSession: {{ session_name: "Qualifying", session_type: "Qualifying" }}
            }};
            function getRaceControlRangeMs() {{ return null; }}
            {helpers}

            const phases = extractQualifyingPhases();
            console.log(JSON.stringify(phases.map(p => [
                p.label,
                new Date(p.startMs).toISOString(),
                new Date(p.endMs).toISOString()
            ])));
        """)
        self.assertEqual(self._run_node(script), [
            ["Q1", "2026-07-04T14:00:00.000Z", "2026-07-04T14:18:00.000Z"],
            ["Q2", "2026-07-04T14:25:00.000Z", "2026-07-04T14:50:00.000Z"],
            ["Q3", "2026-07-04T14:58:00.000Z", "2026-07-04T15:10:00.000Z"],
        ])

    def test_chequered_flag_is_the_last_finished_not_the_first(self):
        # Each quali segment waves its own chequered flag; the session's flag
        # is the last one, and a Started in between clears the earlier one so
        # Q2/Q3 replay as green, not "Finished"
        body = self._extract_function("extractCircuitStatePeriodsFromStatus")
        status_rows = [
            {"session_status": "Started", "date": "2026-07-04T14:00:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T14:18:00Z"},
            {"session_status": "Started", "date": "2026-07-04T14:25:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T14:40:00Z"},
            {"session_status": "Finalised", "date": "2026-07-04T14:45:00Z"},
        ]
        script = textwrap.dedent(f"""
            const REPLAY_TRACK_STATUS_TYPES = {{}};
            const REPLAY_PERIOD_LABELS = {{}};
            function mergeYellowPeriods(periods) {{ return periods; }}
            {body}

            const midQ2 = extractCircuitStatePeriodsFromStatus(
                {json.dumps(status_rows[:3])}
            );
            const finished = extractCircuitStatePeriodsFromStatus({json.dumps(status_rows)});
            console.log(JSON.stringify([
                midQ2.chequeredMs,
                new Date(finished.chequeredMs).toISOString()
            ]));
        """)
        self.assertEqual(
            self._run_node(script),
            [None, "2026-07-04T14:40:00.000Z"],
        )

    def test_full_session_timeline_slices_phases_and_labels_regions(self):
        helpers = "\n\n".join([
            self._extract_function("qualifyingPhasePrefix"),
            self._extract_function("extractQualifyingPhases"),
            self._extract_function("annotateQualifyingPhases"),
            self._extract_function("finalizeReplayTimeline"),
            self._extract_function("buildFullSessionTimeline"),
        ])
        status_rows = [
            {"session_status": "Started", "date": "2026-07-04T14:00:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T14:18:00Z"},  # Q1: 18 min -> 9 slices
            {"session_status": "Started", "date": "2026-07-04T14:25:00Z"},
            {"session_status": "Finished", "date": "2026-07-04T14:35:00Z"},  # Q2: 10 min -> 5 slices
        ]
        script = textwrap.dedent(f"""
            const REPLAY_TIMELINE_WIDTH_CAP = 3;
            const REPLAY_SESSION_SLICE_SECONDS = 120;
            const state = {{
                sessionStatusSeries: {json.dumps(status_rows)},
                selectedSession: {{ session_name: "Qualifying", session_type: "Qualifying" }}
            }};
            function getRaceControlRangeMs() {{ return null; }}
            function getReplayCircuitStates() {{ return {{ periods: [], chequeredMs: null }}; }}
            function isQualifyingSession() {{ return true; }}
            {helpers}

            const timeline = buildFullSessionTimeline();
            const summary = timeline.segments.map(seg => [
                seg.lapNumber, seg.phase, seg.phaseStart, seg.seconds
            ]);
            console.log(JSON.stringify([
                timeline.segments.length,
                summary[0],
                summary[1],
                summary[9],
                summary[13]
            ]));
        """)
        self.assertEqual(self._run_node(script), [
            14,
            [1, "Q1", True, 120],
            [2, "Q1", False, 120],
            [10, "Q2", True, 120],
            [14, "Q2", False, 120],
        ])


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
            "function replayGapValueAtMs",
            "function isReplayDriverRetiredAtMs",
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
            "isReplayWholeFieldSelection(state.replay.driverNumber)",
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

    def test_replay_gap_lookup_keeps_last_real_gap_through_empty_snapshots(self):
        helpers = "\n\n".join([
            self._extract_function("buildDriverDateIndex"),
            self._extract_function("valueAtMs"),
            self._extract_function("hasReplayGapValue"),
            self._extract_function("replayGapValueAtMs"),
        ])
        intervals = [
            {"driver_number": 44, "gap_to_leader": 1.234, "date": "2026-07-05T10:00:00Z"},
            {"driver_number": 44, "gap_to_leader": None, "date": "2026-07-05T10:00:10Z"},
            {"driver_number": 44, "gap_to_leader": "", "date": "2026-07-05T10:00:20Z"},
            {"driver_number": 44, "gap_to_leader": 0.987, "date": "2026-07-05T10:00:30Z"},
        ]
        script = textwrap.dedent(f"""
            {helpers}

            const index = buildDriverDateIndex({json.dumps(intervals)});
            const records = index.get(44);
            const gaps = [
                replayGapValueAtMs(records, Date.parse("2026-07-05T10:00:05Z"), 20000),
                replayGapValueAtMs(records, Date.parse("2026-07-05T10:00:15Z"), 20000),
                replayGapValueAtMs(records, Date.parse("2026-07-05T10:00:25Z"), 20000),
                replayGapValueAtMs(records, Date.parse("2026-07-05T10:00:35Z"), 20000)
            ];
            console.log(JSON.stringify(gaps));
        """)
        self.assertEqual(self._run_node(script), [1.234, 1.234, 1.234, 0.987])

    def test_replay_retired_status_waits_until_driver_has_no_future_positions(self):
        helpers = "\n\n".join([
            self._extract_function("buildDriverDateIndex"),
            self._extract_function("isReplayDriverRetiredAtMs"),
        ])
        positions = [
            {"driver_number": 23, "position": 21, "date": "2026-07-05T10:00:00Z"},
            {"driver_number": 23, "position": 21, "date": "2026-07-05T10:00:20Z"},
            {"driver_number": 3, "position": 20, "date": "2026-07-05T10:00:00Z"},
        ]
        script = textwrap.dedent(f"""
            const state = {{
                results: [
                    {{ driver_number: 23, dnf: true, status: "Retired" }},
                    {{ driver_number: 3, dnf: false, status: "Stopped" }}
                ]
            }};
            {helpers}

            const positionIndex = buildDriverDateIndex({json.dumps(positions)});
            const checks = [
                isReplayDriverRetiredAtMs(23, Date.parse("2026-07-05T10:00:10Z"), positionIndex.get(23)),
                isReplayDriverRetiredAtMs(23, Date.parse("2026-07-05T10:00:30Z"), positionIndex.get(23)),
                isReplayDriverRetiredAtMs(3, Date.parse("2026-07-05T10:00:30Z"), positionIndex.get(3)),
                isReplayDriverRetiredAtMs(99, Date.parse("2026-07-05T10:00:30Z"), [])
            ];
            console.log(JSON.stringify(checks));
        """)
        self.assertEqual(self._run_node(script), [False, True, False, False])

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
                isDriverInPitAtMs(windows, 1, Date.parse("2026-07-05T09:59:50Z")),
                isDriverInPitAtMs(windows, 1, Date.parse("2026-07-05T10:00:06Z")),
                isDriverInPitAtMs(windows, 1, Date.parse("2026-07-05T10:00:20Z")),
                isDriverInPitAtMs(windows, 1, Date.parse("2026-07-05T10:00:36Z")),
                isDriverInPitAtMs(windows, 44, Date.parse("2026-07-05T10:20:15Z"))
            ];
            console.log(JSON.stringify(cases));
        """)
        # Pit `date` (10:00:10) is the pit-lane exit: the 20s lane transit plus
        # 5s pad runs backwards from it, so the window is 09:59:45 - 10:00:15.
        self.assertEqual(self._run_node(script), [True, True, False, False, True])

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


class ReplayDeferredEnhancementTests(unittest.TestCase):
    """Formerly-deferred plan items implemented 2026-07-06: row-flash
    position-change animation and the reference-driver telemetry strip
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

        # Skip the parameter list first: default params like `options = {}`
        # would otherwise terminate the brace scan immediately
        params_start = self.dashboard_js.find("(", start)
        self.assertNotEqual(params_start, -1, f"{function_name} has no parameter list")
        paren_depth = 0
        params_end = -1
        for index in range(params_start, len(self.dashboard_js)):
            char = self.dashboard_js[index]
            if char == "(":
                paren_depth += 1
            elif char == ")":
                paren_depth -= 1
                if paren_depth == 0:
                    params_end = index
                    break
        self.assertNotEqual(params_end, -1, f"{function_name} parameter list was not closed")

        body_start = self.dashboard_js.find("{", params_end)
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

    def test_replay_view_has_telemetry_strip_surfaces(self):
        replay_view = extract_section(self.index_html, "replay-view")
        self.assertIsNotNone(replay_view, "replay-view section missing")
        for element_id in (
            'id="replayTelemetryStrip"',
            'id="replayTelemetryDriver"',
            'id="replayTelemetrySpeed"',
            'id="replayTelemetryGear"',
            'id="replayTelemetryDrs"',
        ):
            self.assertIn(element_id, replay_view)

    def test_dom_map_wires_telemetry_strip_nodes(self):
        for snippet in (
            "replayTelemetryStrip: document.getElementById('replayTelemetryStrip')",
            "replayTelemetryDriver: document.getElementById('replayTelemetryDriver')",
            "replayTelemetrySpeed: document.getElementById('replayTelemetrySpeed')",
            "replayTelemetryGear: document.getElementById('replayTelemetryGear')",
            "replayTelemetryDrs: document.getElementById('replayTelemetryDrs')",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_js_defines_deferred_enhancement_helpers(self):
        for snippet in (
            "const REPLAY_ROW_FLASH_MAX_JUMP_MS = 5000",
            "const REPLAY_TELEMETRY_MAX_GAP_SECONDS = 4",
            "function replayPositionFlashClass",
            "function applyReplayRowFlash",
            "function replayTelemetryAtT",
            "function formatReplayGear",
            "function fetchReplayTelemetryPayload",
            "function ensureReplayTelemetryLoaded",
            "function updateReplayTelemetryStrip",
            "function clearReplayTelemetryStrip",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_row_flash_is_jump_guarded_and_tied_to_context_tick(self):
        body = self._extract_function("updateReplayRaceContext")
        self.assertIn("REPLAY_ROW_FLASH_MAX_JUMP_MS", body)
        self.assertIn("applyReplayRowFlash(", body)
        self.assertIn("lastContextAbsMs", body)

    def test_telemetry_strip_updates_from_frame_loop_and_scene_load(self):
        frame_body = self._extract_function("renderReplayFrame")
        self.assertIn("updateReplayTelemetryStrip();", frame_body)

        scene_body = self._extract_function("buildReplayScene")
        self.assertIn("ensureReplayTelemetryLoaded();", scene_body)

        prefetch_body = self._extract_function("prefetchNextReplayLap")
        self.assertIn("fetchReplayTelemetryPayload(", prefetch_body)

    def test_telemetry_strip_is_hidden_in_whole_field_modes(self):
        body = self._extract_function("updateReplayTelemetryStrip")
        self.assertIn("!isReplayWholeFieldSelection(state.replay.driverNumber)", body)
        self.assertIn("hidden = true", body)

    def test_telemetry_fetch_reuses_laps_tab_cache(self):
        body = self._extract_function("fetchReplayTelemetryPayload")
        self.assertIn("state.telemetryCache[cacheKey]", body)
        self.assertIn("/api/car_telemetry?session_key=", body)

    def test_styles_contain_deferred_enhancement_classes(self):
        for css_class in (
            ".replay-tower-row.flash-up",
            ".replay-tower-row.flash-down",
            "@keyframes replay-row-flash-up",
            "@keyframes replay-row-flash-down",
            ".replay-telemetry-strip",
            ".replay-telemetry-drs.active",
        ):
            self.assertIn(css_class, self.styles_css)

    def test_position_flash_class_maps_gains_and_losses(self):
        helper = self._extract_function("replayPositionFlashClass")
        script = textwrap.dedent(f"""
            {helper}

            console.log(JSON.stringify([
                replayPositionFlashClass(5, 3),
                replayPositionFlashClass(3, 5),
                replayPositionFlashClass(4, 4),
                replayPositionFlashClass(undefined, 4),
                replayPositionFlashClass(4, null)
            ]));
        """)
        self.assertEqual(
            self._run_node(script),
            ["flash-up", "flash-down", None, None, None],
        )

    def test_telemetry_lookup_picks_latest_sample_and_rejects_gaps(self):
        helper = self._extract_function("replayTelemetryAtT")
        script = textwrap.dedent(f"""
            const REPLAY_TELEMETRY_MAX_GAP_SECONDS = 4;
            {helper}

            const samples = [
                {{ t: 0.5, speed: 280, gear: 7, drs: 12 }},
                {{ t: 1.0, speed: 300, gear: 8, drs: 12 }},
                {{ t: 10.0, speed: 120, gear: 3, drs: 1 }}
            ];
            console.log(JSON.stringify([
                replayTelemetryAtT(samples, 1.2) && replayTelemetryAtT(samples, 1.2).speed,
                replayTelemetryAtT(samples, 8.0),
                replayTelemetryAtT(samples, 0.1) && replayTelemetryAtT(samples, 0.1).speed,
                replayTelemetryAtT([{{ t: 9.0, speed: 200 }}], 0),
                replayTelemetryAtT([], 1.0)
            ]));
        """)
        self.assertEqual(self._run_node(script), [300, None, 280, None, None])

    def test_gear_formatter_handles_neutral_and_missing(self):
        helper = self._extract_function("formatReplayGear")
        script = textwrap.dedent(f"""
            {helper}

            console.log(JSON.stringify([
                formatReplayGear(7),
                formatReplayGear(0),
                formatReplayGear(null),
                formatReplayGear("3")
            ]));
        """)
        self.assertEqual(self._run_node(script), ["7", "N", "—", "3"])


if __name__ == "__main__":
    unittest.main()
