"""2D/3D projection toggle on the Session Replay track map.

The replay scene keeps its geometry in world space and projects it through a
switchable view transform: identity for the flat 2D map, or a yaw rotation
plus depth foreshortening for the tilted 3D view. Reprojection rewrites node
geometry in place so playback, focus highlights, and lit marshal sectors
survive view changes; horizontal drags rotate the 3D view.
"""
import json
import re
import subprocess
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class Replay3dViewTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")

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

    def _extract_const(self, name):
        match = re.search(rf"const {name} = ([^;]+);", self.dashboard_js)
        self.assertIsNotNone(match, f"{name} is missing from dashboard JS")
        return match.group(1)

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

    def _view_transform_script(self, mode, yaw_deg, points):
        return "\n".join([
            f"const REPLAY_3D_DEPTH_SCALE = {self._extract_const('REPLAY_3D_DEPTH_SCALE')};",
            f"const state = {{ replayMapView: {{ mode: '{mode}', yawDeg: {yaw_deg} }} }};",
            self._extract_function("replayViewTransform"),
            "const view = replayViewTransform();",
            f"console.log(JSON.stringify({json.dumps(points)}.map(([x, y]) => view(x, y))));",
        ])

    # --- markup / wiring ---

    def test_stage_header_has_view_toggle(self):
        self.assertIn('id="replayViewToggle"', self.index_html)
        self.assertIn('data-map-view="2d"', self.index_html)
        self.assertIn('data-map-view="3d"', self.index_html)
        self.assertIn("replayViewToggle: document.getElementById('replayViewToggle')", self.dashboard_js)

    def test_toggle_and_rotation_are_wired(self):
        self.assertIn("setReplayMapViewMode(btn.dataset.mapView)", self.dashboard_js)
        self.assertIn("setupReplayMapRotation();", self.dashboard_js)
        self.assertIn("updateReplayMapViewControls();", self.dashboard_js)

    def test_view_mode_survives_session_reset(self):
        # The projection mode lives outside state.replay, which resetReplay()
        # recreates on every session change
        self.assertIn("replayMapView: { mode: '2d', yawDeg: 0 }", self.dashboard_js)

    # --- scene reprojection ---

    def test_scene_keeps_world_geometry_and_projects_on_build(self):
        body = self._extract_function("buildReplayScene")
        self.assertIn("state.replay.scene = scene", body)
        self.assertIn("applyReplayMapProjection();", body)
        self.assertIn("replay-track-base", body)

    def test_projection_rewrites_geometry_in_place(self):
        body = self._extract_function("applyReplayMapProjection")
        self.assertIn("replayViewTransform()", body)
        self.assertIn("scene.trackPath.setAttribute('d'", body)
        self.assertIn("scene.trackBasePath.setAttribute('d'", body)
        self.assertIn("scene.marshalSegments.forEach", body)
        self.assertIn("state.replay.carNodes[car.driverNumber]", body)
        # FIA cars stream (0,0) while parked and must not stretch the bounds
        self.assertIn("if (car.fia) return;", body)

    def test_mode_switch_reprojects_and_repaints(self):
        body = self._extract_function("setReplayMapViewMode")
        self.assertIn("applyReplayMapProjection();", body)
        self.assertIn("renderReplayFrame(state.replay.t)", body)

    def test_replay_message_drops_stale_scene(self):
        body = self._extract_function("renderReplayMessage")
        self.assertIn("state.replay.scene = null", body)

    def test_rotation_drag_swallows_release_click(self):
        body = self._extract_function("setupReplayMapRotation")
        self.assertIn("state.replayMapView.yawDeg", body)
        self.assertIn("REPLAY_3D_DRAG_CLICK_THRESHOLD_PX", body)
        self.assertIn("requestAnimationFrame(reproject)", body)

    # --- projection math ---

    def test_2d_view_transform_is_identity(self):
        points = self._run_node(self._view_transform_script("2d", 45, [[123.5, -42.0]]))
        self.assertEqual(points, [[123.5, -42.0]])

    def test_3d_view_squashes_depth_axis(self):
        scale = float(self._extract_const("REPLAY_3D_DEPTH_SCALE"))
        points = self._run_node(self._view_transform_script("3d", 0, [[100.0, 40.0]]))
        self.assertAlmostEqual(points[0][0], 100.0, places=6)
        self.assertAlmostEqual(points[0][1], 40.0 * scale, places=6)

    def test_3d_view_rotates_by_yaw(self):
        scale = float(self._extract_const("REPLAY_3D_DEPTH_SCALE"))
        points = self._run_node(self._view_transform_script("3d", 90, [[100.0, 0.0], [0.0, 100.0]]))
        # 90° yaw maps +x onto the depth axis and +y onto -x
        self.assertAlmostEqual(points[0][0], 0.0, places=6)
        self.assertAlmostEqual(points[0][1], 100.0 * scale, places=6)
        self.assertAlmostEqual(points[1][0], -100.0, places=6)
        self.assertAlmostEqual(points[1][1], 0.0, places=6)

    # --- styling ---

    def test_styles_cover_3d_view(self):
        for css_snippet in (
            ".replay-view-toggle",
            ".replay-stage-tools",
            ".replay-track-base",
            '.replay-map-content[data-view-mode="3d"]',
            '.replay-map-content[data-view-mode="3d"].is-rotating',
        ):
            self.assertIn(css_snippet, self.styles_css)


if __name__ == "__main__":
    unittest.main()
