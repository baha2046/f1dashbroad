"""Shared helper for static-wiring tests.

The former static/js/dashboard.js is split into ordered files that share the
global scope. Tests that assert on the dashboard JS source read the
concatenation, in load order (numeric filename prefixes match the script-tag
order in templates/index.html).
"""
from pathlib import Path


def read_dashboard_js(root):
    js_dir = Path(root) / "static" / "js"
    return "\n".join(
        path.read_text(encoding="utf-8") for path in sorted(js_dir.glob("*.js"))
    )
