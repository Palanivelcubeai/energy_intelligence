"""
Create and seed production tables.

Tables created:
  1. production_summary      – Daily / per-shift plant-wide production totals
  2. machine_parts_produced  – Per-machine timestamped parts breakdown

Run:  python create_production_tables.py
"""

import psycopg2
import random
from datetime import date, datetime, timedelta, timezone

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "energy_db",
    "user": "postgres",
    "password": "12345",
}

# ── Machine list (must match the machines table) ──────────────────────
MACHINE_IDS = ["CNC-1", "CNC-2", "CNC-3", "CNC-4", "CNC-5"]

SHIFTS = [
    "Shift A (06-14)",
    "Shift B (14-22)",
    "Shift C (22-06)",
]

# Parts profile per machine per shift (target, reject rate, kWh/part base)
MACHINE_PROFILE = {
    "CNC-1": {"parts_target": 50,  "reject_rate": 0.01, "kwh_per_part": 1.05},
    "CNC-2": {"parts_target": 45,  "reject_rate": 0.04, "kwh_per_part": 1.42},
    "CNC-3": {"parts_target": 35,  "reject_rate": 0.08, "kwh_per_part": 1.20},
    "CNC-4": {"parts_target": 58,  "reject_rate": 0.006,"kwh_per_part": 0.85},
    "CNC-5": {"parts_target": 40,  "reject_rate": 0.02, "kwh_per_part": 0.95},
}

SEED_DAYS = 7   # How many past days of data to generate

# =====================================================================
# DDL
# =====================================================================

# 1. Plant-wide daily / shift production summary
CREATE_PRODUCTION_SUMMARY = """
CREATE TABLE IF NOT EXISTS production_summary (
    id                    BIGSERIAL    PRIMARY KEY,

    shift                 VARCHAR(30)  NOT NULL
                              CHECK (shift IN ('Shift A (06-14)', 'Shift B (14-22)', 'Shift C (22-06)', 'Daily')),

    -- Aggregated across all machines
    total_parts_produced  INTEGER      NOT NULL DEFAULT 0,
    total_parts_rejected  INTEGER      NOT NULL DEFAULT 0,
    good_parts            INTEGER      GENERATED ALWAYS AS (total_parts_produced - total_parts_rejected) STORED,

    -- Performance
    overall_efficiency_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    total_energy_kwh       NUMERIC(10,2) NOT NULL DEFAULT 0,
    avg_energy_per_part    NUMERIC(8,3)  NOT NULL DEFAULT 0,

    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_at TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_summary_date_shift
    ON production_summary ((recorded_at::date), shift);
"""

# 2. Per-machine parts produced detail
CREATE_MACHINE_PARTS_PRODUCED = """
CREATE TABLE IF NOT EXISTS machine_parts_produced (
    id               BIGSERIAL    PRIMARY KEY,

    machine_id       VARCHAR(20)  NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    shift            VARCHAR(30)  NOT NULL
                         CHECK (shift IN ('Shift A (06-14)', 'Shift B (14-22)', 'Shift C (22-06)')),

    -- Counts
    parts_produced   INTEGER      NOT NULL DEFAULT 0,
    parts_rejected   INTEGER      NOT NULL DEFAULT 0,
    good_parts       INTEGER      GENERATED ALWAYS AS (parts_produced - parts_rejected) STORED,
    production_target INTEGER     NOT NULL DEFAULT 0,

    -- Energy for this machine / shift
    energy_kwh_used  NUMERIC(10,2) NOT NULL DEFAULT 0,
    energy_per_part  NUMERIC(8,3)  NOT NULL DEFAULT 0,

    -- Efficiency & runtime
    efficiency_score INTEGER      NOT NULL DEFAULT 0
                         CHECK (efficiency_score BETWEEN 0 AND 100),
    runtime_hours    NUMERIC(5,2) NOT NULL DEFAULT 0,
    idle_hours       NUMERIC(5,2) NOT NULL DEFAULT 0,

    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_at TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mpp_machine_date_shift
    ON machine_parts_produced (machine_id, (recorded_at::date), shift);
CREATE INDEX IF NOT EXISTS idx_mpp_date_shift
    ON machine_parts_produced ((recorded_at::date) DESC, shift);
"""

# =====================================================================
# Seed helpers
# =====================================================================

def _seed_machine_parts(cur, day: date, shift: str, is_maintenance_day: bool):
    """Insert one row per machine for the given date + shift.
    Returns a dict of machine_id -> row values for rolling up into summary."""
    rows = {}
    for mid in MACHINE_IDS:
        p = MACHINE_PROFILE[mid]

        # CNC-5 is in maintenance – reduced output
        if mid == "CNC-5" and is_maintenance_day:
            produced = random.randint(0, 5)
            runtime  = round(random.uniform(0.0, 1.5), 2)
        elif shift == "Shift C (22-06)":
            # Night shift – lower utilisation
            produced = random.randint(
                max(0, p["parts_target"] - 20),
                p["parts_target"] - 5,
            )
            runtime = round(random.uniform(5.5, 7.0), 2)
        else:
            produced = random.randint(
                max(0, p["parts_target"] - 10),
                p["parts_target"] + 5,
            )
            runtime = round(random.uniform(7.0, 8.0), 2)

        rejected = sum(1 for _ in range(produced) if random.random() < p["reject_rate"])
        energy   = round(produced * p["kwh_per_part"] * random.uniform(0.95, 1.05), 2)
        epp      = round(energy / produced, 3) if produced > 0 else 0.0
        idle     = round(8.0 - runtime, 2)
        eff      = max(0, min(100, int((produced / p["parts_target"]) * 100) + random.randint(-3, 3)))

        day_ts = datetime.combine(day, datetime.min.time())
        cur.execute(
            """
            INSERT INTO machine_parts_produced (
                machine_id, shift,
                parts_produced, parts_rejected, production_target,
                energy_kwh_used, energy_per_part,
                efficiency_score, runtime_hours, idle_hours,
                recorded_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (machine_id, (recorded_at::date), shift) DO NOTHING
            """,
            (mid, shift,
             produced, rejected, p["parts_target"],
             energy, epp,
             eff, runtime, idle, day_ts),
        )
        rows[mid] = dict(produced=produced, rejected=rejected, energy=energy, eff=eff)

    return rows


def _seed_summary(cur, day: date, shift: str, machine_rows: dict):
    """Roll up machine rows into the production_summary table."""
    total_produced = sum(r["produced"] for r in machine_rows.values())
    total_rejected = sum(r["rejected"] for r in machine_rows.values())
    total_energy   = round(sum(r["energy"]   for r in machine_rows.values()), 2)
    avg_eff        = round(sum(r["eff"] for r in machine_rows.values()) / len(machine_rows), 2)
    epp            = round(total_energy / total_produced, 3) if total_produced > 0 else 0.0

    day_ts = datetime.combine(day, datetime.min.time())
    cur.execute(
        """
        INSERT INTO production_summary (
            shift,
            total_parts_produced, total_parts_rejected,
            overall_efficiency_pct, total_energy_kwh, avg_energy_per_part,
            recorded_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ((recorded_at::date), shift) DO NOTHING
        """,
        (shift,
         total_produced, total_rejected,
         avg_eff, total_energy, epp, day_ts),
    )


def _seed_daily_rollup(cur, day: date):
    """Build the 'Daily' summary row from the three shift rows."""
    day_ts = datetime.combine(day, datetime.min.time())
    cur.execute(
        """
        SELECT
            SUM(total_parts_produced),
            SUM(total_parts_rejected),
            ROUND(AVG(overall_efficiency_pct)::numeric, 2),
            SUM(total_energy_kwh),
            CASE WHEN SUM(total_parts_produced) > 0
                 THEN ROUND((SUM(total_energy_kwh) / SUM(total_parts_produced))::numeric, 3)
                 ELSE 0 END
        FROM production_summary
        WHERE recorded_at::date = %s AND shift != 'Daily'
        """,
        (day,),
    )
    row = cur.fetchone()
    if row and row[0] is not None:
        cur.execute(
            """
            INSERT INTO production_summary (
                shift,
                total_parts_produced, total_parts_rejected,
                overall_efficiency_pct, total_energy_kwh, avg_energy_per_part,
                recorded_at
            ) VALUES ('Daily', %s, %s, %s, %s, %s, %s)
            ON CONFLICT ((recorded_at::date), shift) DO NOTHING
            """,
            (int(row[0]), int(row[1]), row[2], row[3], row[4], day_ts),
        )


def seed_data(cur):
    today = date.today()
    total_mpp = 0
    total_ps  = 0

    for day_offset in range(SEED_DAYS, 0, -1):
        d = today - timedelta(days=day_offset)
        # CNC-5 is in maintenance on the oldest day in the seed window
        is_maintenance = (day_offset == SEED_DAYS)

        for shift in SHIFTS:
            mrows = _seed_machine_parts(cur, d, shift, is_maintenance)
            _seed_summary(cur, d, shift, mrows)
            total_mpp += len(mrows)
            total_ps  += 1

        _seed_daily_rollup(cur, d)
        total_ps += 1

    return total_mpp, total_ps


# =====================================================================
# Main
# =====================================================================

def main():
    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cur = conn.cursor()
        print("Connected to PostgreSQL.\n")

        # ── Step 1: Create tables ──────────────────────────────────────
        print("Step 1: Creating production_summary table...")
        cur.execute(CREATE_PRODUCTION_SUMMARY)
        print("  production_summary table created.\n")

        print("Step 2: Creating machine_parts_produced table...")
        cur.execute(CREATE_MACHINE_PARTS_PRODUCED)
        print("  machine_parts_produced table created.\n")

        # ── Step 2: Seed data ──────────────────────────────────────────
        print(f"Step 3: Seeding {SEED_DAYS} days of production data...")
        mpp_rows, ps_rows = seed_data(cur)
        print(f"  {mpp_rows} rows inserted into machine_parts_produced.")
        print(f"  {ps_rows} rows inserted into production_summary.\n")

        # ── Step 3: Verify ─────────────────────────────────────────────
        print("Step 4: Verification")

        cur.execute("SELECT COUNT(*) FROM production_summary WHERE shift = 'Daily';")
        print(f"  production_summary  – Daily rows  : {cur.fetchone()[0]}")

        cur.execute("SELECT COUNT(*) FROM production_summary WHERE shift != 'Daily';")
        print(f"  production_summary  – Shift rows  : {cur.fetchone()[0]}")

        cur.execute("SELECT COUNT(*) FROM machine_parts_produced;")
        print(f"  machine_parts_produced – Total rows: {cur.fetchone()[0]}")

        print("\n  Latest daily summary (most recent 3 days):")
        cur.execute(
            """
            SELECT record_date, total_parts_produced, total_parts_rejected,
                   good_parts, overall_efficiency_pct, total_energy_kwh
            FROM production_summary
            WHERE shift = 'Daily'
            ORDER BY record_date DESC
            LIMIT 3
            """
        )
        print(f"  {'Date':<12} {'Produced':>9} {'Rejected':>9} {'Good':>6} {'Eff %':>6} {'kWh':>8}")
        print("  " + "-" * 56)
        for r in cur.fetchall():
            print(f"  {str(r[0]):<12} {r[1]:>9} {r[2]:>9} {r[3]:>6} {float(r[4]):>6.1f} {float(r[5]):>8.1f}")

        print("\n  Per-machine breakdown (today - 1 day, Shift A):")
        yesterday = date.today() - timedelta(days=1)
        cur.execute(
            """
            SELECT machine_id, parts_produced, parts_rejected, good_parts,
                   energy_kwh_used, efficiency_score
            FROM machine_parts_produced
            WHERE record_date = %s AND shift = 'Shift A (06-14)'
            ORDER BY machine_id
            """,
            (yesterday,),
        )
        print(f"  {'Machine':<10} {'Produced':>9} {'Rejected':>9} {'Good':>6} {'kWh':>8} {'Eff%':>5}")
        print("  " + "-" * 52)
        for r in cur.fetchall():
            print(f"  {r[0]:<10} {r[1]:>9} {r[2]:>9} {r[3]:>6} {float(r[4]):>8.2f} {r[5]:>5}")

        cur.close()
        print("\nDone!")

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
