# Design Doc: Championship Standings UI Enhancement

This document outlines the design and implementation details for enhancing the Championship Standings tables in the **Results** tab of the F1 Dashboard.

## 1. Background & Goals

In the last commit, Championship Standings (both Driver and Constructor) were added to the Results tab. However, the tables are currently basic text-based lists.
The goal of this enhancement is to elevate the UI to a premium, information-rich look with:
- Podium position highlighting.
- Team color indicators.
- Driver headshot avatars.
- Nationality flag emojis.
- Trophy indicators for race wins.
- Enhanced card layout matching the rest of the application.

## 2. Component Design & Changes

### A. Driver Standings Table
- **Position Column (`Pos`)**:
  - Class `pos-podium-1` for position 1 (gold).
  - Class `pos-podium-2` for position 2 (silver).
  - Class `pos-podium-3` for position 3 (bronze).
  - Class `pos-non-podium` for other positions.
- **Driver Column (`Driver`)**:
  - Render as a flex row containing:
    - Vertical team color bar (`results-team-color-indicator`).
    - Driver avatar (`results-driver-avatar`), fallbacks included.
    - Driver info container (`results-driver-info`):
      - Top line: Driver full name + three-letter code in a badge.
- **Constructor Column (`Constructor`)**:
  - Render with a circular dot matching the team's primary color:
    - Dot: `display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #${teamHex}; margin-right: 8px;`
- **Wins Column (`Wins`)**:
  - If wins > 0, show the win count along with a gold trophy emoji (`🏆`).
  - Otherwise, show the win count muted.
- **Points Column (`Points`)**:
  - Bold, premium typography.

### B. Constructor Standings Table
- **Position Column (`Pos`)**:
  - Same podium styling as driver standings.
- **Constructor Column (`Constructor`)**:
  - Render as a flex row containing:
    - Vertical team color bar (`results-team-color-indicator`).
    - Constructor name in bold.
- **Nationality Column (`Nationality`)**:
  - Map nationality string to flag emoji (e.g. "British" -> `🇬🇧`) and display next to the text.
- **Wins Column (`Wins`)**:
  - Gold trophy emoji (`🏆`) for wins > 0.
- **Points Column (`Points`)**:
  - Bold typography.

## 3. Data Integration

### Driver Mapping
We will implement `findDriver()` in `static/js/dashboard.js` to link standings items to driver objects fetched from `/api/drivers` (`state.drivers`).
- Matches on `Driver.permanentNumber` -> `driver_number`
- Fallback matches on `Driver.code` -> `name_acronym`
- Fallback matches on `Driver.familyName` -> `last_name`

### Nationality Flag Mapping
A javascript dictionary `NATIONALITY_TO_FLAG` will be added to `static/js/dashboard.js` containing mappings from lowercase nationality strings to their respective emoji flags (e.g. `dutch` -> `🇳🇱`, `german` -> `🇩🇪`).

## 4. CSS Enhancements

Update `.standings-panel` in `static/css/styles.css` to:
- Adjust border-radius to `12px` or `16px` to match cards.
- Add box-shadow and transition effects.
