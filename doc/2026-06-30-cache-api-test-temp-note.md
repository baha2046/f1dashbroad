# Cache API Test Temp Note

The cache-backed API tests now create their scratch cache files under `tests/.tmp/` instead of using the system default temporary directory. This keeps pit annotation verification inside the project-local writable tree while still patching `app.CACHE_DIR` to exercise the same cached response path.

`tests/.tmp/` is ignored by git and each async API test removes its own method-specific cache directory during setup and teardown.
