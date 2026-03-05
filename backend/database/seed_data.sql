-- ============================================================
-- Seed data for all empty tables
-- Run: psql -U postgres -d energy_db -f seed_data.sql
-- ============================================================

-- ============================================================
-- MACHINE METRICS (latest snapshot per machine)
-- ============================================================
INSERT INTO machine_metrics (machine_id, recorded_at, current_power_kw, energy_kwh, power_factor, frequency_hz, voltage_r, voltage_y, voltage_b, voltage_imbalance_pct, current_r, current_y, current_b, thd_percent, runtime_hours, idle_hours, parts_produced, rejection_count, energy_per_part, efficiency_score)
VALUES
  ('CNC-1', NOW(), 18.5, 142.3, 0.92, 49.98, 415, 413, 416, 0.36, 28.5, 27.8, 29.1, 3.2, 7.2, 0.8, 145, 2, 0.98, 92),
  ('CNC-2', NOW(), 22.1, 168.7, 0.89, 49.97, 412, 414, 410, 0.48, 34.2, 33.5, 35.0, 4.5, 6.8, 1.2, 128, 5, 1.32, 78),
  ('CNC-3', NOW(), 3.2, 156.4, 0.85, 49.99, 418, 415, 412, 0.72, 5.1, 4.8, 5.3, 5.8, 6.0, 2.0, 98, 8, 1.60, 65),
  ('CNC-4', NOW(), 15.8, 118.9, 0.94, 50.01, 414, 416, 413, 0.36, 24.3, 24.8, 24.1, 2.8, 7.5, 0.5, 162, 1, 0.73, 95),
  ('CNC-5', NOW(), 0, 45.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3.0, 0.5, 52, 0, 0.87, 88);

-- ============================================================
-- ENERGY OUTPUT DAILY (last 30 days for all machines)
-- ============================================================
DO $$
DECLARE
  d INT;
  m TEXT;
  base_energy NUMERIC;
  base_prod INT;
  variance NUMERIC;
  energy NUMERIC;
  prod INT;
  rt NUMERIC;
  idle NUMERIC;
  epp NUMERIC;
  cpp NUMERIC;
  eff INT;
  stat TEXT;
BEGIN
  FOR d IN 0..29 LOOP
    FOR m IN SELECT unnest(ARRAY['CNC-1','CNC-2','CNC-3','CNC-4','CNC-5']) LOOP
      CASE m
        WHEN 'CNC-1' THEN base_energy := 142; base_prod := 145; stat := 'running';
        WHEN 'CNC-2' THEN base_energy := 169; base_prod := 128; stat := 'running';
        WHEN 'CNC-3' THEN base_energy := 156; base_prod := 98;  stat := 'idle';
        WHEN 'CNC-4' THEN base_energy := 119; base_prod := 162; stat := 'running';
        WHEN 'CNC-5' THEN base_energy := 45;  base_prod := 52;  stat := 'maintenance';
      END CASE;
      variance := 0.85 + random() * 0.3;
      energy := ROUND((base_energy * variance)::numeric, 1);
      prod := ROUND(base_prod * variance);
      rt := ROUND((CASE WHEN stat = 'maintenance' THEN 3.0 ELSE 5.5 + random() * 2.5 END)::numeric, 1);
      idle := ROUND((CASE WHEN stat = 'maintenance' THEN 0.5 ELSE 0.3 + random() * 2.0 END)::numeric, 1);
      epp := CASE WHEN prod > 0 THEN ROUND((energy / prod)::numeric, 3) ELSE 0 END;
      cpp := ROUND((epp * 8.5)::numeric, 2);
      eff := LEAST(100, GREATEST(50, ROUND(70 + random() * 28)));
      INSERT INTO energy_output_daily (record_date, machine_id, energy_kwh, production, runtime_hours, idle_hours, energy_per_part, cost_per_part, efficiency_score, status)
      VALUES (CURRENT_DATE - d, m, energy, prod, rt, idle, epp, cpp, eff, stat)
      ON CONFLICT (record_date, machine_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- SHIFT PRODUCTION (last 7 days)
-- ============================================================
DO $$
DECLARE
  d INT;
  m TEXT;
  sh TEXT;
  base_parts INT;
  parts INT;
  target INT;
  rejected INT;
  eff INT;
BEGIN
  FOR d IN 0..6 LOOP
    FOREACH sh IN ARRAY ARRAY['Shift A (06-14)', 'Shift B (14-22)', 'Shift C (22-06)'] LOOP
      FOR m IN SELECT unnest(ARRAY['CNC-1','CNC-2','CNC-3','CNC-4','CNC-5']) LOOP
        CASE m
          WHEN 'CNC-1' THEN base_parts := 48;
          WHEN 'CNC-2' THEN base_parts := 42;
          WHEN 'CNC-3' THEN base_parts := 33;
          WHEN 'CNC-4' THEN base_parts := 54;
          WHEN 'CNC-5' THEN base_parts := 17;
        END CASE;
        parts := ROUND(base_parts * (0.85 + random() * 0.3));
        target := ROUND(base_parts * 1.1);
        rejected := ROUND(random() * 4);
        eff := CASE WHEN target > 0 THEN LEAST(100, ROUND((parts::numeric / target) * 100)) ELSE 0 END;
        INSERT INTO shift_production (record_date, shift, machine_id, parts_produced, parts_rejected, production_target, efficiency_pct)
        VALUES (CURRENT_DATE - d, sh, m, parts, rejected, target, eff)
        ON CONFLICT (record_date, shift, machine_id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- POWER QUALITY (per machine, latest reading)
-- ============================================================
INSERT INTO power_quality (machine_id, recorded_at, voltage_r, voltage_y, voltage_b, current_r, current_y, current_b, power_factor, frequency_hz, thd_percent, voltage_imbalance_pct, health_score)
VALUES
  ('CNC-1', NOW(), 415, 413, 416, 28.5, 27.8, 29.1, 0.92, 49.98, 3.2, 0.36, 92),
  ('CNC-2', NOW(), 412, 414, 410, 34.2, 33.5, 35.0, 0.89, 49.97, 4.5, 0.48, 78),
  ('CNC-3', NOW(), 418, 415, 412, 5.1,  4.8,  5.3,  0.85, 49.99, 5.8, 0.72, 65),
  ('CNC-4', NOW(), 414, 416, 413, 24.3, 24.8, 24.1, 0.94, 50.01, 2.8, 0.36, 95),
  ('CNC-5', NOW(), 0,   0,   0,   0,    0,    0,    0,    0,     0,   0,    0);

-- ============================================================
-- DEMAND RECORDS (24h of 15-min intervals)
-- ============================================================
DO $$
DECLARE
  h INT;
  m INT;
  base_loads NUMERIC[] := ARRAY[35,32,30,28,27,30,45,62,75,78,80,76,72,78,82,80,75,68,55,48,42,40,38,36];
  base NUMERIC;
  demand NUMERIC;
  contract NUMERIC := 85;
  util INT;
  risk TEXT;
BEGIN
  FOR h IN 0..23 LOOP
    base := base_loads[h+1];
    FOR m IN 0..3 LOOP
      demand := ROUND((base + (random() * 8 - 4))::numeric, 1);
      util := ROUND((demand / contract * 100));
      risk := CASE WHEN util > 95 THEN 'Critical' WHEN util > 85 THEN 'Warning' ELSE 'Normal' END;
      INSERT INTO demand_records (recorded_at, demand_kva, contract_demand_kva, utilization_pct, risk_level)
      VALUES (date_trunc('day', NOW()) + (h * 60 + m * 15) * INTERVAL '1 minute', demand, contract, util, risk);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- LOAD CURVE (24h hourly plant-level load)
-- ============================================================
DO $$
DECLARE
  h INT;
  base_loads NUMERIC[] := ARRAY[35,32,30,28,27,30,45,62,75,78,80,76,72,78,82,80,75,68,55,48,42,40,38,36];
  load_val NUMERIC;
BEGIN
  FOR h IN 0..23 LOOP
    load_val := ROUND((base_loads[h+1] + (random() * 8 - 4))::numeric, 1);
    INSERT INTO load_curve (recorded_at, load_kw)
    VALUES (date_trunc('day', NOW()) + h * INTERVAL '1 hour', load_val);
  END LOOP;
END $$;

-- ============================================================
-- PRODUCTION TREND (hourly for today)
-- ============================================================
DO $$
DECLARE
  h INT;
  prod INT;
  energy NUMERIC;
BEGIN
  FOR h IN 6..20 LOOP
    prod := ROUND(30 + random() * 50);
    energy := ROUND((prod * (0.7 + random() * 0.5))::numeric, 1);
    INSERT INTO production_trend (recorded_at, production, energy_kwh)
    VALUES (date_trunc('day', NOW()) + h * INTERVAL '1 hour', prod, energy);
  END LOOP;
END $$;

-- ============================================================
-- CARBON INSIGHTS
-- ============================================================
INSERT INTO carbon_insights (severity, message, carbon_reduction, financial_impact, recommendation) VALUES
  ('warning', 'CNC-3 has 35% higher carbon intensity than fleet average due to inefficient cutting parameters', '12.5 kg CO₂/day reduction possible', '₹3,200/month savings on energy', 'Optimize CNC-3 cutting speed and feed rate parameters'),
  ('success', 'CNC-4 achieves lowest carbon footprint per part (0.62 kg CO₂/part) — best practice candidate', 'Already 18% below target', '₹0 — already optimal', 'Replicate CNC-4 toolpath strategies across fleet'),
  ('warning', 'Idle-mode CO₂ waste detected: 22kg CO₂/day from machines running without production', '22 kg CO₂/day reduction', '₹5,100/month idle energy savings', 'Implement auto-standby after 15 minutes of no production'),
  ('info', 'Increasing renewable % from 22% to 35% would reduce Scope 2 emissions by 78 kg CO₂/day', '78 kg CO₂/day reduction', '₹18,000/month carbon credit value', 'Explore rooftop solar or green energy purchase agreements'),
  ('success', 'Monthly carbon intensity improved 8% vs last quarter due to production optimization', '45 kg CO₂/month reduction achieved', '₹8,500/month energy savings realized', 'Continue current optimization trajectory'),
  ('warning', 'Peak-hour production causes 40% higher carbon intensity vs off-peak', '28 kg CO₂/day reduction possible', '₹6,800/month ToD tariff savings', 'Shift non-critical jobs to off-peak hours (22:00-06:00)');
