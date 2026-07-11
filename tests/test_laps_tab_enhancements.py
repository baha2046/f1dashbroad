"""Static wiring for the Laps & Stints tab enhancements:

- Lap breakdown table gains Tyre (compound + age) and Track (SC/VSC) columns.
- Lap telemetry charts gain drag-to-zoom with a reset control.
- A detail mode splits the combined inputs chart into throttle / brake / gear charts.
"""
import re
import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class LapsTabEnhancementsStaticWiringTests(unittest.TestCase):
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

    # --- Lap breakdown table: tyre + track-status columns ---

    def test_laps_table_has_tyre_and_track_columns(self):
        header_row = re.search(
            r'<table class="laps-table">\s*<thead>(.*?)</thead>',
            self.index_html,
            re.DOTALL,
        )
        self.assertIsNotNone(header_row, "laps table header missing")
        for column in ("<th>Lap</th>", "<th>Tyre</th>", "<th>Pit</th>", "<th>Track</th>", "<th>Lap time</th>"):
            self.assertIn(column, header_row.group(1))

    def test_lap_rows_render_tyre_and_track_cells(self):
        body = self._extract_function("selectDriverForStats")
        self.assertIn("getLapStintInfo(driverNumber, lap.lap_number)", body)
        self.assertIn("getLapTrackStatus(lap.lap_number, tableSafetyCarPeriods)", body)
        self.assertIn('lap-tyre-cell', body)
        self.assertIn('lap-track-cell', body)
        # Empty state spans all eight columns
        self.assertIn('colspan="8"', body)
        self.assertNotIn('colspan="6"', body)

    def test_lap_stint_info_resolves_compound_and_age(self):
        body = self._extract_function("getLapStintInfo")
        self.assertIn("state.stints", body)
        self.assertIn("lap_start", body)
        self.assertIn("lap_end", body)
        self.assertIn("tyre_age_at_start", body)

    def test_lap_track_status_prefers_full_safety_car(self):
        body = self._extract_function("getLapTrackStatus")
        self.assertIn("period.start", body)
        self.assertIn("period.end", body)
        self.assertIn("'SC'", body)

    def test_lap_chart_tooltip_includes_tyre_and_track_rows(self):
        body = self._extract_function("renderLapChart")
        self.assertIn("getLapStintInfo(state.selectedDriverStats, lap.lap_number)", body)
        self.assertIn("getLapTrackStatus(lap.lap_number, safetyCarPeriods)", body)
        self.assertIn("chart-tooltip-track", body)

    def test_lap_badge_styles_exist(self):
        for css_class in (
            ".lap-tyre-badge",
            ".lap-track-badge.track-sc",
            ".lap-track-badge.track-vsc",
            ".chart-tooltip-track",
        ):
            self.assertIn(css_class, self.styles_css)

    # --- Telemetry drag-zoom + reset ---

    def test_index_has_telemetry_zoom_and_detail_controls(self):
        self.assertIn('id="telemetryResetZoom"', self.index_html)
        self.assertIn('id="telemetryDetailMode"', self.index_html)

    def test_dom_registers_new_telemetry_elements(self):
        for element_id in (
            "telemetryResetZoom",
            "telemetryDetailMode",
            "telemetryInputsWrapper",
            "telemetryThrottleWrapper",
            "telemetryThrottleChart",
            "telemetryBrakeWrapper",
            "telemetryBrakeChart",
            "telemetryGearWrapper",
            "telemetryGearChart",
        ):
            self.assertIn(
                f"{element_id}: document.getElementById('{element_id}')",
                self.dashboard_js,
            )

    def test_state_tracks_telemetry_view(self):
        self.assertIn("telemetryView: createTelemetryViewState()", self.dashboard_js)
        body = self._extract_function("createTelemetryViewState")
        self.assertIn("window: { min: null, max: null }", body)
        self.assertIn("detailMode: false", body)
        self.assertIn("zoomDrag: null", body)
        self.assertIn("lastRender: null", body)

    def test_telemetry_zoom_drag_mirrors_compare_pattern(self):
        body = self._extract_function("attachTelemetryZoom")
        self.assertIn('addEventListener("mousedown"', body)
        self.assertIn('addEventListener("mousemove"', body)
        self.assertIn('window.addEventListener("mouseup"', body)
        self.assertIn("telemetry-zoom-selection", body)
        self.assertIn("state.telemetryView.window", body)
        self.assertIn("rerenderTelemetry()", body)
        # Accidental clicks (tiny drags) never zoom
        self.assertIn("< 5", body)

    def test_telemetry_domain_clamps_zoom_window(self):
        body = self._extract_function("getTelemetryDomain")
        self.assertIn("isTelemetryZoomActive()", body)
        self.assertIn("Math.max(0", body)
        self.assertIn("return { min: 0, max: maxX }", body)

    def test_zoom_resets_when_a_different_payload_renders(self):
        body = self._extract_function("syncTelemetryRenderState")
        self.assertIn("last.key !== key", body)
        self.assertIn("window = { min: null, max: null }", body)

    def test_charts_are_built_with_the_zoom_domain(self):
        single = self._extract_function("renderTelemetryCharts")
        self.assertIn("getTelemetryDomain(maxT)", single)
        self.assertIn("attachTelemetryZoom", single)
        self.assertIn("updateTelemetryZoomControl()", single)

        compare = self._extract_function("renderTelemetryComparison")
        self.assertIn("getTelemetryDomain(maxX)", compare)
        self.assertIn("attachTelemetryZoom", compare)
        self.assertIn("buildTelemetryDeltaChart(DOM.telemetryDeltaChart, 150, maxX, deltaSamples, fmtXLabel, domain)", compare)

    def test_build_telemetry_chart_clips_series_to_plot_area(self):
        body = self._extract_function("buildTelemetryChart")
        self.assertIn("options.domain", body)
        self.assertIn("clipPath", body)
        self.assertIn("clip-path", body)

    def test_crosshair_maps_pointer_through_zoom_domain(self):
        for function_name in ("attachTelemetryCrosshair", "attachTelemetryCompareCrosshair"):
            body = self._extract_function(function_name)
            self.assertIn("ctx.domain", body)
            self.assertIn("domain.min +", body)

    def test_reset_zoom_button_is_wired(self):
        self.assertIn("DOM.telemetryResetZoom.addEventListener('click'", self.dashboard_js)
        body = self._extract_function("resetTelemetryZoom")
        self.assertIn("state.telemetryView.window = { min: null, max: null }", body)
        self.assertIn(".telemetry-zoom-selection", self.styles_css)

    # --- Telemetry detail mode ---

    def test_index_has_detail_mode_chart_wrappers(self):
        for element_id in (
            'id="telemetryInputsWrapper"',
            'id="telemetryThrottleWrapper"',
            'id="telemetryThrottleChart"',
            'id="telemetryBrakeWrapper"',
            'id="telemetryBrakeChart"',
            'id="telemetryGearWrapper"',
            'id="telemetryGearChart"',
        ):
            self.assertIn(element_id, self.index_html)

    def test_detail_mode_toggle_swaps_chart_layout(self):
        self.assertIn("DOM.telemetryDetailMode.addEventListener('change'", self.dashboard_js)
        body = self._extract_function("applyTelemetryChartLayout")
        self.assertIn("state.telemetryView.detailMode", body)
        self.assertIn("DOM.telemetryInputsWrapper", body)
        self.assertIn("DOM.telemetryThrottleWrapper", body)
        self.assertIn("DOM.telemetryBrakeWrapper", body)
        self.assertIn("DOM.telemetryGearWrapper", body)

    def test_detail_mode_builds_throttle_brake_and_gear_charts(self):
        single = self._extract_function("renderTelemetryCharts")
        compare = self._extract_function("renderTelemetryComparison")
        for body in (single, compare):
            self.assertIn("state.telemetryView.detailMode", body)
            self.assertIn("DOM.telemetryThrottleChart", body)
            self.assertIn("DOM.telemetryBrakeChart", body)
            self.assertIn("DOM.telemetryGearChart", body)
            self.assertIn("buildGearStepPoints", body)

    def test_gear_points_are_step_interpolated(self):
        body = self._extract_function("buildGearStepPoints")
        self.assertIn("prevGear", body)
        self.assertIn("points.push([x, prevGear])", body)

    def test_gear_line_styles_exist(self):
        self.assertIn(".telemetry-gear-line", self.styles_css)
        self.assertIn(".telemetry-ref-gear-line", self.styles_css)

    def test_telemetry_message_clears_every_chart_container(self):
        body = self._extract_function("renderTelemetryMessage")
        for container in (
            "DOM.telemetrySpeedChart",
            "DOM.telemetryInputsChart",
            "DOM.telemetryThrottleChart",
            "DOM.telemetryBrakeChart",
            "DOM.telemetryGearChart",
        ):
            self.assertIn(container, body)
        self.assertIn("state.telemetryView.lastRender = null", body)


if __name__ == "__main__":
    unittest.main()
