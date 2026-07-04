# Design: Race Control Feed Visual Enhancements

This document designs the visual enhancements for the **Race Control** tab to display structured driver labels (with names and colors) instead of raw text strings (e.g. `CAR 12 (ANT)`) and group messages chronologically using sticky lap headers.

## 1. Objectives

- Replace raw text driver references in messages (e.g., `CAR 12 (ANT)`) with styled inline badges displaying the driver's full name, number, and team color accent.
- Replace metadata labels (pills) for drivers with team-colored indicators and full names where possible.
- Group the chronological messages by lap using sticky visual dividers, replacing the repetitive "Lap XX" metadata pill on each message.

## 2. Proposed Changes

### 2.1. Regex-based Message Parsing (`static/js/06-overview-tabs.js`)

We will add a helper function `formatDriversInMessage(messageText)` that:
1. Escapes the message text to prevent XSS.
2. Identifies driver references matching the pattern:
   `/(?:CAR(?:S)?\s+)?(\d+)\s*\(([A-Z]{3})\)/gi`
3. Resolves each match against `state.drivers` using the driver number or acronym.
4. Replaces the match with a styled inline HTML pill:
   ```html
   <span class="driver-inline-pill" style="--team-color: #${teamHex}; --team-color-rgb: ${rgb};">
       <span class="driver-color-bar"></span>
       <span class="driver-pill-name">${fullName}</span>
       <span class="driver-pill-number">#${num}</span>
   </span>
   ```

### 2.2. Sticky Lap Grouping (`static/js/06-overview-tabs.js`)

We will update `renderRaceControlFeed()` to:
1. Sort the messages reverse-chronologically (newest first).
2. Group contiguous messages by their `lap_number`.
   - Messages without a lap number will be grouped under "General Notices".
3. Render each group wrapped in a `.race-control-group` container:
   ```html
   <div class="race-control-group">
       <header class="race-control-group-header">
           <span class="race-control-group-title">${groupTitle}</span>
       </header>
       <div class="race-control-group-items">
           <!-- Messages here -->
       </div>
   </div>
   ```

### 2.3. Style Implementation (`static/css/styles.css`)

We will add modern CSS variables and styles for:
1. `.race-control-group` and `.race-control-group-header` (making headers sticky, adding glassmorphism background blur).
2. `.driver-inline-pill` for the parsed driver references in messages.
3. `.driver-pill-dot` for team colors inside meta pills.

```css
/* Group Headers */
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

/* Inline Driver Pills */
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

## 3. Testing Plan

1. Verify rendering of race control feed with the Python-based web app.
2. Confirm driver references such as `CAR 27 (HUL)` are correctly replaced with styled name tags.
3. Validate that sticky lap separators are shown and scroll behavior works as expected.
