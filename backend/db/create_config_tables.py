"""
Create configuration tables for the AdminConfig page:
  1. system_config — Plant, Energy, and Alert Threshold settings (single row)
  2. ALTER machines — Add rated_power_kw and production_target columns

Run: python create_config_tables.py
"""

import psycopg2

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "energy_db",
    "user": "postgres",
    "password": "12345",
}


def main():
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cur = conn.cursor()
        print("Connected to PostgreSQL.\n")

        # ── 1. system_config table ────────────────────────────────────
        print("Creating system_config table...")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS system_config (
                id              SERIAL PRIMARY KEY,

                -- Plant Configuration
                plant_name      VARCHAR(200)   NOT NULL DEFAULT '',
                location        VARCHAR(200)   NOT NULL DEFAULT '',
                industry_type   VARCHAR(100)   NOT NULL DEFAULT '',
                machine_count   INTEGER        NOT NULL DEFAULT 0,

                -- Energy Configuration
                tariff_per_kwh          NUMERIC(8,2)  NOT NULL DEFAULT 0,
                contract_demand_kva     NUMERIC(10,2) NOT NULL DEFAULT 0,
                grid_emission_factor    NUMERIC(6,4)  NOT NULL DEFAULT 0,
                demand_penalty_rate     NUMERIC(8,2)  NOT NULL DEFAULT 0,
                renewable_percent       INTEGER       NOT NULL DEFAULT 0,

                -- Alert Threshold Settings
                pf_minimum              NUMERIC(4,2)  NOT NULL DEFAULT 0,
                thd_maximum             NUMERIC(5,2)  NOT NULL DEFAULT 0,
                idle_time_threshold_hrs NUMERIC(5,2)  NOT NULL DEFAULT 0,
                demand_warning_percent  INTEGER       NOT NULL DEFAULT 0,
                energy_per_part_deviation INTEGER     NOT NULL DEFAULT 0,

                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """)
        print("  ✓ system_config table created.\n")

        # Insert default row if none exists
        cur.execute("SELECT COUNT(*) FROM system_config;")
        count = cur.fetchone()[0]
        if count == 0:
            print("Inserting default configuration row...")
            cur.execute("""
                INSERT INTO system_config (
                    plant_name, location, industry_type, machine_count,
                    tariff_per_kwh, contract_demand_kva, grid_emission_factor,
                    demand_penalty_rate, renewable_percent,
                    pf_minimum, thd_maximum, idle_time_threshold_hrs,
                    demand_warning_percent, energy_per_part_deviation
                ) VALUES (
                    'CNC Works', 'Chennai, India', 'CNC Manufacturing', 5,
                    8.50, 100.00, 0.82,
                    200.00, 0,
                    0.85, 5.00, 2.00,
                    80, 15
                );
            """)
            print("  ✓ Default config inserted.\n")
        else:
            print(f"  Config row already exists ({count} row(s)).\n")

        # ── 2. Add columns to machines table ──────────────────────────
        print("Adding rated_power_kw and production_target to machines table...")

        # Check if columns already exist
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'machines'
            AND column_name IN ('rated_power_kw', 'production_target');
        """)
        existing_cols = [row[0] for row in cur.fetchall()]

        if 'rated_power_kw' not in existing_cols:
            cur.execute("ALTER TABLE machines ADD COLUMN rated_power_kw NUMERIC(8,2) NOT NULL DEFAULT 0;")
            print("  ✓ Added rated_power_kw column.")
        else:
            print("  rated_power_kw already exists.")

        if 'production_target' not in existing_cols:
            cur.execute("ALTER TABLE machines ADD COLUMN production_target INTEGER NOT NULL DEFAULT 0;")
            print("  ✓ Added production_target column.")
        else:
            print("  production_target already exists.")

        # Set default rated power values for existing machines
        print("\nSetting default rated power and production targets...")
        # Targets = parts_per_hour × 16 active hours/day × machine efficiency factor
        # CNC-1: 18 ph × 16h × 0.92 = 265  | CNC-2: 16 × 16 × 0.89 = 228
        # CNC-3: 12 × 16 × 0.85 = 163       | CNC-4: 20 × 16 × 0.94 = 301
        # CNC-5: 14 × 16 × 0.90 = 202
        defaults = {
            "CNC-1": (18.5, 265),
            "CNC-2": (22.0, 228),
            "CNC-3": (14.0, 163),
            "CNC-4": (15.8, 301),
            "CNC-5": (13.0, 202),
        }
        for machine_id, (power, target) in defaults.items():
            cur.execute(
                "UPDATE machines SET rated_power_kw = %s, production_target = %s WHERE id = %s;",
                (power, target, machine_id),
            )
            print(f"  {machine_id}: rated_power={power} kW, target={target} parts/day")

        # ── 3. Verify ────────────────────────────────────────────────
        print("\n── Verification ──")

        cur.execute("SELECT * FROM system_config LIMIT 1;")
        row = cur.fetchone()
        cols = [desc[0] for desc in cur.description]
        print("\nsystem_config:")
        for col, val in zip(cols, row):
            print(f"  {col}: {val}")

        cur.execute("SELECT id, name, rated_power_kw, production_target, status FROM machines ORDER BY id;")
        print("\nmachines:")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]}, {r[2]} kW, target={r[3]}, {r[4]}")

        cur.close()
        print("\n✓ All config tables ready.")

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn:
            conn.close()
            print("Connection closed.")


if __name__ == "__main__":
    main()
