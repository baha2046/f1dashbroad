# Lap telemetry sector overlays

Date: 2026-07-11

## Goal

Show the selected lap's official S1, S2, and S3 regions on every graph in the
Laps & stint telemetry panel.

## Implementation

- The car telemetry payload now carries `duration_sector_1`,
  `duration_sector_2`, and `duration_sector_3` from the selected lap record.
- Single-lap graphs place sector boundaries directly on their elapsed-time
  axis.
- Comparison graphs interpolate the main lap's cumulative telemetry distance
  at each official split, preserving the existing distance-aligned traces.
- Alternating sector bands, S1/S2/S3 labels, and dashed split lines render on
  speed, combined inputs, and detail-mode graphs and remain correct while
  drag-zooming.
- The single-lap hover tooltip identifies the sector at the cursor.

## Verification

- Run: `.venv/bin/python3 -m unittest discover -s tests`
