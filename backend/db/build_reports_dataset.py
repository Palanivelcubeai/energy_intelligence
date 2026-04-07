import psycopg2

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db_config import DB_CONFIG

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS reports (
    id              SERIAL PRIMARY KEY,
    report_key      VARCHAR(100) NOT NULL UNIQUE,
    report_name     VARCHAR(255) NOT NULL,
    description     TEXT,
    last_generated  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS energy_output_daily (
    id               BIGSERIAL PRIMARY KEY,
    record_date      DATE        NOT NULL,
    machine_id       VARCHAR(20) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    energy_kwh       NUMERIC(10,2) NOT NULL DEFAULT 0,
    production       INTEGER     NOT NULL DEFAULT 0,
    runtime_hours    NUMERIC(7,2) NOT NULL DEFAULT 0,
    idle_hours       NUMERIC(7,2) NOT NULL DEFAULT 0,
    energy_per_part  NUMERIC(8,3) NOT NULL DEFAULT 0,
    cost_per_part    NUMERIC(10,2) NOT NULL DEFAULT 0,
    efficiency_score INTEGER CHECK (efficiency_score BETWEEN 0 AND 100),
    status           VARCHAR(20) CHECK (status IN ('running', 'idle', 'maintenance')),
    UNIQUE (record_date, machine_id)
);

CREATE TABLE IF NOT EXISTS shift_production (
    id                BIGSERIAL PRIMARY KEY,
    record_date       DATE        NOT NULL,
    shift             VARCHAR(30) NOT NULL CHECK (shift IN ('Shift A (06-14)', 'Shift B (14-22)', 'Shift C (22-06)')),
    machine_id        VARCHAR(20) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    parts_produced    INTEGER     NOT NULL DEFAULT 0,
    parts_rejected    INTEGER     NOT NULL DEFAULT 0,
    production_target INTEGER     NOT NULL DEFAULT 0,
    efficiency_pct    INTEGER CHECK (efficiency_pct BETWEEN 0 AND 100),
    UNIQUE (record_date, shift, machine_id)
);

CREATE TABLE IF NOT EXISTS monthly_production (
    id                  BIGSERIAL PRIMARY KEY,
    year                INTEGER    NOT NULL,
    month               VARCHAR(3) NOT NULL CHECK (month IN ('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')),
    total_production    INTEGER    NOT NULL DEFAULT 0,
    total_energy_kwh    NUMERIC(12,2) NOT NULL DEFAULT 0,
    avg_energy_per_part NUMERIC(8,3) NOT NULL DEFAULT 0,
    efficiency_score    INTEGER CHECK (efficiency_score BETWEEN 0 AND 100),
    carbon_intensity    NUMERIC(8,4) NOT NULL DEFAULT 0,
    UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS demand_records (
    id                  BIGSERIAL PRIMARY KEY,
    recorded_at         TIMESTAMPTZ NOT NULL,
    demand_kva          NUMERIC(10,2) NOT NULL,
    contract_demand_kva NUMERIC(10,2) NOT NULL,
    utilization_pct     INTEGER,
    risk_level          VARCHAR(20) CHECK (risk_level IN ('Normal', 'Warning', 'Critical'))
);

CREATE INDEX IF NOT EXISTS idx_demand_records_time ON demand_records (recorded_at DESC);
"""

SEED_REPORTS_SQL = """
INSERT INTO reports (report_key, report_name, description)
VALUES
  ('daily_cnc_energy', 'Daily CNC Energy Report', 'Daily machine-level energy, runtime, idle and status summary'),
  ('production', 'Production Report', 'Shift-wise production, rejection and efficiency details'),
  ('energy_per_part', 'Energy per Part Report', 'Machine ranking by energy and cost per part'),
  ('monthly_efficiency', 'Monthly Efficiency Report', 'Month-wise production energy efficiency and carbon intensity'),
  ('peak_demand', 'Peak Demand Report', 'Peak demand usage, contract utilization and risk levels'),
  ('cost_optimization', 'Cost Optimization Report', 'Machine-wise energy cost, idle cost and potential savings')
ON CONFLICT (report_key) DO NOTHING;
"""

UPSERT_SHIFT_PRODUCTION_SQL = """
WITH normalized AS (
  SELECT
    CASE
      WHEN shift = 'Shift C (22-06)' AND EXTRACT(HOUR FROM recorded_at) < 6
      THEN (recorded_at::date - INTERVAL '1 day')::date
      ELSE recorded_at::date
    END AS record_date,
    shift,
    machine_id,
    parts_produced,
    parts_rejected,
    production_target,
    efficiency_score
  FROM machine_parts_produced
)
INSERT INTO shift_production (
  record_date, shift, machine_id,
  parts_produced, parts_rejected, production_target, efficiency_pct
)
SELECT
  record_date,
  shift,
  machine_id,
  SUM(parts_produced)::int,
  SUM(parts_rejected)::int,
  MAX(production_target)::int,
  ROUND(AVG(efficiency_score))::int
FROM normalized
GROUP BY record_date, shift, machine_id
ON CONFLICT (record_date, shift, machine_id)
DO UPDATE SET
  parts_produced = EXCLUDED.parts_produced,
  parts_rejected = EXCLUDED.parts_rejected,
  production_target = EXCLUDED.production_target,
  efficiency_pct = EXCLUDED.efficiency_pct;
"""

UPSERT_ENERGY_OUTPUT_DAILY_SQL = """
WITH base AS (
  SELECT
    sp.record_date,
    sp.machine_id,
    COALESCE(SUM(mpp.energy_kwh_used), 0)::numeric AS energy_kwh,
    SUM(sp.parts_produced)::int AS production,
    COALESCE(SUM(mpp.runtime_hours), 0)::numeric AS runtime_hours,
    COALESCE(SUM(mpp.idle_hours), 0)::numeric AS idle_hours,
    ROUND(AVG(sp.efficiency_pct))::int AS efficiency_score
  FROM shift_production sp
  LEFT JOIN machine_parts_produced mpp
    ON mpp.machine_id = sp.machine_id
   AND mpp.shift = sp.shift
   AND (
      CASE
        WHEN mpp.shift = 'Shift C (22-06)' AND EXTRACT(HOUR FROM mpp.recorded_at) < 6
        THEN (mpp.recorded_at::date - INTERVAL '1 day')::date
        ELSE mpp.recorded_at::date
      END
   ) = sp.record_date
  GROUP BY sp.record_date, sp.machine_id
), cfg AS (
  SELECT COALESCE((SELECT tariff_per_kwh FROM system_config ORDER BY created_at DESC LIMIT 1), 8.5)::numeric AS tariff_per_kwh
)
INSERT INTO energy_output_daily (
  record_date, machine_id, energy_kwh, production,
  runtime_hours, idle_hours, energy_per_part, cost_per_part,
  efficiency_score, status
)
SELECT
  b.record_date,
  b.machine_id,
  ROUND(b.energy_kwh, 2),
  b.production,
  ROUND(b.runtime_hours, 2),
  ROUND(b.idle_hours, 2),
  CASE WHEN b.production > 0 THEN ROUND((b.energy_kwh / b.production)::numeric, 3) ELSE 0 END,
  CASE WHEN b.production > 0 THEN ROUND(((b.energy_kwh / b.production) * cfg.tariff_per_kwh)::numeric, 2) ELSE 0 END,
  b.efficiency_score,
  CASE
    WHEN b.runtime_hours >= 4 THEN 'running'
    WHEN b.runtime_hours > 0 THEN 'idle'
    ELSE 'maintenance'
  END AS status
FROM base b
CROSS JOIN cfg
ON CONFLICT (record_date, machine_id)
DO UPDATE SET
  energy_kwh = EXCLUDED.energy_kwh,
  production = EXCLUDED.production,
  runtime_hours = EXCLUDED.runtime_hours,
  idle_hours = EXCLUDED.idle_hours,
  energy_per_part = EXCLUDED.energy_per_part,
  cost_per_part = EXCLUDED.cost_per_part,
  efficiency_score = EXCLUDED.efficiency_score,
  status = EXCLUDED.status;
"""

UPSERT_MONTHLY_SQL = """
WITH cfg AS (
  SELECT COALESCE((SELECT grid_emission_factor FROM system_config ORDER BY created_at DESC LIMIT 1), 0.82)::numeric AS ef
), base AS (
  SELECT
    EXTRACT(YEAR FROM record_date)::int AS year,
    TO_CHAR(record_date, 'Mon') AS month,
    SUM(production)::int AS total_production,
    ROUND(SUM(energy_kwh)::numeric, 2) AS total_energy_kwh,
    ROUND(AVG(efficiency_score))::int AS efficiency_score
  FROM energy_output_daily
  GROUP BY EXTRACT(YEAR FROM record_date), TO_CHAR(record_date, 'Mon')
)
INSERT INTO monthly_production (
  year, month, total_production, total_energy_kwh,
  avg_energy_per_part, efficiency_score, carbon_intensity
)
SELECT
  b.year,
  b.month,
  b.total_production,
  b.total_energy_kwh,
  CASE WHEN b.total_production > 0 THEN ROUND((b.total_energy_kwh / b.total_production)::numeric, 3) ELSE 0 END,
  b.efficiency_score,
  CASE WHEN b.total_production > 0 THEN ROUND(((b.total_energy_kwh * cfg.ef) / b.total_production)::numeric, 4) ELSE 0 END
FROM base b
CROSS JOIN cfg
ON CONFLICT (year, month)
DO UPDATE SET
  total_production = EXCLUDED.total_production,
  total_energy_kwh = EXCLUDED.total_energy_kwh,
  avg_energy_per_part = EXCLUDED.avg_energy_per_part,
  efficiency_score = EXCLUDED.efficiency_score,
  carbon_intensity = EXCLUDED.carbon_intensity;
"""

REFRESH_DEMAND_RECORDS_SQL = """
TRUNCATE TABLE demand_records;

WITH cfg AS (
  SELECT COALESCE((SELECT contract_demand_kva FROM system_config ORDER BY created_at DESC LIMIT 1), 85)::numeric AS contract
), per_tick AS (
  SELECT
    recorded_at,
    SUM(kw / NULLIF(power_factor, 0))::numeric AS demand_kva
  FROM machine_metrics
  GROUP BY recorded_at
), per_bucket AS (
  SELECT
    DATE_TRUNC('hour', recorded_at) + FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes' AS bucket_ts,
    MAX(demand_kva)::numeric AS demand_kva
  FROM per_tick
  GROUP BY DATE_TRUNC('hour', recorded_at) + FLOOR(EXTRACT(MINUTE FROM recorded_at) / 15) * INTERVAL '15 minutes'
)
INSERT INTO demand_records (
  recorded_at, demand_kva, contract_demand_kva, utilization_pct, risk_level
)
SELECT
  bucket_ts,
  ROUND(demand_kva, 2),
  cfg.contract,
  ROUND((demand_kva / cfg.contract) * 100)::int,
  CASE
    WHEN demand_kva >= cfg.contract * 0.95 THEN 'Critical'
    WHEN demand_kva >= cfg.contract * 0.80 THEN 'Warning'
    ELSE 'Normal'
  END
FROM per_bucket
CROSS JOIN cfg
ORDER BY bucket_ts;
"""

VERIFY_SQL = [
    ("reports", "SELECT COUNT(*) FROM reports"),
    ("shift_production", "SELECT COUNT(*) FROM shift_production"),
    ("energy_output_daily", "SELECT COUNT(*) FROM energy_output_daily"),
    ("monthly_production", "SELECT COUNT(*) FROM monthly_production"),
    ("demand_records", "SELECT COUNT(*) FROM demand_records"),
]


def main():
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        cur = conn.cursor()

        print("Creating report source tables...")
        cur.execute(CREATE_TABLES_SQL)

        print("Ensuring report metadata...")
        cur.execute(SEED_REPORTS_SQL)

        print("Building shift production from machine_parts_produced...")
        cur.execute(UPSERT_SHIFT_PRODUCTION_SQL)

        print("Building daily energy report data...")
        cur.execute(UPSERT_ENERGY_OUTPUT_DAILY_SQL)

        print("Building monthly efficiency report data...")
        cur.execute(UPSERT_MONTHLY_SQL)

        print("Rebuilding demand_records from machine_metrics...")
        cur.execute(REFRESH_DEMAND_RECORDS_SQL)

        conn.commit()

        print("\nVerification counts:")
        for name, sql in VERIFY_SQL:
            cur.execute(sql)
            print(f" - {name}: {cur.fetchone()[0]}")

        cur.close()
        print("\nReport dataset build complete.")
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Build failed: {e}")
        raise
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
