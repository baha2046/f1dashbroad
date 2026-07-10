import json
import subprocess
import textwrap
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class ResultsReplayRedesignStaticTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)

    def _extract_function(self, function_name):
        marker = f"function {function_name}"
        start = self.dashboard_js.find(marker)
        self.assertNotEqual(start, -1, f"{function_name} is missing")
        body_start = self.dashboard_js.find("{", start)
        depth = 0
        for index in range(body_start, len(self.dashboard_js)):
            if self.dashboard_js[index] == "{":
                depth += 1
            elif self.dashboard_js[index] == "}":
                depth -= 1
                if depth == 0:
                    return self.dashboard_js[start:index + 1]
        self.fail(f"{function_name} body was not closed")

    def _run_results_overview_case(self, session, results, status_rows=None):
        helpers = "\n".join(self._extract_function(name) for name in (
            "getResultDriver",
            "formatResultPace",
            "formatResultGap",
            "getResultsSessionPhase",
            "updateResultsOverview",
        ))
        script = textwrap.dedent(f"""
            const makeNode = () => ({{
                textContent: '',
                style: {{}},
                classList: {{
                    values: new Set(),
                    toggle(name, enabled) {{ enabled ? this.values.add(name) : this.values.delete(name); }}
                }}
            }});
            const DOM = {{}};
            [
                'resultsOverview', 'resultsClassificationPanel', 'resultsEyebrowText',
                'resultsSessionBadgeText', 'resultsSessionBadge', 'resultsClassificationCount',
                'resultsLeadLabel', 'resultsLeadValue', 'resultsLeadMeta', 'resultsHeroTitle',
                'resultsHeroSubtitle', 'resultsClassificationTitle', 'resultsPaceLabel',
                'resultsPaceValue', 'resultsPaceMeta', 'resultsFieldLabel', 'resultsFieldValue',
                'resultsFieldMeta', 'resultsPointsLabel', 'resultsPointsValue', 'resultsPointsMeta'
            ].forEach(key => DOM[key] = makeNode());
            const state = {{
                selectedSession: {json.dumps(session)},
                sessionStatusSeries: {json.dumps(status_rows or [])},
                drivers: [
                    {{driver_number: 1, full_name: 'Leader One', name_acronym: 'ONE', team_name: 'Alpha'}},
                    {{driver_number: 2, full_name: 'Driver Two', name_acronym: 'TWO', team_name: 'Beta'}}
                ]
            }};
            function formatLapTime(value) {{ return `LAP:${{value}}`; }}
            function getLiveSessionStatus(session) {{ return {{text: session._status || 'Past'}}; }}
            function isPitAnnotationSession(session) {{
                return ['race', 'sprint'].includes(String(session.session_type || session.session_name || '').toLowerCase());
            }}
            {helpers}
            const results = {json.dumps(results)};
            updateResultsOverview(results, false, ['Q1', 'Q2', 'Q3'], [null, null, null]);
            console.log(JSON.stringify({{
                eyebrow: DOM.resultsEyebrowText.textContent,
                badge: DOM.resultsSessionBadgeText.textContent,
                title: DOM.resultsHeroTitle.textContent,
                classification: DOM.resultsClassificationTitle.textContent,
                leadLabel: DOM.resultsLeadLabel.textContent,
                pointsLabel: DOM.resultsPointsLabel.textContent,
                pointsValue: DOM.resultsPointsValue.textContent,
                pointsMeta: DOM.resultsPointsMeta.textContent
            }}));
        """)
        completed = subprocess.run(
            ["node", "-e", script],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        return json.loads(completed.stdout)

    def test_results_dashboard_has_summary_and_classification_surfaces(self):
        for element_id in (
            "resultsOverview",
            "resultsHeroTitle",
            "resultsLeadValue",
            "resultsPaceValue",
            "resultsFieldValue",
            "resultsPointsValue",
            "resultsClassificationPanel",
            "resultsClassificationCount",
        ):
            self.assertIn(f'id="{element_id}"', self.index_html)

    def test_results_summary_is_driven_by_session_data(self):
        self.assertIn("function updateResultsOverview", self.dashboard_js)
        self.assertIn("updateResultsOverview(sortedResults, isQualiResults, segmentLabels, segmentBest);", self.dashboard_js)
        self.assertIn("tr.style.setProperty('--result-team-color'", self.dashboard_js)
        self.assertIn("results-row-podium-", self.dashboard_js)

    def test_practice_results_use_neutral_timing_language(self):
        overview = self._run_results_overview_case(
            {"session_name": "Practice 1", "session_type": "Practice", "_status": "Past"},
            [
                {"driver_number": 1, "position": 1, "number_of_laps": 30, "gap_to_leader": None, "points": None},
                {"driver_number": 2, "position": 2, "number_of_laps": 29, "gap_to_leader": 0.2, "points": None},
            ],
        )
        self.assertEqual(overview["eyebrow"], "Session timing summary")
        self.assertEqual(overview["title"], "Practice 1 timing")
        self.assertEqual(overview["classification"], "Final timing order")
        self.assertEqual(overview["leadLabel"], "Session leader")
        self.assertEqual(overview["pointsLabel"], "Running total")
        self.assertEqual(overview["pointsValue"], "59")

    def test_live_race_and_missing_points_are_not_declared_final(self):
        overview = self._run_results_overview_case(
            {"session_name": "Race", "session_type": "Race", "_status": "Live"},
            [
                {"driver_number": 1, "position": 1, "number_of_laps": 12, "gap_to_leader": None, "points": None},
                {"driver_number": 2, "position": 2, "number_of_laps": 12, "gap_to_leader": 1.2, "points": None},
            ],
            [{"session_status": "Started"}],
        )
        self.assertEqual(overview["eyebrow"], "Current classification")
        self.assertEqual(overview["badge"], "Race · Live")
        self.assertEqual(overview["title"], "Live race classification")
        self.assertEqual(overview["leadLabel"], "Leader")
        self.assertEqual(overview["pointsValue"], "--")
        self.assertEqual(overview["pointsMeta"], "points unavailable")

    def test_replay_is_grouped_into_cockpit_surfaces(self):
        for class_name in (
            "replay-header",
            "replay-primary-controls",
            "replay-timeline-panel",
            "replay-stage",
            "replay-feed-stack",
            "replay-race-context",
        ):
            self.assertIn(f'class="{class_name}', self.index_html)

    def test_replay_driver_focus_is_keyboard_and_screen_reader_accessible(self):
        self.assertIn("function onReplayDriverHighlightKeydown", self.dashboard_js)
        self.assertIn("function updateReplayTowerRowAccessibleName", self.dashboard_js)
        self.assertIn("function placeReplayTowerRow", self.dashboard_js)
        self.assertIn("group.setAttribute('aria-pressed', 'false')", self.dashboard_js)
        self.assertIn("row.setAttribute('aria-pressed', 'false')", self.dashboard_js)
        self.assertIn("tagName === 'BUTTON'", self.dashboard_js)
        self.assertIn("event.repeat", self.dashboard_js)

    def test_replay_stage_status_tracks_real_loading_state(self):
        self.assertIn('id="replayStageStatus"', self.index_html)
        self.assertIn('id="replayStageStatusText"', self.index_html)
        self.assertIn("function setReplayStageStatus", self.dashboard_js)
        self.assertIn("setReplayStageStatus('ready', 'Timeline synchronized');", self.dashboard_js)
        self.assertNotIn("Race playback", self.index_html)
        self.assertNotIn("drag the playhead", self.index_html)

    def test_redesign_uses_container_queries_and_oklch_tokens(self):
        self.assertIn("#results-view,\n#replay-view", self.styles_css)
        self.assertIn("container-type: inline-size", self.styles_css)
        self.assertIn("@container (max-width: 680px)", self.styles_css)
        self.assertIn("oklch(", self.styles_css)


if __name__ == "__main__":
    unittest.main()
