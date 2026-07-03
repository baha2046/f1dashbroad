# Championship Standings UI Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Championship Standings tables under the Results tab with professional F1 elements including team colors, driver avatars, podium styles, trophies for wins, and country flag emojis.

**Architecture:** Update `static/js/dashboard.js` to cross-reference standings items against loaded driver objects (`state.drivers`) to retrieve team colors and driver headshot URLs, and update the table builders to insert styled DOM elements. Update `static/css/styles.css` to polish card borders and layout details.

**Tech Stack:** JavaScript (ES6+), Vanilla CSS, Python 3 / Quart (for backend verification).

## Global Constraints
- Keep implement documents in `doc/`.
- Use Python in `.venv/bin/python3` for testing the web app.

---

### Task 1: Update CSS Styles

**Files:**
- Modify: `static/css/styles.css:2729-2735`
- Modify: `static/css/styles.css:2791-2814`

**Interfaces:**
- Consumes: Existing styles in `static/css/styles.css`
- Produces: CSS rules for `.standings-panel`, `.constructor-color-dot`, and updated `.standings-points`.

- [ ] **Step 1: Modify CSS rules in static/css/styles.css**

Update `.standings-panel` border-radius to match standard cards (`12px` or `16px`). Add styling for the constructor color dot in driver standings.

In `static/css/styles.css`, replace lines 2729-2735:
```css
.standings-panel {
    min-width: 0;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: rgba(18, 18, 26, 0.45);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    overflow: hidden;
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
```

Add dot class and update points font weight:
```css
.constructor-color-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
```

- [ ] **Step 2: Commit CSS changes**
```bash
git add static/css/styles.css
git commit -m "style: enhance standings panel border-radius and add constructor dot styles"
```

---

### Task 2: Implement Standings Data Mapping and Rendering

**Files:**
- Modify: `static/js/dashboard.js` (above `renderRaceStandingsTables`)
- Modify: `static/js/dashboard.js` (inside `renderRaceStandingsTables`)

**Interfaces:**
- Consumes: `state.raceStandings`, `state.drivers`, `TEAM_COLORS`
- Produces: Enhanced `renderRaceStandingsTables()` with driver avatars, nationality flags, podium classes, and trophy emojis.

- [ ] **Step 1: Add NATIONALITY_TO_FLAG and findDriver helper to dashboard.js**

Add the nationality flag dictionary and driver resolution helper function above `renderRaceStandingsTables()`.

In `static/js/dashboard.js`, insert at line 1670:
```javascript
const NATIONALITY_TO_FLAG = {
    'argentina': '🇦🇷', 'argentinian': '🇦🇷', 'argentine': '🇦🇷',
    'australia': '🇦🇺', 'australian': '🇦🇺',
    'austria': '🇦🇹', 'austrian': '🇦🇹',
    'azerbaijan': '🇦🇿', 'azerbaijani': '🇦🇿',
    'belgium': '🇧🇪', 'belgian': '🇧🇪',
    'brazil': '🇧🇷', 'brazilian': '🇧🇷',
    'bahrain': '🇧🇭', 'bahraini': '🇧🇭',
    'canada': '🇨🇦', 'canadian': '🇨🇦',
    'china': '🇨🇳', 'chinese': '🇨🇳',
    'denmark': '🇩🇰', 'danish': '🇩🇰',
    'finland': '🇫🇮', 'finnish': '🇫🇮',
    'france': '🇫🇷', 'french': '🇫🇷',
    'germany': '🇩🇪', 'german': '🇩🇪',
    'great britain': '🇬🇧', 'british': '🇬🇧',
    'italy': '🇮🇹', 'italian': '🇮🇹',
    'japan': '🇯🇵', 'japanese': '🇯🇵',
    'mexico': '🇲🇽', 'mexican': '🇲🇽',
    'monaco': '🇲🇨', 'monegasque': '🇲🇨',
    'netherlands': '🇳🇱', 'dutch': '🇳🇱',
    'new zealand': '🇳🇿', 'new zealander': '🇳🇿',
    'spain': '🇪🇸', 'spanish': '🇪🇸',
    'thailand': '🇹🇭', 'thai': '🇹🇭',
    'united states': '🇺🇸', 'american': '🇺🇸',
    'switzerland': '🇨🇭', 'swiss': '🇨🇭',
    'sweden': '🇸🇪', 'swedish': '🇸🇪',
    'poland': '🇵🇱', 'polish': '🇵🇱',
    'russia': '🇷🇺', 'russian': '🇷🇺',
    'india': '🇮🇳', 'indian': '🇮🇳',
    'venezuela': '🇻🇪', 'venezuelan': '🇻🇪',
    'indonesia': '🇮🇩', 'indonesian': '🇮🇩',
    'colombia': '🇨🇴', 'colombian': '🇨🇴'
};

function getNationalityFlag(nationality) {
    if (!nationality) return '🏳️';
    const norm = nationality.trim().toLowerCase();
    return NATIONALITY_TO_FLAG[norm] || '🏳️';
}

function findDriver(standingItem) {
    const driver = standingItem.Driver || {};
    const permNum = parseInt(driver.permanentNumber);
    const code = (driver.code || '').toUpperCase();
    const familyName = (driver.familyName || '').toLowerCase();
    
    if (permNum && state.drivers) {
        const found = state.drivers.find(d => d.driver_number === permNum);
        if (found) return found;
    }
    if (code && state.drivers) {
        const found = state.drivers.find(d => (d.name_acronym || '').toUpperCase() === code);
        if (found) return found;
    }
    if (familyName && state.drivers) {
        const found = state.drivers.find(d => (d.last_name || '').toLowerCase() === familyName);
        if (found) return found;
    }
    return null;
}
```

- [ ] **Step 2: Update renderRaceStandingsTables() in dashboard.js**

Replace `renderRaceStandingsTables()` with the enhanced version matching the design spec.

```javascript
function renderRaceStandingsTables() {
    const standings = state.raceStandings;
    const driverStandings = standings && Array.isArray(standings.driver_standings)
        ? standings.driver_standings
        : [];
    const constructorStandings = standings && Array.isArray(standings.constructor_standings)
        ? standings.constructor_standings
        : [];

    if (!standings || (!driverStandings.length && !constructorStandings.length)) {
        if (DOM.raceStandingsWrapper) DOM.raceStandingsWrapper.style.display = 'none';
        if (DOM.driverStandingsTableBody) DOM.driverStandingsTableBody.innerHTML = '';
        if (DOM.constructorStandingsTableBody) DOM.constructorStandingsTableBody.innerHTML = '';
        return;
    }

    if (DOM.raceStandingsWrapper) DOM.raceStandingsWrapper.style.display = 'block';
    if (DOM.raceStandingsSummary) {
        const roundLabel = standings.round ? `Round ${standings.round}` : 'Selected round';
        const raceLabel = standings.race_name ? ` - ${standings.race_name}` : '';
        DOM.raceStandingsSummary.textContent = `${standings.season || state.selectedYear} ${roundLabel}${raceLabel}`;
    }

    if (DOM.driverStandingsTableBody) {
        DOM.driverStandingsTableBody.innerHTML = driverStandings.map((item) => {
            const driver = item.Driver || {};
            const constructors = Array.isArray(item.Constructors) ? item.Constructors : [];
            const constructorName = constructors[0] ? constructors[0].name : '-';
            const constructorId = constructors[0] ? constructors[0].constructorId : '';
            
            const localDriver = findDriver(item);
            
            let teamHex = '';
            if (localDriver && localDriver.team_colour) {
                teamHex = localDriver.team_colour;
            } else {
                const teamNameLower = (constructorName || '').toLowerCase();
                const teamIdLower = (constructorId || '').toLowerCase();
                teamHex = TEAM_COLORS[teamNameLower] || TEAM_COLORS[teamIdLower] || '787878';
            }
            teamHex = teamHex.replace('#', '');
            
            const driverName = [driver.givenName, driver.familyName].filter(Boolean).join(' ') || driver.code || '-';
            
            let avatarUrl = 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/';
            if (localDriver && localDriver.headshot_url) {
                avatarUrl = localDriver.headshot_url.replace('.transform/1col/image.png', '');
            }
            
            const position = parseInt(item.position);
            let posClass = 'pos-non-podium';
            if (position === 1) posClass = 'pos-podium-1';
            else if (position === 2) posClass = 'pos-podium-2';
            else if (position === 3) posClass = 'pos-podium-3';
            
            const wins = parseInt(item.wins) || 0;
            const winsDisplay = wins > 0 
                ? `${wins} <span class="material-icons-round" style="font-size: 14px; color: #FFD700; vertical-align: middle; margin-left: 2px;">emoji_events</span>`
                : `<span style="color: var(--text-muted);">${wins}</span>`;

            return `
                <tr>
                    <td class="results-position-cell ${posClass}">${escapeHtml(item.positionText || item.position || '-')}</td>
                    <td>
                        <div class="results-driver-cell">
                            <div class="results-team-color-indicator" style="background: #${teamHex};"></div>
                            <img src="${avatarUrl}" class="results-driver-avatar" alt="${driverName}" onerror="this.src='https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/'">
                            <div class="results-driver-info">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="results-driver-name">${driverName}</span>
                                    <span class="standings-code" style="padding: 1px 4px; min-width: auto; font-size: 9px; line-height: 1.2;">${escapeHtml(driver.code || '--')}</span>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="constructor-color-dot" style="background: #${teamHex};"></span>
                            <span>${escapeHtml(constructorName)}</span>
                        </div>
                    </td>
                    <td>${winsDisplay}</td>
                    <td class="standings-points">${escapeHtml(formatStandingNumber(item.points))}</td>
                </tr>
            `;
        }).join('');
    }

    if (DOM.constructorStandingsTableBody) {
        DOM.constructorStandingsTableBody.innerHTML = constructorStandings.map((item) => {
            const constructor = item.Constructor || {};
            const constructorName = constructor.name || '-';
            const constructorId = constructor.constructorId || '';
            const nationality = constructor.nationality || '';
            
            const teamNameLower = (constructorName || '').toLowerCase();
            const teamIdLower = (constructorId || '').toLowerCase();
            let teamHex = TEAM_COLORS[teamNameLower] || TEAM_COLORS[teamIdLower];
            
            if (!teamHex && state.drivers) {
                const matchingDriver = state.drivers.find(d => (d.team_name || '').toLowerCase() === teamNameLower);
                if (matchingDriver && matchingDriver.team_colour) {
                    teamHex = matchingDriver.team_colour;
                }
            }
            if (!teamHex) teamHex = '787878';
            teamHex = teamHex.replace('#', '');
            
            const flag = getNationalityFlag(nationality);
            
            const position = parseInt(item.position);
            let posClass = 'pos-non-podium';
            if (position === 1) posClass = 'pos-podium-1';
            else if (position === 2) posClass = 'pos-podium-2';
            else if (position === 3) posClass = 'pos-podium-3';
            
            const wins = parseInt(item.wins) || 0;
            const winsDisplay = wins > 0 
                ? `${wins} <span class="material-icons-round" style="font-size: 14px; color: #FFD700; vertical-align: middle; margin-left: 2px;">emoji_events</span>`
                : `<span style="color: var(--text-muted);">${wins}</span>`;

            return `
                <tr>
                    <td class="results-position-cell ${posClass}">${escapeHtml(item.positionText || item.position || '-')}</td>
                    <td>
                        <div class="results-driver-cell">
                            <div class="results-team-color-indicator" style="background: #${teamHex};"></div>
                            <div class="results-driver-info">
                                <span class="results-driver-name" style="font-weight: 600; font-size: 13px;">${escapeHtml(constructorName)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="margin-right: 6px; font-size: 14px;">${flag}</span>
                        <span>${escapeHtml(nationality)}</span>
                    </td>
                    <td>${winsDisplay}</td>
                    <td class="standings-points">${escapeHtml(formatStandingNumber(item.points))}</td>
                </tr>
            `;
        }).join('');
    }
}
```

- [ ] **Step 3: Commit JavaScript changes**
```bash
git add static/js/dashboard.js
git commit -m "feat: enhance standings render logic with colors, avatars, and nationality flags"
```

---

### Task 3: Verification

**Files:**
- Test: `tests/test_race_standings.py`

**Interfaces:**
- Consumes: Python test environment
- Produces: Verification output

- [ ] **Step 1: Run all Python tests**
Run: `.venv/bin/python3 -m unittest discover -s tests`
Expected: 45 tests pass.

- [ ] **Step 2: Check for Javascript syntax or runtime issues**
Verify that the codebase builds and runs cleanly.
