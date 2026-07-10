# Drivers and constructors redesign

Date: 2026-07-10

## Goal

Turn the Drivers tab into a paddock directory that presents session drivers together with the official constructors participating in the selected season and round.

## Data integration

- Added `GET /api/constructors` with `year` plus either `date` or `round`.
- Weekend session dates are resolved to a Jolpica race round through the existing season race schedule.
- Constructor identities are fetched from:
  `https://api.jolpi.ca/ergast/f1/{year}/{round}/constructors/?format=json`
- Responses use the existing Jolpica cache and stale-cache fallback.
- The frontend keeps constructor data separate from the live timing driver list, then matches the two sources by normalized team identity.
- Aliases cover current naming differences such as RB/Racing Bulls, Red Bull/Red Bull Racing, Alpine F1 Team/Alpine, and Haas F1 Team/Haas.

## Interface

- Added a paddock hero with selected venue, season/round, driver count, constructor count, and constructor-nationality count.
- Added an interactive Teams/Drivers view switch with synchronized `aria-pressed` state.
- Teams view shows constructor name, ID, nationality, profile link, team color, and matched session drivers.
- Drivers view presents larger driver cards with constructor nationality and a direct path to lap analysis.
- Search now covers drivers, numbers, constructors, teams, and nationalities in both views.
- Cards and controls include keyboard focus states, Enter/Space activation where appropriate, and reduced-motion behavior.
- Container queries adapt the hero, toolbar, constructor lineups, and grids at compact widths.

## Files

- `app.py`
- `templates/index.html`
- `static/css/styles.css`
- `static/js/01-state-helpers.js`
- `static/js/02-dom.js`
- `static/js/03-api-settings.js`
- `static/js/05-session-load.js`
- `static/js/07-driver-grids.js`
- `tests/test_constructor_roster.py`

## Verification

- Run: `.venv/bin/python3 -m unittest discover -s tests`
- Visual checks: Teams view, Drivers view, constructor/driver search, lap-analysis navigation, wide layout, and compact layout.
