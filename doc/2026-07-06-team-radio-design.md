# Design: Team Radio in Race Control & Session Replay

Surface OpenF1 **team radio** recordings (`/v1/team_radio`) in two places:
the **Race Control** tab interleaves radio clips with race-control
messages as playable feed items, and the **Session Replay** tab gains a
team-radio ticker that follows the playhead and plays the clip on demand.

## 1. Data source

`https://api.openf1.org/v1/team_radio?session_key=<key>` returns records:

```json
{
  "date": "2023-09-15T09:40:43.005000+00:00",
  "driver_number": 11,
  "meeting_key": 1219,
  "recording_url": "https://livetiming.formula1.com/static/.../TeamRadio/....mp3",
  "session_key": 9158
}
```

- No `lap_number`, no transcript — just a timestamp, a driver and an
  audio URL (mp3 served by livetiming.formula1.com, CORS-friendly for
  plain `<audio>`/`Audio()` playback, no fetch needed).
- Volume: a race session carries roughly 300–500 clips; practice /
  qualifying sessions considerably fewer.

## 2. Backend

Add `"team_radio": "team_radio"` to `OPENF1_SESSION_ENDPOINTS` in
`app.py`. That registers `/api/team_radio?session_key=<k>` with the
shared session-endpoint handling: `team_radio_<key>.json` cache file,
permanent TTL for historical sessions, 5 min for recent, 30 s while the
session is live, stale-cache fallback and 429 retries. No new code path.

## 3. Frontend data flow

- `state.teamRadio = []` (reset in `selectSession`), filled from
  `/api/team_radio?session_key=...` in the `selectSession` fetch fan-out
  (all session types — quali/practice radio is worth showing too).
- Live mode: `refreshLiveData()` polls `/api/team_radio` alongside
  position/intervals/race-control, updates `state.teamRadio`,
  invalidates `state.replay.teamRadioIndex` and re-renders the feed.

## 4. Shared audio player (one clip at a time)

A single lazily-created `Audio()` instance (`06-overview-tabs.js`)
serves every play button — feed items and the replay ticker:

- `toggleTeamRadioClip(url)`: clicking a button for the playing clip
  pauses it; a different URL loads + plays it (restart from 0 after
  `ended`). Only `http(s)` URLs are accepted.
- `syncTeamRadioPlayingButtons()`: toggles `.playing` (and the
  play/pause icon) on every `.team-radio-play-btn` whose
  `data-radio-url` matches the currently playing URL — safe against
  feed re-renders (live refresh, toggle changes).
- `timeupdate` writes `elapsed / total` into the playing feed item's
  `.team-radio-clip-time` label.
- Buttons are wired by event delegation on `#raceControlFeed` plus a
  direct listener on the replay ticker button (`03-api-settings.js`).

## 5. Race Control tab

- Header gains a second switch — **Show Team Radio** (`#showTeamRadio`,
  default on) — next to Show Blue Flags; both wrapped in a
  `.race-control-toggles` container so the header keeps its layout.
- `renderRaceControlFeed()` builds a merged entry list: race-control
  messages (blue-flag filter as today) plus, when the toggle is on,
  team-radio entries `{ kind: 'radio', date, lap, item }`, sorted by
  `date` descending like today.
- **Lap attribution**: radio records carry no lap. For Race/Sprint
  sessions the field-wide lap at the clip's timestamp is derived from
  `state.allSessionLaps` (highest `lap_number` whose `date_start` is at
  or before the clip — same leader-lap semantics as race-control
  `lap_number`). When laps are unavailable (practice/quali) a radio
  entry simply joins the current contiguous group so the feed never
  fragments into bogus "General Notices" slivers.
- Radio item rendering reuses the `race-control-item` grid: time cell,
  a `TEAM RADIO` type pill (`race-control-type-team-radio`), the
  standard driver meta pill (color dot + name), and a compact player
  row (round play/pause button + clip-time label).
- Summary line appends the clip count:
  `N messages, M incident updates, R radio clips`.
- Empty state shows only when both sources are empty after filters.

## 6. Session Replay tab

A **team-radio ticker** sits in the replay map stack under the
race-control ticker:

```html
<div id="replayTeamRadioTicker" class="replay-team-radio-ticker" hidden>
  <button id="replayTeamRadioPlayBtn" class="team-radio-play-btn" ...>
  <span class="replay-team-radio-label">Team Radio</span>
  <span id="replayTeamRadioMeta"></span>   <!-- HH:MM:SS - VER -->
</div>
```

- `updateReplayTeamRadioTicker()` runs from `renderReplayFrame` with the
  same 250 ms tick throttle as the context panel
  (`state.replay.lastTeamRadioTickMs`).
- The clip shown is the latest one at or before
  `getReplayAbsoluteMs(state.replay.t)` within a **2-minute freshness
  window** (`REPLAY_TEAM_RADIO_MAX_AGE_MS`) — old clips don't linger for
  half a race. Reuses `buildDriverDateIndex` / `valueAtMs` (team-radio
  records have exactly the `driver_number` + `date` shape they index),
  memoized on `state.replay.teamRadioIndex`.
- Driver mode filters to the reference driver's radio; full-race mode
  scans all drivers and keeps the newest.
- Playback is **manual** (press the ticker's play button) — browser
  autoplay policies make synced auto-play unreliable; possible
  follow-up behind an opt-in toggle.
- Cleared by `resetReplay` and whenever no clip / no replay data is
  available.

## 7. Styling

- `.race-control-type-team-radio`: orange pill (rgba 255,159,10 family)
  distinct from flag/session pills.
- `.team-radio-play-btn`: 28 px round icon button; `.playing` state
  fills with the accent color.
- `.team-radio-player` row and `.team-radio-clip-time` (muted,
  tabular-nums).
- `.replay-team-radio-ticker` mirrors `.replay-race-control-ticker`
  (same strip metrics), with label/meta typography matching the
  telemetry strip.

## 8. Testing plan

`tests/test_team_radio.py`, repo conventions (async API tests over a
patched cache dir + string-level static wiring tests):

1. `/api/team_radio?session_key=<k>` serves cached clips; missing
   `session_key` → 400; `team_radio` present in
   `OPENF1_SESSION_ENDPOINTS`.
2. index.html wires `#showTeamRadio`, `#replayTeamRadioTicker`,
   `#replayTeamRadioPlayBtn`.
3. Dashboard JS: `state.teamRadio`, both fetch sites (session load +
   live refresh), `toggleTeamRadioClip`, `syncTeamRadioPlayingButtons`,
   radio merge in `renderRaceControlFeed`,
   `updateReplayTeamRadioTicker`, DOM map entries.
4. CSS: `.race-control-type-team-radio`, `.team-radio-play-btn`,
   `.replay-team-radio-ticker`.
