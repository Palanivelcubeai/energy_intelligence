import psycopg2
import random
from datetime import datetime, timedelta, timezone

# Database connection config
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db_config import DB_CONFIG

# ── Tables to DROP (everything except users) ──────────────────────────
TABLES_TO_DROP = [
    "carbon_emissions",
    "carbon_insights",
    "demand_records",
    "energy_output_daily",
    "insights",
    "load_curve",
    "machine_metrics",
    "monthly_production",
    "power_quality",
    "production_trend",
    "reports",
    "shift_production",
    "system_config",
]

# ── machines: master list of 5 CNC machines ───────────────────────────
CREATE_MACHINES_TABLE = """
CREATE TABLE IF NOT EXISTS machines (
    id           VARCHAR(20)  PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    model        VARCHAR(100) NOT NULL,
    status       VARCHAR(20)  NOT NULL DEFAULT 'idle'
                     CHECK (status IN ('running', 'idle', 'maintenance')),
    product_type VARCHAR(100) NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
"""

# ── machine_metrics: time-series readings per machine ─────────────────
CREATE_MACHINE_METRICS_TABLE = """
CREATE TABLE IF NOT EXISTS machine_metrics (
    id               BIGSERIAL    PRIMARY KEY,
    machine_id       VARCHAR(20)  NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    recorded_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Power & Energy
    kw               NUMERIC(8,2)  NOT NULL DEFAULT 0,
    kwh              NUMERIC(10,2) NOT NULL DEFAULT 0,
    power_factor     NUMERIC(4,2)  NOT NULL DEFAULT 0,

    -- Voltage (3-phase R, Y, B)
    voltage_r        NUMERIC(6,1) NOT NULL DEFAULT 0,
    voltage_y        NUMERIC(6,1) NOT NULL DEFAULT 0,
    voltage_b        NUMERIC(6,1) NOT NULL DEFAULT 0,

    -- Current (3-phase R, Y, B)
    current_r        NUMERIC(6,1) NOT NULL DEFAULT 0,
    current_y        NUMERIC(6,1) NOT NULL DEFAULT 0,
    current_b        NUMERIC(6,1) NOT NULL DEFAULT 0,

    -- Production
    parts_produced   INTEGER      NOT NULL DEFAULT 0,
    energy_per_part  NUMERIC(6,2) NOT NULL DEFAULT 0,
    rejection_count  INTEGER      NOT NULL DEFAULT 0,

    -- Time tracking
    runtime_hours    NUMERIC(5,1) NOT NULL DEFAULT 0,
    idle_hours       NUMERIC(5,1) NOT NULL DEFAULT 0,

    -- Efficiency
    efficiency_score INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_machine_metrics_machine_id
    ON machine_metrics(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_metrics_recorded_at
    ON machine_metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_machine_metrics_machine_time
    ON machine_metrics(machine_id, recorded_at DESC);
"""

# ── Drop views that depend on old tables ──────────────────────────────
DROP_VIEWS = """
DROP VIEW IF EXISTS v_machine_overview CASCADE;
DROP VIEW IF EXISTS v_daily_summary CASCADE;
DROP VIEW IF EXISTS v_carbon_overview CASCADE;
"""

# ── 5 CNC Machines seed data ─────────────────────────────────────────
MACHINES_SEED = [
    ("CNC-1", "CNC-1", "Haas VF-2",    "running",     "Shaft"),
    ("CNC-2", "CNC-2", "DMG Mori",     "running",     "Gear"),
    ("CNC-3", "CNC-3", "Mazak",        "idle",        "Housing"),
    ("CNC-4", "CNC-4", "Fanuc",        "running",     "Bracket"),
    ("CNC-5", "CNC-5", "Okuma",        "maintenance", "Pin"),
]

# Machine profiles for realistic metric generation
MACHINE_PROFILES = {
    "CNC-1": {"kw_range": (16, 21),  "pf": 0.92, "volt_base": 415, "curr_base": 28, "parts_rate": 18, "eff": 92, "reject_rate": 0.01},
    "CNC-2": {"kw_range": (19, 25),  "pf": 0.89, "volt_base": 412, "curr_base": 34, "parts_rate": 16, "eff": 78, "reject_rate": 0.04},
    "CNC-3": {"kw_range": (2, 5),    "pf": 0.85, "volt_base": 418, "curr_base": 5,  "parts_rate": 12, "eff": 65, "reject_rate": 0.08},
    "CNC-4": {"kw_range": (13, 18),  "pf": 0.94, "volt_base": 414, "curr_base": 24, "parts_rate": 20, "eff": 95, "reject_rate": 0.006},
    "CNC-5": {"kw_range": (0, 0),    "pf": 0.00, "volt_base": 0,   "curr_base": 0,  "parts_rate": 0,  "eff": 88, "reject_rate": 0.00},
}


def generate_metrics(cur):
    """Generate 24 hours of hourly metric snapshots for each machine."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    rows = []

    for machine_id, profile in MACHINE_PROFILES.items():
        cumulative_kwh = 0
        cumulative_parts = 0
        cumulative_rejections = 0
        cumulative_runtime = 0.0
        cumulative_idle = 0.0

        for hour_offset in range(24):
            t = now - timedelta(hours=23 - hour_offset)
            kw_lo, kw_hi = profile["kw_range"]

            if machine_id == "CNC-5":
                # Maintenance: ran for 3 hours early, then stopped
                if hour_offset < 3:
                    kw = round(random.uniform(12, 16), 1)
                    parts = random.randint(15, 20)
                    runtime = 1.0
                    idle = 0.0
                else:
                    kw = 0
                    parts = 0
                    runtime = 0.0
                    idle = 0.5 if hour_offset < 4 else 0.0
            elif machine_id == "CNC-3":
                # Idle: low power
                kw = round(random.uniform(kw_lo, kw_hi), 1)
                parts = random.randint(10, 15) if hour_offset >= 6 and hour_offset <= 18 else 0
                runtime = 0.8 if parts > 0 else 0.0
                idle = 0.2 if parts > 0 else 1.0
            else:
                # Running normally
                kw = round(random.uniform(kw_lo, kw_hi), 1)
                parts = random.randint(profile["parts_rate"] - 4, profile["parts_rate"] + 4) if hour_offset >= 6 else random.randint(0, 3)
                runtime = round(random.uniform(0.8, 1.0), 1) if hour_offset >= 6 else 0.0
                idle = round(1.0 - runtime, 1)

            kwh_this_hour = round(kw * 1.0, 1)  # kW * 1 hour
            cumulative_kwh += kwh_this_hour
            cumulative_parts += parts
            rejections = int(parts * profile["reject_rate"] + random.random() * 0.5)
            cumulative_rejections += rejections
            cumulative_runtime += runtime
            cumulative_idle += idle

            pf = profile["pf"] + random.uniform(-0.02, 0.02) if kw > 0 else 0
            vr = profile["volt_base"] + random.uniform(-3, 3) if kw > 0 else 0
            vy = profile["volt_base"] + random.uniform(-3, 3) if kw > 0 else 0
            vb = profile["volt_base"] + random.uniform(-3, 3) if kw > 0 else 0
            cr = profile["curr_base"] + random.uniform(-2, 2) if kw > 0 else 0
            cy = profile["curr_base"] + random.uniform(-2, 2) if kw > 0 else 0
            cb = profile["curr_base"] + random.uniform(-2, 2) if kw > 0 else 0
            epp = round(cumulative_kwh / cumulative_parts, 2) if cumulative_parts > 0 else 0
            eff = profile["eff"] + random.randint(-3, 3)

            rows.append((
                machine_id, t,
                kw, round(cumulative_kwh, 1), round(pf, 2),
                round(vr, 1), round(vy, 1), round(vb, 1),
                round(cr, 1), round(cy, 1), round(cb, 1),
                cumulative_parts, epp, cumulative_rejections,
                round(cumulative_runtime, 1), round(cumulative_idle, 1),
                max(0, min(100, eff)),
            ))

    insert_sql = """
        INSERT INTO machine_metrics (
            machine_id, recorded_at,
            kw, kwh, power_factor,
            voltage_r, voltage_y, voltage_b,
            current_r, current_y, current_b,
            parts_produced, energy_per_part, rejection_count,
            runtime_hours, idle_hours,
            efficiency_score
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    cur.executemany(insert_sql, rows)
    return len(rows)


def main():
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cur = conn.cursor()
        print("Connected to PostgreSQL.\n")

        # ── Step 1: Drop views ────────────────────────────────────────
        print("Step 1: Dropping old views...")
        cur.execute(DROP_VIEWS)
        print("  Views dropped.\n")

        # ── Step 2: Drop unwanted tables ──────────────────────────────
        print("Step 2: Dropping unwanted tables...")
        # Also drop old machines table to recreate cleanly
        cur.execute("DROP TABLE IF EXISTS machines CASCADE;")
        for table in TABLES_TO_DROP:
            cur.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
            print(f"  Dropped: {table}")
        print()

        # ── Step 3: Create machines table ─────────────────────────────
        print("Step 3: Creating machines table...")
        cur.execute(CREATE_MACHINES_TABLE)
        print("  machines table created.\n")

        # ── Step 4: Create machine_metrics table ──────────────────────
        print("Step 4: Creating machine_metrics table...")
        cur.execute(CREATE_MACHINE_METRICS_TABLE)
        print("  machine_metrics table created.\n")

        # ── Step 5: Seed machines ─────────────────────────────────────
        print("Step 5: Seeding 5 CNC machines...")
        for m in MACHINES_SEED:
            cur.execute(
                "INSERT INTO machines (id, name, model, status, product_type) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING;",
                m,
            )
        print("  5 machines seeded.\n")

        # ── Step 6: Seed 24h of metrics ───────────────────────────────
        print("Step 6: Generating 24 hours of machine metrics...")
        count = generate_metrics(cur)
        print(f"  {count} metric rows inserted (24 per machine × 5 machines).\n")

        # ── Step 7: Verify ────────────────────────────────────────────
        print("Step 7: Verification")
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;")
        tables = [r[0] for r in cur.fetchall()]
        print(f"  Tables in database: {', '.join(tables)}")

        cur.execute("SELECT id, name, model, status, product_type FROM machines ORDER BY id;")
        print("\n  Machines:")
        for row in cur.fetchall():
            print(f"    {row[0]:8s} | {row[2]:12s} | {row[3]:12s} | {row[4]}")

        cur.execute("SELECT machine_id, COUNT(*), MIN(recorded_at), MAX(recorded_at) FROM machine_metrics GROUP BY machine_id ORDER BY machine_id;")
        print("\n  Metrics per machine:")
        for mid, cnt, mn, mx in cur.fetchall():
            print(f"    {mid}: {cnt} rows  ({mn} → {mx})")

        cur.close()
        print("\nDone! Database is ready.")

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
