import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from js_sources import read_dashboard_js


class WeatherTrendWidgetTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def _extract_function(self, function_name):
        marker = f"function {function_name}("
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

    def test_weather_widget_has_trend_container(self):
        self.assertIn('id="weatherTrendChart"', self.index_html)
        self.assertIn('aria-label="Recent weather trends"', self.index_html)

    def test_dom_map_wires_weather_trend_nodes(self):
        self.assertIn("weatherTrendChart: document.getElementById('weatherTrendChart')", self.dashboard_js)

    def test_styles_include_responsive_sparkline_treatment(self):
        for css_class in (
            ".weather-trends",
            ".weather-trend-card",
            ".weather-sparkline",
            ".weather-rain-markers",
        ):
            self.assertIn(css_class, self.styles_css)

        self.assertIn("@media (max-width: 600px)", self.styles_css)

    def test_weather_trend_series_uses_recent_chronological_samples(self):
        helpers = "\n".join(
            self._extract_function(name)
            for name in (
                "isFiniteWeatherValue",
                "buildWeatherTrendSeries",
            )
        )
        samples = [
            {
                "date": "2026-07-04T14:02:00+00:00",
                "air_temperature": 25.5,
                "track_temperature": 38.2,
                "wind_speed": 4.5,
                "rainfall": 1,
            },
            {
                "date": "2026-07-04T14:00:00+00:00",
                "air_temperature": 24.1,
                "track_temperature": 36.0,
                "wind_speed": 3.2,
                "rainfall": 0,
            },
            {
                "date": "2026-07-04T14:01:00+00:00",
                "air_temperature": 24.9,
                "track_temperature": 37.3,
                "wind_speed": 3.9,
                "rainfall": 0,
            },
        ]
        script = textwrap.dedent(
            f"""
            {helpers}

            const trends = buildWeatherTrendSeries({json.dumps(samples)}, 2);
            console.log(JSON.stringify({{
                air: trends.air.values,
                track: trends.track.values,
                wind: trends.wind.values,
                rain: trends.rain.values,
                latest: trends.latest,
                sampleCount: trends.sampleCount,
                rainDetected: trends.rainDetected
            }}));
            """
        )

        self.assertEqual(
            self._run_node(script),
            {
                "air": [24.9, 25.5],
                "track": [37.3, 38.2],
                "wind": [3.9, 4.5],
                "rain": [0, 1],
                "latest": {
                    "air": 25.5,
                    "track": 38.2,
                    "humidity": None,
                    "wind": 4.5,
                    "rain": 1,
                },
                "sampleCount": 2,
                "rainDetected": True,
            },
        )

    def test_render_weather_shows_latest_values_not_session_averages(self):
        helpers = "\n".join(
            self._extract_function(name)
            for name in (
                "isFiniteWeatherValue",
                "formatWeatherValue",
                "buildWeatherTrendSeries",
                "buildWeatherSparklinePoints",
                "renderWeatherTrendCard",
                "renderWeatherTrendChart",
                "renderWeather",
            )
        )
        samples = [
            {"date": "2026-07-04T14:00:00+00:00", "air_temperature": 20, "track_temperature": 30, "humidity": 50, "wind_speed": 2, "rainfall": 0},
            {"date": "2026-07-04T14:01:00+00:00", "air_temperature": 30, "track_temperature": 40, "humidity": 70, "wind_speed": 4, "rainfall": 1},
        ]
        script = textwrap.dedent(
            f"""
            {helpers}

            const makeNode = () => ({{ textContent: "", innerHTML: "", style: {{ display: "" }} }});
            const DOM = {{
                weatherAirTemp: makeNode(),
                weatherTrackTemp: makeNode(),
                weatherHumidity: makeNode(),
                weatherWind: makeNode(),
                weatherRainfall: makeNode(),
                weatherTrendChart: makeNode(),
            }};
            const state = {{ weather: {json.dumps(samples)} }};

            renderWeather();
            console.log(JSON.stringify({{
                air: DOM.weatherAirTemp.textContent,
                track: DOM.weatherTrackTemp.textContent,
                humidity: DOM.weatherHumidity.textContent,
                wind: DOM.weatherWind.textContent,
                rainDisplay: DOM.weatherRainfall.style.display,
                chartHasSvg: DOM.weatherTrendChart.innerHTML.includes("<svg"),
                chartHasRainMarkers: DOM.weatherTrendChart.innerHTML.includes("weather-rain-markers")
            }}));
            """
        )

        self.assertEqual(
            self._run_node(script),
            {
                "air": "30.0 °C",
                "track": "40.0 °C",
                "humidity": "70 %",
                "wind": "4.0 m/s",
                "rainDisplay": "flex",
                "chartHasSvg": True,
                "chartHasRainMarkers": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
