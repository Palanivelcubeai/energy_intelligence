"""
Generate live machine data AND fetch the latest readings every 45 seconds.

For each cycle:
  1. Generates one sensor tick for all 5 CNC machines (inserts into machine_metrics)
  2. Fetches and displays the latest values:
       - Power Factor
       - Voltage R / Y / B  (and average)
       - Current R / Y / B  (and average)
       - Rejection Count
       - Energy per Part

Run:  python fetch_machine_details.py
Stop: Ctrl+C
"""

import psycopg2
import random
import math
import time
import signal
import sys
from datetime import datetime, timezone
from psycopg2.extras import RealDictCursor

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "energy_db",
    "user": "postgres",
    "password": "12345",
}

INTERVAL_SEC = 20

# ── Machine profiles ─────────────────────────────────────────────────
PROFILES = {
    "CNC-1": {"kw_base": 18.5, "kw_var": 2.5, "pf": 0.92, "volt_base": 415, "curr_base": 28, "parts_per_hour": 18, "eff_base": 92, "reject_rate": 0.01},
    "CNC-2": {"kw_base": 22.0, "kw_var": 3.0, "pf": 0.89, "volt_base": 412, "curr_base": 34, "parts_per_hour": 16, "eff_base": 78, "reject_rate": 0.04},
    "CNC-3": {"kw_base": 14.0, "kw_var": 2.0, "pf": 0.85, "volt_base": 418, "curr_base": 22, "parts_per_hour": 12, "eff_base": 65, "reject_rate": 0.08},
    "CNC-4": {"kw_base": 15.8, "kw_var": 2.0, "pf": 0.94, "volt_base": 414, "curr_base": 24, "parts_per_hour": 20, "eff_base": 95, "reject_rate": 0.006},
    "CNC-5": {"kw_base": 13.0, "kw_var": 2.0, "pf": 0.90, "volt_base": 416, "curr_base": 20, "parts_per_hour": 14, "eff_base": 88, "reject_rate": 0.02},
}

INSERT_SQL = """
    INSERT INTO machine_metrics (
        machine_id, recorded_at,
        kw, kwh, power_factor,
        voltage_r, voltage_y, voltage_b,
        current_r, current_y, current_b,
        parts_produced, energy_per_part, rejection_count,
        runtime_hours, idle_hours, efficiency_score
    ) VALUES (
        %s, %s, %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s
    )
"""

running = True


def _on_signal(_s, _f):
    global running
    print("\n\nStopping... Goodbye!")
    running = False


signal.signal(signal.SIGINT, _on_signal)

QUERY = """
    SELECT
        m.id                                              AS machine_id,
        m.name                                            AS machine_name,
        m.status,

        -- Latest snapshot from machine_metrics (most recent row per machine)
        mm.power_factor,
        mm.voltage_r,
        mm.voltage_y,
        mm.voltage_b,
        mm.current_r,
        mm.current_y,
        mm.current_b,
        mm.rejection_count,
        mm.energy_per_part,
        mm.recorded_at

    FROM machines m
    LEFT JOIN LATERAL (
        SELECT *
        FROM machine_metrics
        WHERE machine_id = m.id
        ORDER BY recorded_at DESC
        LIMIT 1
    ) mm ON TRUE
    ORDER BY m.id;
"""


def print_separator(char="─", width=70):
    print(char * width)


def fmt(val, unit="", decimals=2) -> str:
    """Format a numeric value; shows '--' when no data is available."""
    if val is None:
        return "--"
    try:
        f = float(val)
        if math.isnan(f):
            return "--"
        return f"{f:.{decimals}f}{(' ' + unit) if unit else ''}"
    except (TypeError, ValueError):
        return "--"


# ── Data generation ───────────────────────────────────────────────────

def get_daily_totals(cur, machine_id, today_start):
    cur.execute(
        """SELECT COALESCE(MAX(kwh), 0),
                  COALESCE(MAX(parts_produced), 0),
                  COALESCE(MAX(rejection_count), 0),
                  COALESCE(MAX(runtime_hours), 0),
                  COALESCE(MAX(idle_hours), 0),
                  COALESCE((SELECT energy_per_part FROM machine_metrics
                             WHERE machine_id = %s AND recorded_at >= %s
                             ORDER BY recorded_at DESC LIMIT 1), 0)
           FROM machine_metrics
           WHERE machine_id = %s AND recorded_at >= %s""",
        (machine_id, today_start, machine_id, today_start),
    )
    return cur.fetchone()


def generate_and_insert(conn):
    """Generate one reading per machine and insert into machine_metrics."""
    now = datetime.now(timezone.utc)
    cur = conn.cursor()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    TICK_HOURS = INTERVAL_SEC / 3600

    for machine_id, p in PROFILES.items():
        hour = now.hour
        is_working = 6 <= hour < 22
        load_factor = random.uniform(0.85, 1.0) if is_working else 0.05
        if now.weekday() == 6:
            load_factor *= 0.3

        row = get_daily_totals(cur, machine_id, today_start)
        daily_kwh, daily_parts, daily_rejections, daily_runtime, daily_idle, last_epp = (
            float(row[0]), int(row[1]), int(row[2]), float(row[3]), float(row[4]), float(row[5])
        )

        if load_factor <= 0.05:
            status = "idle"
        elif random.random() < 0.002:
            status = "maintenance"
        else:
            status = "running"

        if status in ("idle", "maintenance"):
            kw  = round(random.uniform(0.3, 1.5), 1)
            pf  = round(random.uniform(0.4, 0.6), 2)
            vr = round(p["volt_base"] + random.uniform(-6, 6), 1)
            vy = round(p["volt_base"] + random.uniform(-6, 6), 1)
            vb = round(p["volt_base"] + random.uniform(-6, 6), 1)
            cr = cy = cb = round(random.uniform(0.2, 0.8), 1)
            new_parts = new_rej = 0
            runtime_inc, idle_inc = 0.0, round(TICK_HOURS, 4)
        else:
            fast = math.sin(2 * math.pi * time.time() / 30) * 0.12
            med  = math.sin(2 * math.pi * time.time() / 300) * 0.08
            spike = random.uniform(0.15, 0.35) if random.random() < 0.05 else 0.0
            dip   = -random.uniform(0.2, 0.4)  if random.random() < 0.04 else 0.0
            eff_load = max(0.15, load_factor + fast + med + spike + dip)

            kw = max(0.5, round(p["kw_base"] * eff_load + random.uniform(-p["kw_var"], p["kw_var"]) * eff_load, 1))
            pf = round(min(0.99, max(0.75, p["pf"] + random.uniform(-0.04, 0.04))), 2)
            v_base = p["volt_base"] + random.uniform(-2, 2)
            vr = round(v_base + random.uniform(-5, 5), 1)
            vy = round(v_base + random.uniform(-5, 5), 1)
            vb = round(v_base + random.uniform(-5, 5), 1)
            c_load = p["curr_base"] * eff_load
            cr = round(max(0, c_load + random.uniform(-3, 3)), 1)
            cy = round(max(0, c_load + random.uniform(-3, 3)), 1)
            cb = round(max(0, c_load + random.uniform(-3, 3)), 1)

            parts_per_tick = p["parts_per_hour"] * eff_load * TICK_HOURS
            # For a 45-second tick this is ~0.2–0.4 parts; round probabilistically
            new_parts = int(parts_per_tick) + (1 if random.random() < (parts_per_tick % 1) else 0)
            new_rej   = sum(1 for _ in range(new_parts) if random.random() < p["reject_rate"])
            runtime_inc, idle_inc = round(TICK_HOURS, 4), 0.0

        kwh_inc      = round(kw * TICK_HOURS, 4)
        total_kwh    = round(daily_kwh + kwh_inc, 2)
        total_parts  = daily_parts + new_parts
        total_rej    = daily_rejections + new_rej
        total_rt     = round(daily_runtime + runtime_inc, 2)
        total_idle   = round(daily_idle + idle_inc, 2)

        if total_parts > 0 and new_parts > 0:
            epp = round(total_kwh / total_parts, 2)
        else:
            epp = last_epp

        eff = max(0, min(100,
            p["eff_base"] + random.randint(-5, 5)
            + (2 if status == "running" and kw > p["kw_base"] * 0.7 else -2)
            - int(total_rej * 0.5)
        ))

        cur.execute(INSERT_SQL, (
            machine_id, now,
            kw, total_kwh, pf,
            vr, vy, vb,
            cr, cy, cb,
            total_parts, epp, total_rej,
            total_rt, total_idle, eff,
        ))
        cur.execute("UPDATE machines SET status = %s WHERE id = %s", (status, machine_id))

    conn.commit()
    cur.close()
    print(f"  ✓ Data generated at {now.strftime('%H:%M:%S')}")

def safe_float(val):
    """Convert Decimal/int/float to float safely; return None on NaN or None."""
    if val is None:
        return None
    try:
        f = float(val)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def avg3(a, b, c):
    """Return average of three values computed in Python, or None if any missing."""
    a, b, c = safe_float(a), safe_float(b), safe_float(c)
    if None in (a, b, c):
        return None
    return round((a + b + c) / 3, 2)


def display_machine(row: dict) -> None:
    ts = row['recorded_at'].strftime('%Y-%m-%d %H:%M:%S') if row['recorded_at'] else 'No data yet'
    avg_v = avg3(row['voltage_r'], row['voltage_y'], row['voltage_b'])
    avg_c = avg3(row['current_r'], row['current_y'], row['current_b'])
    print_separator()
    print(f"  Machine : {row['machine_id']}  |  {row['machine_name']}  |  Status: {row['status'].upper()}")
    print(f"  As of   : {ts}")
    print()
    print(f"    Power Factor       : {fmt(safe_float(row['power_factor']))}")
    print()
    print(f"    Voltage R          : {fmt(safe_float(row['voltage_r']), 'V', 1)}")
    print(f"    Voltage Y          : {fmt(safe_float(row['voltage_y']), 'V', 1)}")
    print(f"    Voltage B          : {fmt(safe_float(row['voltage_b']), 'V', 1)}")
    print(f"    Avg Voltage        : {fmt(avg_v, 'V', 1)}")
    print()
    print(f"    Current R          : {fmt(safe_float(row['current_r']), 'A', 1)}")
    print(f"    Current Y          : {fmt(safe_float(row['current_y']), 'A', 1)}")
    print(f"    Current B          : {fmt(safe_float(row['current_b']), 'A', 1)}")
    print(f"    Avg Current        : {fmt(avg_c, 'A', 2)}")
    print()
    print(f"    Rejection Count    : {fmt(row['rejection_count'])}")
    print(f"    Energy / Part      : {fmt(safe_float(row['energy_per_part']), 'kWh', 2)}")


def main() -> None:
    conn = None
    cycle = 0
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print("═" * 70)
        print("  LIVE MACHINE DETAILS  —  Generate + Fetch every 45 seconds")
        print("  Press Ctrl+C to stop")
        print("═" * 70)

        while running:
            cycle += 1
            print(f"\n{'═' * 70}")
            print(f"  Cycle #{cycle}  —  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print("═" * 70)

            # Step 1: Generate data
            generate_and_insert(conn)

            # Step 2: Fetch and display
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(QUERY)
            rows = cur.fetchall()
            cur.close()

            if not rows:
                print("  No machines found.")
            else:
                for row in rows:
                    display_machine(row)
                print_separator()
                print(f"\n  Total machines: {len(rows)}")

            if not running:
                break

            print(f"\n  Next fetch in {INTERVAL_SEC}s...  (Ctrl+C to stop)")
            # Sleep in small chunks so Ctrl+C is responsive
            for _ in range(INTERVAL_SEC):
                if not running:
                    break
                time.sleep(1)

    except psycopg2.OperationalError as e:
        print(f"Database connection error: {e}")
        sys.exit(1)
    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn:
            conn.close()
        print(f"\nDone. Total cycles: {cycle}")


if __name__ == "__main__":
    main()
