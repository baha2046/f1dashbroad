# Design: Hide Inactive Driver Markers in Session Replay

## Problem

The Livetiming `Position.z` feed continues to publish a fixed off-track
placeholder coordinate for drivers who did not start or have retired. The
replay payload preserves those samples, and `renderReplayFrame` currently
treats every interpolated sample as a valid on-map position. This leaves DNS
and `OUT` driver dots visible away from the circuit.

## Behavior

- A driver whose result is marked `dns`, `DNS`, or `Did not start` never has a
  dot on the replay graph.
- A driver whose result is marked DNF/retired remains visible while the driver
  still has future position records. Once the existing replay retirement check
  changes the running-order status to `OUT`, the driver's graph dot is hidden.
- Active drivers continue to use the existing sample interpolation and gap
  handling unchanged.
- The running-order row remains visible for inactive drivers. DNS drivers show
  `DNS` in the status column; retired drivers continue to show `OUT`.

## Implementation

Add a shared result-status helper in the replay context code for identifying a
DNS result. Use it from the race tower and from the replay-frame marker
visibility decision. The frame renderer will combine result status with the
existing time-aware retirement helper before displaying an interpolated dot.

The backend replay payload and placeholder-coordinate handling remain
unchanged. Marker visibility belongs in the frontend because DNS is derived
from enriched official results, while retirement visibility depends on the
current replay time and position history.

## Testing

Add JavaScript runtime regression coverage proving that:

- a DNS driver's marker is hidden even when a location sample exists;
- a retiring driver's marker is visible before the final position record and
  hidden afterward;
- an active driver's marker remains visible; and
- the running-order renderer assigns `DNS` to a did-not-start result and `OUT`
  to a retired result.

Run the focused replay tests followed by the complete Python test suite with
`.venv/bin/python3`.
