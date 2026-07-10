"""Marshal-sector yellow highlights on the Session Replay track map.

Race control reports sector-scope yellows ("YELLOW IN TRACK SECTOR 8"); the
MultiViewer circuit_info carries the marshal-sector geometry. The replay map
splits the track outline into per-sector segments with numbered badges and
lights the sectors that are yellow at the playhead time.
"""
import json
import subprocess
import textwrap
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class ReplaySectorYellowTests(unittest.TestCase):
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

    def test_js_defines_sector_helpers(self):
        for snippet in (
            "function extractSectorYellowPeriods",
            "function buildMarshalSectorSegments",
            "function activeSectorYellowsAt",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_circuit_states_carry_sector_yellows(self):
        # Both circuit-state sources attach the race-control sector yellows
        self.assertIn("const sectorYellows = extractSectorYellowPeriods(state.raceControl)", self.dashboard_js)
        self.assertIn("{ ...fromStatus, sectorYellows }", self.dashboard_js)
        self.assertIn("{ ...extractCircuitStatePeriods(state.raceControl), sectorYellows }", self.dashboard_js)

    def test_scene_renders_sector_overlay(self):
        for snippet in (
            "buildMarshalSectorSegments(trackPoints, info.marshalSectors)",
            "replay-sector-path",
            "replay-sector-badge",
            "state.replay.sectorNodes",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_playhead_updates_light_active_sectors(self):
        self.assertIn("activeSectorYellowsAt(timeline.states.sectorYellows, ms)", self.dashboard_js)
        self.assertIn("classList.toggle('sector-yellow'", self.dashboard_js)
        self.assertIn("classList.toggle('sector-double-yellow'", self.dashboard_js)

    def test_styles_contain_sector_classes(self):
        for css_class in (
            ".replay-sector-path",
            ".replay-sector-path.sector-yellow",
            ".replay-sector-path.sector-double-yellow",
            ".replay-sector-badge",
            ".replay-sector-badge.sector-yellow rect",
        ):
            self.assertIn(css_class, self.styles_css)

    def test_extract_sector_yellow_periods(self):
        body = self._extract_function("extractSectorYellowPeriods")
        records = [
            {"date": "2022-09-11T16:10:42Z", "flag": "DOUBLE YELLOW", "scope": "Sector", "sector": 9,
             "message": "DOUBLE YELLOW IN TRACK SECTOR 9"},
            # No sector field (older cached rows): the number comes from the text
            {"date": "2022-09-11T16:10:55Z", "flag": "YELLOW", "scope": "Sector", "sector": None,
             "message": "YELLOW IN TRACK SECTOR 8"},
            # Sector-scope clear ends only sector 8
            {"date": "2022-09-11T16:11:40Z", "flag": "CLEAR", "scope": "Sector", "sector": None,
             "message": "CLEAR IN TRACK SECTOR 8"},
            # Track-scope clear ends the remaining sector 9 double yellow
            {"date": "2022-09-11T16:12:30Z", "flag": "CLEAR", "scope": "Track", "sector": None,
             "message": "TRACK CLEAR"},
        ]
        script = textwrap.dedent(f"""
            {body}
            const periods = extractSectorYellowPeriods({json.dumps(records)});
            console.log(JSON.stringify(periods.map(p => [
                p.sector, p.double,
                new Date(p.startMs).toISOString(),
                new Date(p.endMs).toISOString()
            ])));
        """)
        self.assertEqual(self._run_node(script), [
            [8, False, "2022-09-11T16:10:55.000Z", "2022-09-11T16:11:40.000Z"],
            [9, True, "2022-09-11T16:10:42.000Z", "2022-09-11T16:12:30.000Z"],
        ])

    def test_extract_sector_yellow_escalation_and_red_flag(self):
        body = self._extract_function("extractSectorYellowPeriods")
        records = [
            {"date": "2026-05-24T13:00:00Z", "flag": "YELLOW", "scope": "Sector", "sector": 3},
            # Escalation splits the span at the double yellow
            {"date": "2026-05-24T13:00:20Z", "flag": "DOUBLE YELLOW", "scope": "Sector", "sector": 3},
            # A red flag ends every open sector yellow
            {"date": "2026-05-24T13:01:00Z", "flag": None, "scope": None, "sector": None,
             "message": "RED FLAG - RACE SUSPENDED"},
        ]
        script = textwrap.dedent(f"""
            {body}
            const periods = extractSectorYellowPeriods({json.dumps(records)});
            console.log(JSON.stringify(periods.map(p => [
                p.sector, p.double,
                new Date(p.startMs).toISOString(),
                new Date(p.endMs).toISOString()
            ])));
        """)
        self.assertEqual(self._run_node(script), [
            [3, False, "2026-05-24T13:00:00.000Z", "2026-05-24T13:00:20.000Z"],
            [3, True, "2026-05-24T13:00:20.000Z", "2026-05-24T13:01:00.000Z"],
        ])

    def test_build_marshal_sector_segments_covers_the_loop(self):
        body = self._extract_function("buildMarshalSectorSegments")
        # Counter-clockwise 8-point square loop; four sectors at the corners
        track_points = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]]
        marshal_sectors = [
            {"number": 1, "trackPosition": {"x": 0, "y": 0}},
            {"number": 2, "trackPosition": {"x": 2, "y": 0}},
            {"number": 3, "trackPosition": {"x": 2, "y": 2}},
            {"number": 4, "trackPosition": {"x": 0, "y": 2}},
        ]
        script = textwrap.dedent(f"""
            {body}
            const segments = buildMarshalSectorSegments(
                {json.dumps(track_points)},
                {json.dumps(marshal_sectors)}
            );
            console.log(JSON.stringify(segments.map(s => [s.number, s.points, s.badge])));
        """)
        segments = self._run_node(script)
        self.assertEqual([s[0] for s in segments], [1, 2, 3, 4])
        self.assertEqual(segments[0][1], [[0, 0], [1, 0], [2, 0]])
        # The last sector wraps past the polyline end back to sector 1's start
        self.assertEqual(segments[3][1], [[0, 2], [0, 1], [0, 0]])
        # Sector 1's badge sits outside the CCW loop (below-left of the origin)
        badge = segments[0][2]
        self.assertLess(badge[0], 0)
        self.assertLess(badge[1], 0)

    def test_active_sector_yellows_prefers_double(self):
        body = self._extract_function("activeSectorYellowsAt")
        periods = [
            {"sector": 8, "double": False, "startMs": 1000, "endMs": 5000},
            {"sector": 9, "double": False, "startMs": 1000, "endMs": 5000},
            {"sector": 9, "double": True, "startMs": 2000, "endMs": 4000},
        ]
        script = textwrap.dedent(f"""
            {body}
            const periods = {json.dumps(periods)};
            console.log(JSON.stringify([
                [...activeSectorYellowsAt(periods, 3000).entries()],
                [...activeSectorYellowsAt(periods, 4500).entries()],
                [...activeSectorYellowsAt(periods, null).entries()],
                [...activeSectorYellowsAt(periods, 6000).entries()]
            ]));
        """)
        self.assertEqual(self._run_node(script), [
            [[8, "yellow"], [9, "double-yellow"]],
            [[8, "yellow"], [9, "yellow"]],
            [],
            [],
        ])


if __name__ == "__main__":
    unittest.main()
