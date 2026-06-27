# F1 Data Dashboard Application Walkthrough

The Formula 1 Data Dashboard application has been successfully created, verified, and committed. The application runs on **port 5300** and serves a highly polished, responsive dashboard visualizer for OpenF1 API telemetry.

## Achievements & Features

1. **Robust Async Backend (`app.py`):**
   - Built on python **Quart**, enabling async routing to support high concurrent workloads.
   - Smart local caching implemented under `data_cache/` with automatic rules:
     - Year-wide sessions and upcoming sessions are checked with a short TTL (1h for year, 5m for active sessions).
     - Completed sessions (> 24 hours in the past) are cached permanently as flat JSON files to avoid API query limit ceilings.
     - Extends core session and driver endpoints with support for **weather**, **tire stints**, and **lap-by-lap timing details**.

2. **Premium Dark Modern Frontend:**
   - **HTML Layout (`templates/index.html`):** Uses modern semantic structure (side-by-side aside/main layout) with Outfit-style fonts (Inter) and Google Material Icons.
   - **CSS Stylesheet (`static/css/styles.css`):** Fully custom glassmorphic styling system (`backdrop-filter: blur(12px)`) with glowing shadows, styled scrollbars, and customized F1 tire compound badges (Soft, Medium, Hard, Inters, Wets).
   - **Dynamic Interactivity (`static/js/dashboard.js`):** Responsive grid layout updates automatically on year, search, session type, or driver filter queries. Renders stint timelines dynamically with proportional compound widths, tooltips, and highlights the fastest lap in the timing table.

3. **F1 Team Accent Colors Integration:**
   - Dynamically parses the OpenF1 `team_colour` string to set CSS Custom Variables (`--team-color`, `--team-color-glow`) inline on driver cards and statistics pills.
   - Displays driver cards with overlapping 3D headshots and giant faded watermark numbers for a premium broadcast look.

---

## Codebase Status & Git

- Initialized Git and configured `.gitignore` to omit `.venv/`, `.idea/`, python caches, and `data_cache/`.
- Committed all files:
  ```bash
  git commit -m "Initial commit of F1 Data Dashboard App"
  ```
- Compiled python script successfully using `py_compile`.
- Launched the background Quart server (running on port `5300`).
- Validated endpoints using `curl`:
  - `/` (HTML) returns code `200`
  - `/api/sessions?year=2026` returns `200` with JSON data
  - `/api/drivers?session_key=11465` returns `200` with JSON data
  - `/api/weather?session_key=11465` returns `200` with JSON data
  - Confirmed cached files were created in `data_cache/`.

---

## How to Run

1. Activate your virtual environment and install dependencies:
   ```bash
   .venv/bin/pip install -r requirements.txt
   ```
2. Run the application:
   ```bash
   .venv/bin/python app.py
   ```
3. Open `http://localhost:5300` in your web browser.
