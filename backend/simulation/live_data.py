"""
Live machine data generator — inserts a new row for each machine
every 2 seconds, simulating real-time sensor readings.

Also updates the machines table status based on current shift/conditions.

Run:  python live_data.py
Stop: Ctrl+C
"""

import psycopg2
import random
import math
import time
import signal
import sys
from datetime import datetime, timezone

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "energy_db",
    "user": "postgres",
    "password": "12345",
}

# ── Machine profiles (same as seed_one_month.py) ──────────────────────
PROFILES = {
    "CNC-1": {
        "kw_base": 18.5, "kw_var": 2.5,
        "pf": 0.92, "volt_base": 415, "curr_base": 28,
        "parts_per_hour": 18, "eff_base": 92, "reject_rate": 0.01,
    },
    "CNC-2": {
        "kw_base": 22.0, "kw_var": 3.0,
        "pf": 0.89, "volt_base": 412, "curr_base": 34,
        "parts_per_hour": 16, "eff_base": 78, "reject_rate": 0.04,
    },
    "CNC-3": {
        "kw_base": 14.0, "kw_var": 2.0,
        "pf": 0.85, "volt_base": 418, "curr_base": 22,
        "parts_per_hour": 12, "eff_base": 65, "reject_rate": 0.08,
    },
    "CNC-4": {
        "kw_base": 15.8, "kw_var": 2.0,
        "pf": 0.94, "volt_base": 414, "curr_base": 24,
        "parts_per_hour": 20, "eff_base": 95, "reject_rate": 0.006,
    },
    "CNC-5": {
        "kw_base": 13.0, "kw_var": 2.0,
        "pf": 0.90, "volt_base": 416, "curr_base": 20,
        "parts_per_hour": 14, "eff_base": 88, "reject_rate": 0.02,
    },
}

# ── State tracking (accumulates within each hour) ────────────────────
machine_state = {}

INSERT_SQL = """
    INSERT INTO machine_metrics (
        machine_id, recorded_at,
        kw, kwh, power_factor,
        voltage_r, voltage_y, voltage_b,
        current_r, current_y, current_b,
        parts_produced, energy_per_part, rejection_count,
        runtime_hours, idle_hours, efficiency_score
    ) VALUES (
        %s, %s,
        %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s,
        %s, %s, %s
    )
"""

UPDATE_STATUS_SQL = """
    UPDATE machines SET status = %s WHERE id = %s
"""

running = True


def signal_handler(_sig, _frame):
    global running
    print("\n\nStopping live data generator...")
    running = False


signal.signal(signal.SIGINT, signal_handler)


def is_working_hour(hour):
    return 6 <= hour < 22


def get_shift_load_factor(hour):
    """Realistic load factor based on time of day."""
    if not is_working_hour(hour):
        return 0.05  # Standby
    if hour == 6:
        return 0.4   # Morning ramp-up
    if hour == 7:
        return 0.7
    if hour == 13:
        return 0.75  # Lunch slowdown
    if hour == 14:
        return 0.6   # Shift changeover
    if hour == 21:
        return 0.5   # Winding down
    if 6 <= hour < 14:
        return random.uniform(0.85, 1.0)
    return random.uniform(0.80, 0.95)


def get_daily_totals(cur, machine_id, today_start):
    """Fetch today's accumulated totals from existing rows."""
    cur.execute(
        """SELECT COALESCE(SUM(kw), 0),
                  COALESCE(MAX(kwh), 0),
                  COALESCE(MAX(parts_produced), 0),
                  COALESCE(MAX(rejection_count), 0),
                  COALESCE(MAX(runtime_hours), 0),
                  COALESCE(MAX(idle_hours), 0)
           FROM machine_metrics
           WHERE machine_id = %s AND recorded_at >= %s""",
        (machine_id, today_start),
    )
    return cur.fetchone()


def generate_reading(machine_id, profile, now, cur):
    """Generate one realistic reading for a machine."""
    hour = now.hour
    is_sunday = now.weekday() == 6
    load_factor = get_shift_load_factor(hour)

    if is_sunday:
        load_factor *= 0.3

    # Get today's accumulated totals
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    row = get_daily_totals(cur, machine_id, today_start)
    daily_kwh = float(row[1])
    daily_parts = int(row[2])
    daily_rejections = int(row[3])
    daily_runtime = float(row[4])
    daily_idle = float(row[5])

    # Determine machine status
    if load_factor <= 0.05:
        status = "idle"
    elif load_factor < 0.3 and is_sunday:
        status = "idle"
    else:
        # Small chance of random maintenance event
        if random.random() < 0.002:  # ~0.2% per tick
            status = "maintenance"
        else:
            status = "running"

    TICK_HOURS = 2 / 3600  # 2 seconds as fraction of an hour

    if status == "maintenance":
        kw = round(random.uniform(0.1, 0.5), 1)  # Small standby draw
        pf = round(random.uniform(0.3, 0.5), 2)
        vr = round(profile["volt_base"] + random.uniform(-8, 8), 1)
        vy = round(profile["volt_base"] + random.uniform(-8, 8), 1)
        vb = round(profile["volt_base"] + random.uniform(-8, 8), 1)
        cr = cy = cb = round(random.uniform(0.1, 0.5), 1)
        new_parts = 0
        new_rejections = 0
        runtime_inc = 0.0
        idle_inc = round(TICK_HOURS, 4)
    elif status == "idle":
        kw = round(random.uniform(0.3, 1.5), 1)
        pf = round(random.uniform(0.4, 0.6), 2)
        vr = round(profile["volt_base"] + random.uniform(-6, 6), 1)
        vy = round(profile["volt_base"] + random.uniform(-6, 6), 1)
        vb = round(profile["volt_base"] + random.uniform(-6, 6), 1)
        cr = cy = cb = round(random.uniform(0.2, 0.8), 1)
        new_parts = 0
        new_rejections = 0
        runtime_inc = 0.0
        idle_inc = round(TICK_HOURS, 4)
    else:
        # Running — generate realistic values with rich variation
        day_phase = math.sin(2 * math.pi * now.day / 30) * 0.08
        # Fast oscillation: simulates tool engagement cycles (~30s period)
        fast_cycle = math.sin(2 * math.pi * time.time() / 30) * 0.12
        # Medium oscillation: simulates batch changeovers (~5min period)
        med_cycle = math.sin(2 * math.pi * time.time() / 300) * 0.08
        # Random spikes: sudden load surges (material hardness, tool wear)
        spike = random.uniform(0.15, 0.35) if random.random() < 0.05 else 0.0
        # Random dips: brief pauses (part changeover, measurement)
        dip = -random.uniform(0.2, 0.4) if random.random() < 0.04 else 0.0

        effective_load = max(0.15, load_factor + fast_cycle + med_cycle + spike + dip + day_phase)

        kw = round(
            profile["kw_base"] * effective_load
            + random.uniform(-profile["kw_var"] * 1.5, profile["kw_var"] * 1.5) * effective_load,
            1,
        )
        kw = max(0.5, kw)

        # Power factor fluctuates more under varying load
        pf_variation = 0.06 if spike or dip else 0.03
        pf = round(min(0.99, max(0.75, profile["pf"] + random.uniform(-pf_variation, pf_variation))), 2)

        # Voltage: slight imbalance between phases + random flicker
        v_base = profile["volt_base"] + random.uniform(-2, 2)  # Plant-level shift
        vr = round(v_base + random.uniform(-5, 5), 1)
        vy = round(v_base + random.uniform(-5, 5), 1)
        vb = round(v_base + random.uniform(-5, 5), 1)

        # Current: proportional to load with phase imbalance
        c_load = profile["curr_base"] * effective_load
        cr = round(max(0, c_load + random.uniform(-3, 3)), 1)
        cy = round(max(0, c_load + random.uniform(-3, 3)), 1)
        cb = round(max(0, c_load + random.uniform(-3, 3)), 1)

        # Parts: fractional accumulation per 2-second tick
        # Spike in load = faster production, dip = slower
        adjusted_rate = profile["parts_per_hour"] * effective_load
        parts_per_tick = adjusted_rate / 1800  # 1800 ticks per hour
        new_parts = 1 if random.random() < parts_per_tick else 0
        new_rejections = 1 if new_parts and random.random() < profile["reject_rate"] else 0

        runtime_inc = round(TICK_HOURS, 4)
        idle_inc = 0.0

    # Accumulate
    kwh_inc = round(kw * TICK_HOURS, 4)  # kW × (2/3600 hour)
    total_kwh = round(daily_kwh + kwh_inc, 2)
    total_parts = daily_parts + new_parts
    total_rejections = daily_rejections + new_rejections
    total_runtime = round(daily_runtime + runtime_inc, 2)
    total_idle = round(daily_idle + idle_inc, 2)
    epp = round(total_kwh / total_parts, 2) if total_parts > 0 else 0.0

    # Efficiency: varies with load, rejections, runtime, and random jitter
    eff_jitter = random.randint(-5, 5)
    eff_load_bonus = 2 if status == "running" and kw > profile["kw_base"] * 0.7 else -2
    eff = max(0, min(100,
        profile["eff_base"]
        + eff_jitter
        + eff_load_bonus
        - int(total_rejections * 0.5)
        + (3 if total_runtime > 8 else 0)
        - (4 if total_runtime > 14 else 0)  # Fatigue penalty in long shifts
    ))

    return (
        machine_id, now,
        kw, total_kwh, pf,
        vr, vy, vb,
        cr, cy, cb,
        total_parts, epp, total_rejections,
        total_runtime, total_idle,
        eff,
    ), status


def tick(conn):
    """Insert one reading per machine and update statuses."""
    now = datetime.now(timezone.utc)
    cur = conn.cursor()

    statuses = {}
    for machine_id, profile in PROFILES.items():
        row, status = generate_reading(machine_id, profile, now, cur)
        cur.execute(INSERT_SQL, row)
        statuses[machine_id] = status

    # Update machine statuses
    for machine_id, status in statuses.items():
        cur.execute(UPDATE_STATUS_SQL, (status, machine_id))

    conn.commit()
    cur.close()

    timestamp = now.strftime("%H:%M:%S")
    status_str = "  ".join(f"{mid}={s}" for mid, s in statuses.items())
    print(f"[{timestamp}]  {status_str}")


def main():
    print("=" * 60)
    print("  LIVE MACHINE DATA GENERATOR")
    print("  Inserts data every 2 seconds for 5 CNC machines")
    print("  Press Ctrl+C to stop")
    print("=" * 60)

    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        print(f"\nConnected to PostgreSQL ({DB_CONFIG['database']}).\n")

        # Verify machines exist
        cur = conn.cursor()
        cur.execute("SELECT id, name, status FROM machines ORDER BY id;")
        machines = cur.fetchall()
        cur.close()

        if not machines:
            print("ERROR: No machines found. Run create_machine_tables.py first.")
            return

        print("Machines found:")
        for m in machines:
            print(f"  {m[0]} — {m[1]} ({m[2]})")
        print(f"\nStarting live data generation...\n")

        tick_count = 0
        while running:
            tick(conn)
            tick_count += 1

            if tick_count % 30 == 0:
                print(f"  --- {tick_count} ticks ({tick_count * 2}s) ---")

            # Sleep 2 seconds
            time.sleep(2)
            if not running:
                break

    except psycopg2.OperationalError as e:
        print(f"Database connection error: {e}")
        sys.exit(1)
    finally:
        if conn:
            conn.close()
            print("Database connection closed.")
        print(f"Done. Total ticks: {tick_count if 'tick_count' in dir() else 0}")


if __name__ == "__main__":
    main()
