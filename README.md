# F1 Data Dashboard Application

A high-performance, responsive Formula 1 data dashboard application utilizing the **OpenF1 API** (`https://openf1.org`).
The app is built with **Python Quart** (an asynchronous web microframework) on the backend and **Vanilla CSS + Javascript** on the frontend. It features a modern, dark glassmorphic design and local caching for API responses.

## Key Features

1. **Year Selection & Filter:** Toggle between 2026, 2025, 2024, and 2023 session lists.
2. **Session Browser:** Search and filter sessions (Races, Qualifying, and Practice) with visual indicators for each session type.
3. **Weather Widget:** View air/track temperatures, humidity, wind speeds, and rainfall warnings aggregated from the OpenF1 weather telemetry endpoint.
4. **Dynamic Drivers Grid:** Browse all drivers for a selected session, displaying headshots, acronyms, and dynamic styling borders/glows reflecting official F1 team colors.
5. **Interactive Laps & Stints Tab:**
   - **Tire Stints Timeline:** Visualizes tire compound stint durations (proportional widths) with correct F1 compound color schemes (Soft/Medium/Hard/Inters/Wets).
   - **All Lap Times Table:** Displays sector breakdowns and highlights the driver's fastest lap duration in the session.
6. **Smart File-based Cache:** Local JSON storage prevents API rate limits and speeds up repeated loads.

---

## Technical Stack

* **Backend:** Python 3.14+, Quart (Async Flask alternative), HTTPX (Async HTTP Client).
* **Frontend:** Modern HTML5, Vanilla CSS (Glassmorphism design tokens), Native JS (Async/Await API fetching).
* **Caching:** Flat-file JSON store under `data_cache/` with smart TTL rules:
  - Historical data (ended > 24 hours ago) cached permanently.
  - Active/future sessions cached with a short 5-minute TTL.
  - Current session list cached for 1 hour.

---

## Getting Started

### Prerequisites

* Python 3.14+ (or Python 3.9+)
* Virtual environment (`.venv`) initialized.

### Installation

1. Install required packages in your virtual environment:
   ```bash
   .venv/bin/pip install -r requirements.txt
   ```

2. Run the application:
   ```bash
   .venv/bin/python app.py
   ```
   The application will boot on **port 5300** as requested (`http://localhost:5300`).

### Folder Structure

```
├── .gitignore
├── README.md
├── app.py
├── requirements.txt
├── data_cache/           # Created automatically to store cached API responses
├── templates/
│   └── index.html        # Main dashboard HTML template
└── static/
    ├── css/
    │   └── styles.css    # Premium CSS design tokens & layouts
    └── js/
        └── dashboard.js  # Frontend states, event listeners, & render logic
```
