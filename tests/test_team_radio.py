import json
import shutil
import unittest
from pathlib import Path

from js_sources import read_dashboard_js
from unittest.mock import patch

import app as dashboard_app

PROJECT_TEMP_DIR = Path(__file__).resolve().parents[1] / "tests" / ".tmp"


class TeamRadioApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_dir = PROJECT_TEMP_DIR / self._testMethodName
        shutil.rmtree(self.cache_dir, ignore_errors=True)
        self.cache_dir.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.cache_dir, ignore_errors=True)

    def test_team_radio_registered_as_session_endpoint(self):
        self.assertEqual(dashboard_app.OPENF1_SESSION_ENDPOINTS.get("team_radio"), "team_radio")

    async def test_team_radio_endpoint_returns_cached_session_clips(self):
        sample_clips = [
            {
                "session_key": 4242,
                "meeting_key": 1219,
                "driver_number": 1,
                "date": "2026-06-07T15:12:41.005000+00:00",
                "recording_url": "https://livetiming.formula1.com/static/TeamRadio/MAXVER01_1.mp3",
            }
        ]

        cache_path = self.cache_dir / "team_radio_4242.json"
        cache_path.write_text(json.dumps(sample_clips), encoding="utf-8")

        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            response = await client.get("/api/team_radio?session_key=4242")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(await response.get_json(), sample_clips)

    async def test_team_radio_endpoint_requires_integer_session_key(self):
        with patch.object(dashboard_app, "CACHE_DIR", str(self.cache_dir)):
            client = dashboard_app.app.test_client()
            missing = await client.get("/api/team_radio")
            invalid = await client.get("/api/team_radio?session_key=abc")

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(invalid.status_code, 400)


class TeamRadioStaticWiringTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
        self.dashboard_js = read_dashboard_js(self.root)
        self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

    def test_race_control_view_has_team_radio_toggle(self):
        self.assertIn('id="showTeamRadio"', self.index_html)
        self.assertIn('class="race-control-toggles"', self.index_html)

    def test_replay_view_has_team_radio_ticker(self):
        self.assertIn('id="replayTeamRadioTicker"', self.index_html)
        self.assertIn('id="replayTeamRadioPlayBtn"', self.index_html)
        self.assertIn('id="replayTeamRadioMeta"', self.index_html)

    def test_dashboard_state_and_dom_wire_team_radio(self):
        self.assertIn("teamRadio: []", self.dashboard_js)
        self.assertIn("teamRadioIndex: null", self.dashboard_js)
        self.assertIn("showTeamRadio: document.getElementById('showTeamRadio')", self.dashboard_js)
        self.assertIn("replayTeamRadioTicker: document.getElementById('replayTeamRadioTicker')", self.dashboard_js)
        self.assertIn("replayTeamRadioPlayBtn: document.getElementById('replayTeamRadioPlayBtn')", self.dashboard_js)
        self.assertIn("replayTeamRadioMeta: document.getElementById('replayTeamRadioMeta')", self.dashboard_js)

    def test_session_load_and_live_mode_fetch_team_radio(self):
        self.assertIn("/api/team_radio?session_key=${session.session_key}", self.dashboard_js)
        self.assertIn("/api/team_radio?session_key=${sessionKey}", self.dashboard_js)
        self.assertIn("state.teamRadio = []", self.dashboard_js)

    def test_shared_team_radio_player_helpers_exist(self):
        self.assertIn("function toggleTeamRadioClip", self.dashboard_js)
        self.assertIn("function syncTeamRadioPlayingButtons", self.dashboard_js)
        self.assertIn("function onTeamRadioPlayClick", self.dashboard_js)
        self.assertIn("team-radio-play-btn", self.dashboard_js)

    def test_session_switch_stops_playback(self):
        self.assertIn("function stopTeamRadioPlayback", self.dashboard_js)
        self.assertIn("stopTeamRadioPlayback();", self.dashboard_js)

    def test_race_control_feed_merges_team_radio_entries(self):
        self.assertIn("function buildRaceControlFeedEntries", self.dashboard_js)
        self.assertIn("function renderTeamRadioFeedItem", self.dashboard_js)
        self.assertIn("race-control-type-team-radio", self.dashboard_js)
        self.assertIn("radio clips", self.dashboard_js)

    def test_replay_ticker_follows_playhead(self):
        self.assertIn("REPLAY_TEAM_RADIO_MAX_AGE_MS", self.dashboard_js)
        self.assertIn("function latestReplayTeamRadioAt", self.dashboard_js)
        self.assertIn("function updateReplayTeamRadioTicker", self.dashboard_js)
        self.assertIn("function clearReplayTeamRadioTicker", self.dashboard_js)
        self.assertIn("updateReplayTeamRadioTicker();", self.dashboard_js)
        self.assertIn("clearReplayTeamRadioTicker();", self.dashboard_js)

    def test_team_radio_has_dedicated_styles(self):
        self.assertIn(".race-control-toggles", self.styles_css)
        self.assertIn(".race-control-type-team-radio", self.styles_css)
        self.assertIn(".team-radio-play-btn", self.styles_css)
        self.assertIn(".team-radio-clip-time", self.styles_css)
        self.assertIn(".replay-team-radio-ticker", self.styles_css)


if __name__ == "__main__":
    unittest.main()
