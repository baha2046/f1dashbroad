# Session Replay: 2D/3D track map view

2026-07-10

## Goal

Add a "3D" view to the Session Replay track map: a tilted, rotatable
broadcast-style rendering of the circuit, switchable against the existing flat
2D map without disturbing playback.

## Approach

The replay position feed carries no elevation (the backend flattens
Position.z to `[t, x, y]` samples), so the 3D view is a *projection* of the
same world-space data: rotate the circuit by a user-controlled yaw, then
foreshorten the depth axis by a fixed factor (`REPLAY_3D_DEPTH_SCALE`, the
cosine of the implied camera tilt) — a TV-helicopter look. An extruded darker
copy of the outline (`.replay-track-base`, dropped by `REPLAY_3D_BASE_DROP`
view units) sells the depth.

The projection stays inside the existing SVG pipeline rather than using CSS
3D transforms because:

- CSS `rotateX` on SVG content is flattened by Firefox and blurs/warps car
  dots, labels, and hit targets;
- projecting in JS keeps labels upright and dots round, and every existing
  feature (click-to-focus, marshal-sector yellows, circuit-state tint,
  start/finish marker) works unchanged.

## Design

- `buildReplayScene` now builds *structure* only and stores world-space
  geometry plus node refs in `state.replay.scene` (`trackPoints`,
  `marshalSegments`, `startFinish`, `cars` with raw samples).
- `applyReplayMapProjection()` projects that geometry through
  `replayViewTransform()` (identity in 2D; yaw rotation + depth squash in 3D),
  recomputes fit-to-bounds, and rewrites node geometry in place — node
  identity survives, so focus highlights, lit sectors, and playback continue
  across view switches. Car samples are re-projected into the view-space
  arrays that per-frame interpolation reads.
- View mode and yaw live in `state.replayMapView` at the state root, so they
  survive `resetReplay()` on session changes.
- A `2D | 3D` toggle (`#replayViewToggle`) sits in the replay stage header.
  In 3D, horizontal pointer drags rotate the circuit
  (`REPLAY_3D_YAW_PER_PIXEL`); reprojection is coalesced to one per animation
  frame, and drags past `REPLAY_3D_DRAG_CLICK_THRESHOLD_PX` swallow the
  release click so rotating never toggles a car's focus highlight.
  `touch-action: pan-y pinch-zoom` keeps vertical page scrolling alive on
  touch devices.
- `renderReplayMessage` nulls the stored scene: the message replaces the SVG,
  so rotation on a stale detached scene is a no-op.

## Tests

`tests/test_replay_3d_view.py` — markup/wiring assertions, in-place
reprojection assertions, node-run checks of the projection math (2D identity,
depth squash at yaw 0, quarter-turn rotation), and CSS coverage.
