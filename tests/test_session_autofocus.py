import json
import subprocess
import textwrap
import unittest
from pathlib import Path


class SessionAutoFocusTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.dashboard_js = (self.root / "static" / "js" / "dashboard.js").read_text(encoding="utf-8")

    def _extract_function(self, function_name):
        marker = f"function {function_name}"
        start = self.dashboard_js.find(marker)
        self.assertNotEqual(start, -1, f"{function_name} is missing from dashboard.js")

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

    def _focus_session_key(self, sessions, now):
        selector_functions = "\n\n".join([
            self._extract_function("findLatestRaceEvent"),
            self._extract_function("findInitialFocusSession"),
        ])
        script = textwrap.dedent(f"""
            {selector_functions}

            const sessions = {json.dumps(sessions)};
            const selected = findInitialFocusSession(sessions, new Date({json.dumps(now)}));
            console.log(JSON.stringify(selected ? selected.session_key : null));
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

    def test_autofocus_prefers_live_session_from_current_weekend_over_latest_race(self):
        sessions = [
            {
                "session_key": 101,
                "session_type": "Race",
                "session_name": "Race",
                "meeting_key": 1,
                "date_start": "2026-06-21T13:00:00+00:00",
                "date_end": "2026-06-21T15:00:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 201,
                "session_type": "Practice",
                "session_name": "Practice 1",
                "meeting_key": 2,
                "date_start": "2026-06-26T11:30:00+00:00",
                "date_end": "2026-06-26T12:30:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 202,
                "session_type": "Practice",
                "session_name": "Practice 2",
                "meeting_key": 2,
                "date_start": "2026-06-26T15:00:00+00:00",
                "date_end": "2026-06-26T16:00:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 203,
                "session_type": "Race",
                "session_name": "Race",
                "meeting_key": 2,
                "date_start": "2026-06-28T13:00:00+00:00",
                "date_end": "2026-06-28T15:00:00+00:00",
                "is_cancelled": False,
            },
        ]

        self.assertEqual(
            self._focus_session_key(sessions, "2026-06-26T15:15:00+00:00"),
            202,
        )

    def test_autofocus_uses_most_recent_current_weekend_session_between_sessions(self):
        sessions = [
            {
                "session_key": 101,
                "session_type": "Race",
                "session_name": "Race",
                "meeting_key": 1,
                "date_start": "2026-06-21T13:00:00+00:00",
                "date_end": "2026-06-21T15:00:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 201,
                "session_type": "Practice",
                "session_name": "Practice 1",
                "meeting_key": 2,
                "date_start": "2026-06-26T11:30:00+00:00",
                "date_end": "2026-06-26T12:30:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 202,
                "session_type": "Qualifying",
                "session_name": "Sprint Qualifying",
                "meeting_key": 2,
                "date_start": "2026-06-26T15:00:00+00:00",
                "date_end": "2026-06-26T15:44:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 203,
                "session_type": "Race",
                "session_name": "Sprint",
                "meeting_key": 2,
                "date_start": "2026-06-27T11:00:00+00:00",
                "date_end": "2026-06-27T12:00:00+00:00",
                "is_cancelled": False,
            },
            {
                "session_key": 204,
                "session_type": "Race",
                "session_name": "Race",
                "meeting_key": 2,
                "date_start": "2026-06-28T13:00:00+00:00",
                "date_end": "2026-06-28T15:00:00+00:00",
                "is_cancelled": False,
            },
        ]

        self.assertEqual(
            self._focus_session_key(sessions, "2026-06-26T16:30:00+00:00"),
            202,
        )


if __name__ == "__main__":
    unittest.main()
