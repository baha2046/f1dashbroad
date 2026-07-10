import json
import subprocess
import textwrap
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class CircuitTabRedesignTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def _extract_function(self, function_name):
        marker = f"function {function_name}"
        start = self.dashboard_js.find(marker)
        self.assertNotEqual(start, -1, f"{function_name} is missing")
        body_start = self.dashboard_js.find("{", start)
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

    def test_template_has_profile_map_and_insight_surfaces(self):
        for snippet in (
            'class="circuit-profile-hero glass"',
            'data-circuit-layer-toggle="sectors"',
            'data-circuit-layer-toggle="corners"',
            'id="circuitCornerCount"',
            'id="circuitMarshalSectorCount"',
            'id="circuitSectorBenchmarks"',
            'id="circuitMapStatusText"',
        ):
            self.assertIn(snippet, self.index_html)

    def test_map_renders_real_marshal_sector_geometry(self):
        for snippet in (
            "buildMarshalSectorSegments(trackPoints, marshalSectors)",
            "circuit-sector-path",
            "circuit-sector-badge",
            "data-feature-label=\"Marshal sector ${number}\"",
            "setupCircuitMapInteractions(corners.length, marshalSegments.length)",
        ):
            self.assertIn(snippet, self.dashboard_js)

    def test_sector_benchmarks_load_when_circuit_tab_opens(self):
        self.assertIn("targetTab === 'circuit-view'", self.dashboard_js)
        self.assertIn("maybeLoadCircuitSectorBenchmarks();", self.dashboard_js)
        self.assertIn("duration_sector_${sectorIndex + 1}", self.dashboard_js)

    def test_benchmark_helper_selects_independent_session_bests(self):
        body = self._extract_function("buildCircuitSectorBenchmarks")
        script = textwrap.dedent(f"""
            function getDriverTeamHex(driver) {{ return driver ? driver.team_colour : '787878'; }}
            {body}
            const laps = [
                {{driver_number: 4, lap_number: 2, duration_sector_1: 31.2, duration_sector_2: 28.1, duration_sector_3: 24.7}},
                {{driver_number: 81, lap_number: 5, duration_sector_1: 30.9, duration_sector_2: 28.4, duration_sector_3: 24.4}},
                {{driver_number: 4, lap_number: 8, duration_sector_1: null, duration_sector_2: 27.8, duration_sector_3: 0}}
            ];
            const drivers = [
                {{driver_number: 4, name_acronym: 'NOR', full_name: 'Lando Norris', team_colour: 'FF8000'}},
                {{driver_number: 81, name_acronym: 'PIA', full_name: 'Oscar Piastri', team_colour: 'FF8000'}}
            ];
            console.log(JSON.stringify(buildCircuitSectorBenchmarks(laps, drivers).map(item => [item.time, item.acronym, item.lapNumber])));
        """)
        self.assertEqual(self._run_node(script), [
            [30.9, "PIA", 5],
            [27.8, "NOR", 8],
            [24.4, "PIA", 5],
        ])

    def test_direction_helper_handles_both_orientations(self):
        body = self._extract_function("circuitTrackDirection")
        script = textwrap.dedent(f"""
            {body}
            console.log(JSON.stringify([
                circuitTrackDirection([[0, 0], [0, 1], [1, 1], [1, 0]]),
                circuitTrackDirection([[0, 0], [1, 0], [1, 1], [0, 1]]),
                circuitTrackDirection([])
            ]));
        """)
        self.assertEqual(self._run_node(script), ["Clockwise", "Anti-clockwise", "--"])

    def test_styles_cover_layers_interaction_and_container_responsiveness(self):
        for snippet in (
            "#circuit-view",
            "container: circuit-view / inline-size",
            '.circuit-map-content[data-layer="sectors"]',
            ".circuit-sector-group.is-active .circuit-sector-path",
            ".circuit-sector-benchmark",
            "@container circuit-view (max-width: 690px)",
            "@media (prefers-reduced-motion: reduce)",
        ):
            self.assertIn(snippet, self.styles_css)


if __name__ == "__main__":
    unittest.main()
