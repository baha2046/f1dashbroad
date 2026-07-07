import unittest
from pathlib import Path

from js_sources import read_dashboard_js


class SessionLoadStaleGuardTests(unittest.TestCase):
    """Phase 0 stale-response guards for session switching
    (doc/2026-07-07-project-review-and-enhancement-plan.md, 2.2)."""

    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.dashboard_js = read_dashboard_js(root)

    def test_select_session_uses_a_load_token(self):
        self.assertIn("let sessionLoadSequence = 0;", self.dashboard_js)
        self.assertIn("const loadToken = ++sessionLoadSequence;", self.dashboard_js)
        # Parsed bodies are committed to state only after a staleness check
        self.assertIn("if (isStale()) return;", self.dashboard_js)

    def test_load_sessions_uses_a_list_token(self):
        self.assertIn("let sessionsListSequence = 0;", self.dashboard_js)
        self.assertIn("const loadToken = ++sessionsListSequence;", self.dashboard_js)


if __name__ == "__main__":
    unittest.main()
