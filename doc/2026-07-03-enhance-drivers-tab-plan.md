# Enhance Drivers Tab Information Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the F1 dashboard's Drivers tab and Laps & Stints panel by integrating driver nationality flags, birthdate age calculation, and a Wikipedia profile link from f1api.dev.

**Architecture:** Fetch and cache driver data from `f1api.dev` on the backend, merge it with OpenF1 driver details, and display it inline in the drivers grid and selected driver profile header in the frontend.

**Tech Stack:** Quart, Python (httpx), HTML, CSS, JavaScript.

## Global Constraints
- Use python in .venv/bin/python3 for testing the web app.
- Keep implement documents in doc/.

---

### Task 1: Backend Integration in `app.py`

**Files:**
- Modify: `app.py`

**Interfaces:**
- Consumes: Existing caching and request helpers.
- Produces: Enhanced JSON response from `/api/drivers` containing `nationality`, `nationality_flag`, `birthday`, and `wiki_url`.

- [ ] **Step 1: Define `NATIONALITY_TO_FLAG` mapping**
  Add the `NATIONALITY_TO_FLAG` mapping below `app = Quart(__name__)` and `CACHE_DIR`:
  ```python
  NATIONALITY_TO_FLAG = {
      'argentina': '🇦🇷',
      'australia': '🇦🇺',
      'austria': '🇦🇹',
      'azerbaijan': '🇦🇿',
      'belgium': '🇧🇪',
      'brazil': '🇧🇷',
      'bahrain': '🇧🇭',
      'canada': '🇨🇦',
      'china': '🇨🇳',
      'denmark': '🇩🇰',
      'finland': '🇫🇮',
      'france': '🇫🇷',
      'germany': '🇩🇪',
      'great britain': '🇬🇧',
      'british': '🇬🇧',
      'italy': '🇮🇹',
      'japan': '🇯🇵',
      'mexico': '🇲🇽',
      'monaco': '🇲🇨',
      'netherlands': '🇳🇱',
      'dutch': '🇳🇱',
      'new zealand': '🇳🇿',
      'spain': '🇪🇸',
      'thailand': '🇹🇭',
      'united states': '🇺🇸',
      'american': '🇺🇸',
      'switzerland': '🇨🇭',
      'swiss': '🇨🇭',
      'sweden': '🇸🇪',
      'swedish': '🇸🇪',
      'poland': '🇵🇱',
      'polish': '🇵🇱',
      'russia': '🇷🇺',
      'russian': '🇷🇺',
      'india': '🇮🇳',
      'indian': '🇮🇳',
      'venezuela': '🇻🇪',
      'indonesia': '🇮🇩',
      'colombia': '🇨🇴',
  }
  ```

- [ ] **Step 2: Add session year detection helper**
  Add `find_session_year` to `app.py`:
  ```python
  def find_session_year(session_key):
      if not session_key:
          return 2026
      try:
          skey = int(session_key)
      except ValueError:
          return 2026
          
      for filename in os.listdir(CACHE_DIR):
          if filename.startswith("sessions_") and filename.endswith(".json"):
              try:
                  with open(os.path.join(CACHE_DIR, filename), "r", encoding="utf-8") as f:
                      sessions = json.load(f)
                      for s in sessions:
                          if s.get("session_key") == skey:
                              return s.get("year", 2026)
              except Exception:
                  pass
      return 2026
  ```

- [ ] **Step 3: Add `get_f1api_drivers` helper**
  Add `get_f1api_drivers` to `app.py`:
  ```python
  async def get_f1api_drivers(year):
      url = f"https://f1api.dev/api/{year}/drivers"
      cache_name = f"f1api_drivers_{year}.json"
      cache_path = os.path.join(CACHE_DIR, cache_name)
      
      ttl = 86400  # 1 day
      if int(year) < 2026:
          ttl = None  # permanent for past years
          
      if os.path.exists(cache_path):
          mtime = os.path.getmtime(cache_path)
          age = datetime.now().timestamp() - mtime
          if ttl is None or age < ttl:
              try:
                  with open(cache_path, "r", encoding="utf-8") as f:
                      return json.load(f)
              except Exception:
                  pass
                  
      try:
          async with httpx.AsyncClient() as client:
              response = await client.get(url, timeout=10.0)
              response.raise_for_status()
              data = response.json()
              drivers = data.get("drivers", [])
              with open(cache_path, "w", encoding="utf-8") as f:
                  json.dump(drivers, f, ensure_ascii=False)
              return drivers
      except Exception as e:
          print(f"Error fetching f1api drivers: {e}")
          if os.path.exists(cache_path):
              try:
                  with open(cache_path, "r", encoding="utf-8") as f:
                      return json.load(f)
              except Exception:
                  pass
          return []
  ```

- [ ] **Step 4: Update `/api/drivers` route**
  Modify `/api/drivers` in `app.py` to merge `f1api.dev` fields:
  ```python
  @app.route("/api/drivers")
  async def api_drivers():
      session_key = request.args.get("session_key")
      if not session_key:
          return jsonify({"error": "session_key is required"}), 400
      
      url = f"https://api.openf1.org/v1/drivers?session_key={session_key}"
      cache_name = f"drivers_{session_key}.json"
      api_key = request.headers.get("X-OpenF1-Key")
      
      openf1_drivers = await get_cached_api(url, cache_name, session_key=session_key, api_key=api_key)
      
      year = request.args.get("year")
      if not year:
          year = find_session_year(session_key)
          
      f1api_drivers = await get_f1api_drivers(year)
      
      f1api_map = {}
      for d in f1api_drivers:
          num = d.get("number")
          if num is not None:
              f1api_map[int(num)] = d
              
      if isinstance(openf1_drivers, list):
          for d in openf1_drivers:
              driver_number = d.get("driver_number")
              if driver_number is not None:
                  extra = f1api_map.get(int(driver_number))
                  if extra:
                      d["nationality"] = extra.get("nationality")
                      nationality_key = str(extra.get("nationality", "")).lower()
                      d["nationality_flag"] = NATIONALITY_TO_FLAG.get(nationality_key, "🏳️")
                      d["birthday"] = extra.get("birthday")
                      d["wiki_url"] = extra.get("url")
                      d["driver_id"] = extra.get("driverId")
                      
      return jsonify(openf1_drivers)
  ```

- [ ] **Step 5: Verify the backend endpoint**
  Start Quart backend and query the API using `.venv/bin/python3` or curl:
  Run: `.venv/bin/python3 -c "import httpx; r = httpx.get('http://127.0.0.1:5000/api/drivers?session_key=11465'); print(r.json()[0])"`
  Expected: Output containing `nationality_flag`, `birthday`, and `wiki_url` keys.

- [ ] **Step 6: Commit backend changes**
  ```bash
  git add app.py
  git commit -m "feat(backend): merge f1api.dev extra details to /api/drivers route"
  ```

---

### Task 2: Frontend HTML Placeholder Elements

**Files:**
- Modify: `templates/index.html`

**Interfaces:**
- Produces: HTML placeholders `statsDriverFlag`, `statsDriverAge`, and `statsDriverWiki` inside the driver profile card header on the Laps & Stints tab.

- [ ] **Step 1: Add HTML placeholders in index.html**
  Modify lines 239-242 of `templates/index.html`:
  ```html
                                      <div class="driver-profile-text">
                                          <h4 id="statsDriverName">Lewis Hamilton</h4>
                                          <div class="driver-profile-meta" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                                              <p id="statsDriverTeam" style="margin: 0;">Ferrari</p>
                                              <span id="statsDriverFlag" style="font-size: 16px;"></span>
                                              <span id="statsDriverAge" style="font-size: 12px; background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 4px; color: var(--text-secondary);"></span>
                                              <a id="statsDriverWiki" href="#" target="_blank" style="display: inline-flex; align-items: center; color: var(--text-muted); text-decoration: none;" title="Open Wikipedia Profile"><span class="material-icons-round" style="font-size: 14px;">open_in_new</span></a>
                                          </div>
                                      </div>
  ```

- [ ] **Step 2: Commit HTML changes**
  ```bash
  git add templates/index.html
  git commit -m "feat(frontend): add DOM placeholders for driver profile meta in index.html"
  ```

---

### Task 3: Frontend JS Implementation

**Files:**
- Modify: `static/js/dashboard.js`

- [ ] **Step 1: Map DOM selectors in dashboard.js**
  Add elements to `DOM` mapping in `static/js/dashboard.js` (around line 161):
  ```javascript
      statsDriverFlag: document.getElementById('statsDriverFlag'),
      statsDriverAge: document.getElementById('statsDriverAge'),
      statsDriverWiki: document.getElementById('statsDriverWiki'),
  ```

- [ ] **Step 2: Add dynamic age calculation helper**
  Add `calculateAgeAtDate` below `getDriverTeamHex` helper in `static/js/dashboard.js`:
  ```javascript
  function calculateAgeAtDate(birthdayStr, targetDateStr) {
      if (!birthdayStr) return null;
      try {
          let birthDate;
          birthdayStr = birthdayStr.trim();
          if (birthdayStr.includes('/')) {
              const parts = birthdayStr.split('/');
              if (parts.length === 3) {
                  if (parts[0].length === 4) {
                      birthDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                  } else {
                      birthDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
                  }
              }
          } else {
              birthDate = new Date(birthdayStr);
          }

          if (isNaN(birthDate.getTime())) return null;

          const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
          if (isNaN(targetDate.getTime())) return null;

          let age = targetDate.getFullYear() - birthDate.getFullYear();
          const m = targetDate.getMonth() - birthDate.getMonth();
          if (m < 0 || (m === 0 && targetDate.getDate() < birthDate.getDate())) {
              age--;
          }
          return age;
      } catch (e) {
          console.error('Error calculating age:', e);
          return null;
      }
  }
  ```

- [ ] **Step 3: Update `renderDriversGrid()` cards**
  Modify `renderDriversGrid()` (around line 1701) to construct and append the inline metadata row (`.driver-meta`). Make sure the card click listener maps the wiki links' stopPropagation:
  ```javascript
          const age = calculateAgeAtDate(d.birthday, state.selectedSession ? state.selectedSession.date_start : null);
          card.innerHTML = `
              <div class="driver-card-top">
                  <div class="driver-info">
                      <div class="driver-team">${d.team_name || 'Independent'}</div>
                      <div class="driver-name">${d.first_name} ${d.last_name}</div>
                      <div class="driver-acronym">${d.name_acronym || ''}</div>
                      <div class="driver-meta">
                          ${d.nationality_flag ? `<span class="driver-flag" title="${d.nationality || ''}">${d.nationality_flag}</span>` : ''}
                          ${age ? `<span class="driver-age">${age} yrs</span>` : ''}
                          ${d.wiki_url ? `<a href="${d.wiki_url}" target="_blank" class="driver-wiki-link" title="Wikipedia Page"><span class="material-icons-round">open_in_new</span></a>` : ''}
                      </div>
                  </div>
                  <div class="driver-number-badge">${d.driver_number}</div>
              </div>
              <div class="driver-watermark-number">${d.driver_number}</div>
              <div class="driver-headshot-container">
                  <img src="${headshot.replace('.transform/1col/image.png', '')}" class="driver-headshot" alt="${d.full_name}" onerror="this.src='https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/'">
              </div>
          `;

          card.addEventListener('click', () => {
              const lapsTab = document.getElementById('tab-laps');
              lapsTab.click();
              selectDriverForStats(d.driver_number);
          });

          // Prevent switching tabs when clicking Wikipedia link
          const wikiLink = card.querySelector('.driver-wiki-link');
          if (wikiLink) {
              wikiLink.addEventListener('click', (e) => {
                  e.stopPropagation();
              });
          }
  ```

- [ ] **Step 4: Update `selectDriverForStats()` profile display**
  Modify `selectDriverForStats()` (around line 4003) to render flag, age, and wikipedia link:
  ```javascript
          // Render flag, age, and wiki link
          const age = calculateAgeAtDate(d.birthday, state.selectedSession ? state.selectedSession.date_start : null);
          
          if (DOM.statsDriverFlag) {
              if (d.nationality_flag) {
                  DOM.statsDriverFlag.textContent = d.nationality_flag;
                  DOM.statsDriverFlag.title = d.nationality || '';
                  DOM.statsDriverFlag.style.display = 'inline';
              } else {
                  DOM.statsDriverFlag.style.display = 'none';
              }
          }

          if (DOM.statsDriverAge) {
              if (age) {
                  DOM.statsDriverAge.textContent = `${age} yrs`;
                  DOM.statsDriverAge.style.display = 'inline-block';
              } else {
                  DOM.statsDriverAge.style.display = 'none';
              }
          }

          if (DOM.statsDriverWiki) {
              if (d.wiki_url) {
                  DOM.statsDriverWiki.href = d.wiki_url;
                  DOM.statsDriverWiki.style.display = 'inline-flex';
              } else {
                  DOM.statsDriverWiki.style.display = 'none';
              }
          }
  ```

- [ ] **Step 5: Commit Javascript changes**
  ```bash
  git add static/js/dashboard.js
  git commit -m "feat(frontend): implement age calculation and populate metadata in drivers grid and Laps tab"
  ```

---

### Task 4: Frontend CSS Styles

**Files:**
- Modify: `static/css/styles.css`

- [ ] **Step 1: Add css styles**
  Append these styles to `static/css/styles.css`:
  ```css
  /* Driver card enhanced metadata styles */
  .driver-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 12px;
      color: var(--text-secondary);
      z-index: 3;
  }

  .driver-flag {
      font-size: 16px;
      line-height: 1;
      cursor: help;
  }

  .driver-age {
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 500;
  }

  .driver-wiki-link {
      display: inline-flex;
      align-items: center;
      color: var(--text-muted);
      transition: var(--transition-normal);
  }

  .driver-wiki-link:hover {
      color: var(--text-primary);
  }

  .driver-wiki-link span {
      font-size: 14px;
  }
  ```

- [ ] **Step 2: Commit CSS changes**
  ```bash
  git add static/css/styles.css
  git commit -m "style(frontend): style driver meta row and Wikipedia links"
  ```
