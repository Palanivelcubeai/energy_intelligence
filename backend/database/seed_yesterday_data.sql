-- ============================================================
-- Add yesterday's data to machine_parts_produced for day-over-day comparison
-- This script adds sample data for yesterday to test the daily-comparison endpoint
-- ============================================================

INSERT INTO machine_parts_produced (machine_id, recorded_at, energy_kwh_used, parts_produced, parts_rejected, runtime_hours, idle_hours, efficiency_score)
VALUES
  -- Yesterday's data (slightly different from today for comparison)
  ('CNC-1', CURRENT_DATE - INTERVAL '1 day', 30.5, 32, 1, 1.8, 0.2, 90),
  ('CNC-2', CURRENT_DATE - INTERVAL '1 day', 35.2, 28, 2, 1.7, 0.3, 75),
  ('CNC-3', CURRENT_DATE - INTERVAL '1 day', 32.8, 22, 2, 1.5, 0.5, 62),
  ('CNC-4', CURRENT_DATE - INTERVAL '1 day', 25.4, 36, 0, 1.9, 0.1, 93),
  ('CNC-5', CURRENT_DATE - INTERVAL '1 day', 9.5, 12, 0, 0.8, 0.1, 85),
  
  -- Today's data (for initial comparison)
  ('CNC-1', CURRENT_DATE, 28.8, 34, 0, 1.8, 0.2, 92),
  ('CNC-2', CURRENT_DATE, 33.7, 26, 1, 1.7, 0.3, 78),
  ('CNC-3', CURRENT_DATE, 31.3, 20, 2, 1.5, 0.5, 65),
  ('CNC-4', CURRENT_DATE, 23.8, 38, 1, 1.9, 0.1, 95),
  ('CNC-5', CURRENT_DATE, 9.0, 11, 0, 0.8, 0.1, 88)
ON CONFLICT (machine_id, recorded_at) DO UPDATE SET
  energy_kwh_used = EXCLUDED.energy_kwh_used,
  parts_produced = EXCLUDED.parts_produced,
  parts_rejected = EXCLUDED.parts_rejected,
  runtime_hours = EXCLUDED.runtime_hours,
  idle_hours = EXCLUDED.idle_hours,
  efficiency_score = EXCLUDED.efficiency_score;
