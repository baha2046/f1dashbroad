import re
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


if __name__ == "__main__":
    unittest.main()
