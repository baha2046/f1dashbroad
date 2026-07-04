# Race Control Feed Visual Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve messages in the "race control" tab by replacing driver raw strings like "CAR 12 (ANT)" with team-colored inline names and grouping messages by lap with sticky headers.

**Architecture:** 
1. Implement a regex-based parser in frontend JS to replace text like `CAR 12 (ANT)` with a styled inline HTML pill highlighting the driver's full name, number, and team color.
2. Group race control messages chronologically by lap number, rendering them under sticky section headers.
3. Design and implement premium styles (with glassmorphism and theme color glow properties) for the inline driver pills and group headers.

**Tech Stack:** JavaScript (ES6), CSS (Vanilla), Python unittest (for verification).

## Global Constraints

- Keep implementation documents under the `doc/` directory.
- Use Python in `.venv/bin/python3` for testing the web app.

---

### Task 1: Update Static Wiring Tests (TDD failing checks)

**Files:**
- Modify: `tests/test_race_control_feed.py`

**Interfaces:**
- Consumes: None
- Produces: Failing test assertions verifying JS parser function and CSS class wiring.

- [ ] **Step 1: Modify tests/test_race_control_feed.py to add assertions for the new structures**
  Add assertions checking for `formatDriversInMessage`, `driver-inline-pill` and `race-control-group-header`.

  Replace `tests/test_race_control_feed.py:49-77` with:
  ```python
  class RaceControlFeedStaticWiringTests(unittest.TestCase):
      def setUp(self):
          self.root = Path(__file__).resolve().parents[1]
          self.index_html = (self.root / "templates" / "index.html").read_text(encoding="utf-8")
          self.dashboard_js = read_dashboard_js(self.root)
          self.styles_css = (self.root / "static" / "css" / "styles.css").read_text(encoding="utf-8")

      def test_dashboard_contains_race_control_tab_and_feed_container(self):
          self.assertIn('data-tab="race-control-view"', self.index_html)
          self.assertIn('id="raceControlFeed"', self.index_html)
          self.assertIn('id="raceControlEmptyState"', self.index_html)
          self.assertIn('id="showBlueFlags"', self.index_html)

      def test_dashboard_renders_loaded_race_control_messages(self):
          self.assertIn("raceControlFeed: document.getElementById('raceControlFeed')", self.dashboard_js)
          self.assertIn("raceControlEmptyState: document.getElementById('raceControlEmptyState')", self.dashboard_js)
          self.assertIn("showBlueFlags: document.getElementById('showBlueFlags')", self.dashboard_js)
          self.assertIn("function renderRaceControlFeed()", self.dashboard_js)
          self.assertIn("renderRaceControlFeed();", self.dashboard_js)
          self.assertIn("race-control-item", self.dashboard_js)
          self.assertIn("function formatDriversInMessage", self.dashboard_js)
          self.assertIn("driver-inline-pill", self.dashboard_js)
          self.assertIn("race-control-group-header", self.dashboard_js)

      def test_race_control_feed_has_dedicated_compact_styles(self):
          self.assertIn(".race-control-container", self.styles_css)
          self.assertIn(".race-control-feed", self.styles_css)
          self.assertIn(".race-control-item", self.styles_css)
          self.assertIn(".race-control-meta-pill", self.styles_css)
          self.assertIn(".race-control-toggle", self.styles_css)
          self.assertIn(".race-control-group-header", self.styles_css)
          self.assertIn(".driver-inline-pill", self.styles_css)
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `.venv/bin/python3 -m unittest tests/test_race_control_feed.py`
  Expected: FAIL (with assertions failing on `formatDriversInMessage` or `.race-control-group-header` not found)

- [ ] **Step 3: Commit**
  ```bash
  git add tests/test_race_control_feed.py
  git commit -m "test: add TDD wiring tests for race control enhancements"
  ```

---

### Task 2: Implement CSS Styles

**Files:**
- Modify: `static/css/styles.css`

**Interfaces:**
- Consumes: None
- Produces: CSS rules for sticky lap grouping headers and inline driver pills.

- [ ] **Step 1: Add style rules to static/css/styles.css**
  Append the following lines to the end of `static/css/styles.css`:
  ```css
  /* Group Headers & Sticky behavior */
  .race-control-group {
      display: flex;
      flex-direction: column;
  }
  
  .race-control-group-header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(22, 22, 30, 0.95);
      backdrop-filter: blur(12px);
      padding: 8px 18px;
      border-bottom: 1px solid var(--border-color);
      font-weight: 800;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 1px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
  }

  /* Inline Driver Pills inside Messages */
  .driver-inline-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(var(--team-color-rgb), 0.12);
      border: 1px solid rgba(var(--team-color-rgb), 0.28);
      border-left: 4px solid var(--team-color);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0 2px;
      vertical-align: middle;
  }

  .driver-pill-name {
      font-weight: 700;
  }

  .driver-pill-number {
      font-size: 10px;
      opacity: 0.8;
      font-family: monospace;
  }

  /* Meta Pill team color dot */
  .driver-pill-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-right: 6px;
      display: inline-block;
  }
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add static/css/styles.css
  git commit -m "style: add styles for sticky lap headers and inline driver pills"
  ```

---

### Task 3: Implement Frontend JS Logic

**Files:**
- Modify: `static/js/06-overview-tabs.js`

**Interfaces:**
- Consumes: `state.raceControl`, `state.drivers`
- Produces: `formatDriversInMessage` function and updated `renderRaceControlFeed` using sticky lap grouping and formatted driver pills.

- [ ] **Step 1: Write formatDriversInMessage helper and update renderRaceControlFeed in static/js/06-overview-tabs.js**
  Replace `static/js/06-overview-tabs.js:737-807` with the following implementation:
  ```javascript
  function formatDriversInMessage(messageText) {
      let escaped = escapeHtml(messageText || '');
      // Regex to match e.g. CAR 12 (ANT) or CARS 11 (PER) or 30 (LAW)
      const regex = /(?:CAR(?:S)?\s+)?(\d+)\s*\(([A-Z]{3})\)/gi;
      return escaped.replace(regex, (match, driverNumStr, acronym) => {
          const num = parseInt(driverNumStr, 10);
          const driver = state.drivers ? state.drivers.find(d => d.driver_number === num || (d.name_acronym || '').toUpperCase() === acronym.toUpperCase()) : null;
          if (driver) {
              const teamHex = getDriverTeamHex(driver);
              const fullName = `${driver.first_name || ''} ${driver.last_name || driver.broadcast_name || ''}`.trim();
              const rgb = getRGBColor(teamHex);
              return `<span class="driver-inline-pill" style="--team-color: #${teamHex}; --team-color-rgb: ${rgb};">` +
                     `<span class="driver-pill-name">${escapeHtml(fullName)}</span>` +
                     `<span class="driver-pill-number">#${num}</span>` +
                     `</span>`;
          }
          return match;
      });
  }

  function renderRaceControlFeed() {
      if (!DOM.raceControlFeed || !DOM.raceControlEmptyState) return;

      if (!state.raceControl || state.raceControl.length === 0) {
          DOM.raceControlFeed.style.display = 'none';
          DOM.raceControlEmptyState.style.display = 'flex';
          if (DOM.raceControlSummary) {
              DOM.raceControlSummary.textContent = 'No session messages recorded';
          }
          return;
      }

      const showBlueFlags = DOM.showBlueFlags ? DOM.showBlueFlags.checked : true;
      let filteredMessages = [...state.raceControl];
      if (!showBlueFlags) {
          filteredMessages = filteredMessages.filter(item => getRaceControlType(item) !== 'BLUE');
      }

      if (filteredMessages.length === 0) {
          DOM.raceControlFeed.style.display = 'none';
          DOM.raceControlEmptyState.style.display = 'flex';
          if (DOM.raceControlSummary) {
              DOM.raceControlSummary.textContent = 'No session messages recorded (excluding blue flags)';
          }
          return;
      }

      DOM.raceControlEmptyState.style.display = 'none';
      DOM.raceControlFeed.style.display = 'flex';

      const sortedMessages = filteredMessages.sort((a, b) => {
          return (b.date || '').localeCompare(a.date || '');
      });

      if (DOM.raceControlSummary) {
          const incidentCount = sortedMessages.filter(item => {
              const msg = (item.message || '').toUpperCase();
              return msg.includes('INCIDENT') || msg.includes('PENALTY') || msg.includes('INVESTIGAT');
          }).length;
          DOM.raceControlSummary.textContent = `${sortedMessages.length} messages, ${incidentCount} incident updates`;
      }

      // Group contiguous messages by lap
      const groups = [];
      let currentGroup = null;

      sortedMessages.forEach((item) => {
          const lap = (item.lap_number !== null && item.lap_number !== undefined) ? item.lap_number : null;
          if (!currentGroup || currentGroup.lap !== lap) {
              currentGroup = {
                  lap: lap,
                  messages: []
              };
              groups.push(currentGroup);
          }
          currentGroup.messages.push(item);
      });

      DOM.raceControlFeed.innerHTML = groups.map(group => {
          let groupTitle = '';
          let groupClass = '';
          if (group.lap === null) {
              groupTitle = 'General Notices';
              groupClass = 'race-control-group-general';
          } else {
              groupTitle = `Lap ${group.lap}`;
              groupClass = 'race-control-group-lap';
          }

          const messagesHtml = group.messages.map(item => {
              const typeLabel = getRaceControlType(item);
              const typeClass = getRaceControlClass(typeLabel);
              const driver = item.driver_number ? state.drivers.find(d => d.driver_number === item.driver_number) : null;
              
              let driverLabel = '';
              let driverColorBar = '';
              let driverPillClass = '';
              
              if (driver) {
                  const teamHex = getDriverTeamHex(driver);
                  driverLabel = `${driver.first_name || ''} ${driver.last_name || driver.broadcast_name || ''}`.trim();
                  driverColorBar = `<span class="driver-pill-dot" style="background: #${teamHex};"></span>`;
                  driverPillClass = 'has-driver';
              } else if (item.driver_number) {
                  driverLabel = `Car ${item.driver_number}`;
              }

              const metaItems = [
                  driverLabel ? `<span class="race-control-meta-pill ${driverPillClass}">${driverColorBar}${escapeHtml(driverLabel)}</span>` : '',
                  item.scope ? `<span class="race-control-meta-pill">${escapeHtml(item.scope)}</span>` : '',
                  item.sector !== null && item.sector !== undefined ? `<span class="race-control-meta-pill">Sector ${escapeHtml(item.sector)}</span>` : ''
              ].filter(Boolean);

              const parsedMessage = formatDriversInMessage(item.message || 'Race control notice');

              return `
                  <article class="race-control-item">
                      <div class="race-control-time">${escapeHtml(formatRaceControlTime(item.date))}</div>
                      <div class="race-control-main">
                          <div class="race-control-row">
                              <span class="race-control-type ${typeClass}">${escapeHtml(typeLabel)}</span>
                              <div class="race-control-meta">
                                  ${metaItems.join('')}
                              </div>
                          </div>
                          <p class="race-control-message">${parsedMessage}</p>
                      </div>
                  </article>
              `;
          }).join('');

          return `
              <div class="race-control-group">
                  <header class="race-control-group-header ${groupClass}">
                      <span class="race-control-group-title">${groupTitle}</span>
                  </header>
                  <div class="race-control-group-items">
                      ${messagesHtml}
                  </div>
              </div>
          `;
      }).join('');
  }
  ```

- [ ] **Step 2: Run test to verify it passes**
  Run: `.venv/bin/python3 -m unittest tests/test_race_control_feed.py`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add static/js/06-overview-tabs.js
  git commit -m "feat: implement inline driver badge parsing and sticky lap grouping in race control feed"
  ```
