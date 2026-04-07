"""
Create three separate configuration tables:
  1. plant_config          — Plant / facility details
  2. energy_config         — Tariff, demand, and renewable energy settings
  3. alert_threshold_config — Threshold values that trigger warnings/alerts

Each table holds a single row; rows are inserted only when none exist.

Run: python create_split_config_tables.py
"""

import psycopg2

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db_config import DB_CONFIG

# ── DDL ───────────────────────────────────────────────────────────────

CREATE_PLANT_CONFIG = """
CREATE TABLE IF NOT EXISTS plant_config (
    id              SERIAL       PRIMARY KEY,
    plant_name      VARCHAR(200) NOT NULL DEFAULT '',
    location        VARCHAR(200) NOT NULL DEFAULT '',
    industry_type   VARCHAR(100) NOT NULL DEFAULT '',
    machine_count   INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
"""

CREATE_ENERGY_CONFIG = """
CREATE TABLE IF NOT EXISTS energy_config (
    id                      SERIAL        PRIMARY KEY,
    tariff_per_kwh          NUMERIC(8,2)  NOT NULL DEFAULT 0,
    contract_demand_kva     NUMERIC(10,2) NOT NULL DEFAULT 0,
    grid_emission_factor    NUMERIC(6,4)  NOT NULL DEFAULT 0,
    demand_penalty_rate     NUMERIC(8,2)  NOT NULL DEFAULT 0,
    renewable_percent       INTEGER       NOT NULL DEFAULT 0
                                CHECK (renewable_percent BETWEEN 0 AND 100),
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
"""

CREATE_ALERT_THRESHOLD_CONFIG = """
CREATE TABLE IF NOT EXISTS alert_threshold_config (
    id                        SERIAL       PRIMARY KEY,
    pf_minimum                NUMERIC(4,2) NOT NULL DEFAULT 0,
    thd_maximum               NUMERIC(5,2) NOT NULL DEFAULT 0,
    idle_time_threshold_hrs   NUMERIC(5,2) NOT NULL DEFAULT 0,
    demand_warning_percent    INTEGER      NOT NULL DEFAULT 0
                                  CHECK (demand_warning_percent BETWEEN 0 AND 100),
    energy_per_part_deviation INTEGER      NOT NULL DEFAULT 0,
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
"""

# ── Default seed values ───────────────────────────────────────────────

INSERT_PLANT_CONFIG = """
INSERT INTO plant_config
    (plant_name, location, industry_type, machine_count)
VALUES
    ('CNC Works', 'Chennai, India', 'CNC Manufacturing', 5);
"""

INSERT_ENERGY_CONFIG = """
INSERT INTO energy_config
    (tariff_per_kwh, contract_demand_kva, grid_emission_factor,
     demand_penalty_rate, renewable_percent)
VALUES
    (8.50, 100.00, 0.82, 200.00, 22);
"""

INSERT_ALERT_THRESHOLD_CONFIG = """
INSERT INTO alert_threshold_config
    (pf_minimum, thd_maximum, idle_time_threshold_hrs,
     demand_warning_percent, energy_per_part_deviation)
VALUES
    (0.85, 5.00, 2.00, 80, 15);
"""


def create_and_seed(cur, table_name: str, ddl: str, insert_sql: str) -> None:
    """Create *table_name* and insert one default row if the table is empty."""
    print(f"Creating {table_name} table...")
    cur.execute(ddl)
    print(f"  ✓ {table_name} table ready.")

    cur.execute(f"SELECT COUNT(*) FROM {table_name};")
    if cur.fetchone()[0] == 0:
        print(f"  Inserting default row into {table_name}...")
        cur.execute(insert_sql)
        print(f"  ✓ Default row inserted.\n")
    else:
        print(f"  Default row already exists — skipping insert.\n")


def verify(cur) -> None:
    """Print all rows from the three config tables."""
    tables = ["plant_config", "energy_config", "alert_threshold_config"]
    print("\n── Verification ──")
    for table in tables:
        cur.execute(f"SELECT * FROM {table} LIMIT 1;")
        row = cur.fetchone()
        if row is None:
            print(f"\n{table}: (empty)")
            continue
        cols = [desc[0] for desc in cur.description]
        print(f"\n{table}:")
        for col, val in zip(cols, row):
            print(f"  {col}: {val}")


def main() -> None:
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cur = conn.cursor()
        print("Connected to PostgreSQL.\n")

        create_and_seed(cur, "plant_config",           CREATE_PLANT_CONFIG,           INSERT_PLANT_CONFIG)
        create_and_seed(cur, "energy_config",          CREATE_ENERGY_CONFIG,          INSERT_ENERGY_CONFIG)
        create_and_seed(cur, "alert_threshold_config", CREATE_ALERT_THRESHOLD_CONFIG, INSERT_ALERT_THRESHOLD_CONFIG)

        verify(cur)

        cur.close()
        print("\n✓ All three config tables are ready.")

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn:
            conn.close()
            print("Connection closed.")


if __name__ == "__main__":
    main()
