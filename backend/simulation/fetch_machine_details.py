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
from datetime import datetime, timedelta, timezone
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

# Parts production target per 8-hour shift
PRODUCTION_TARGETS = {mid: round(p["parts_per_hour"] * 8) for mid, p in PROFILES.items()}


def ensure_machine_master_rows(conn) -> int:
    """Ensure all machine IDs used by the simulator exist in machines table.

    Supports both table variants seen in this repo:
    - machines(id, name, status, rated_power_kw, production_target, product_type, ...)
    - machines(id, name, model, status, product_type, ...)
    """
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'machines'
            """
        )
        machine_cols = {r[0] for r in cur.fetchall()}

        required = {"id", "name", "status"}
        if not required.issubset(machine_cols):
            raise RuntimeError("machines table is missing required columns (id, name, status)")

        insert_cols = ["id", "name", "status"]
        if "model" in machine_cols:
            insert_cols.append("model")
        if "rated_power_kw" in machine_cols:
            insert_cols.append("rated_power_kw")
        if "production_target" in machine_cols:
            insert_cols.append("production_target")
        if "product_type" in machine_cols:
            insert_cols.append("product_type")

        placeholders = ", ".join(["%s"] * len(insert_cols))
        insert_sql = f"""
            INSERT INTO machines ({", ".join(insert_cols)})
            VALUES ({placeholders})
            ON CONFLICT (id) DO NOTHING
        """

        model_by_id = {
            "CNC-1": "Haas VF-2",
            "CNC-2": "DMG Mori",
            "CNC-3": "Mazak",
            "CNC-4": "Fanuc",
            "CNC-5": "Okuma",
        }
        product_by_id = {
            "CNC-1": "Shaft",
            "CNC-2": "Gear",
            "CNC-3": "Housing",
            "CNC-4": "Bracket",
            "CNC-5": "Pin",
        }

        rows = []
        for machine_id, profile in PROFILES.items():
            row = {
                "id": machine_id,
                "name": machine_id,
                "status": "running",
                "model": model_by_id.get(machine_id, "CNC"),
                "rated_power_kw": round(profile["kw_base"], 2),
                "production_target": PRODUCTION_TARGETS[machine_id],
                "product_type": product_by_id.get(machine_id, ""),
            }
            rows.append(tuple(row[c] for c in insert_cols))

        cur.executemany(insert_sql, rows)
        inserted = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        conn.commit()
        return inserted
    finally:
        cur.close()


def get_hour_load_multiplier(hour: int, minute: int = 0):
    """Return (low, high) load_factor range based on time-of-day plant activity.

    Simulates a realistic factory load profile:
      06-07  Warm-up / machine start          ~55-68%
      07-10  Morning production peak          ~88-100%
      10-10:30 Tea break (machines slowing)   ~42-58%
      10:30-12  Pre-lunch push                ~88-100%
      12-13  Lunch break (most machines idle) ~28-42%
      13-17  Afternoon peak                   ~85-100%
      17-18  Evening wind-down                ~68-80%
      18-22  Night shift at reduced load      ~58-75%
      22-06  Post-shift / minimal activity    ~20-40%
    """
    frac = hour + minute / 60.0
    if frac < 6:     return (0.20, 0.40)   # pre-shift / night
    if frac < 7:     return (0.55, 0.68)   # warm-up
    if frac < 10:    return (0.88, 1.00)   # morning peak
    if frac < 10.5:  return (0.42, 0.58)   # tea break
    if frac < 12:    return (0.88, 1.00)   # pre-lunch push
    if frac < 13:    return (0.28, 0.42)   # lunch break
    if frac < 17:    return (0.85, 1.00)   # afternoon peak
    if frac < 18:    return (0.68, 0.80)   # evening slowdown
    if frac < 22:    return (0.58, 0.75)   # night shift
    return (0.20, 0.40)                    # post-shift

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

# ── Upsert: increment per-machine shift production row ────────────────
UPSERT_MACHINE_PARTS_SQL = """
    INSERT INTO machine_parts_produced (
        machine_id, shift,
        parts_produced, parts_rejected, production_target,
        energy_kwh_used, energy_per_part,
        efficiency_score, runtime_hours, idle_hours,
        recorded_at
    ) VALUES (%s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s)
    ON CONFLICT (machine_id, (recorded_at::date), shift) DO UPDATE SET
        parts_produced  = machine_parts_produced.parts_produced  + EXCLUDED.parts_produced,
        parts_rejected  = machine_parts_produced.parts_rejected  + EXCLUDED.parts_rejected,
        energy_kwh_used = ROUND((machine_parts_produced.energy_kwh_used + EXCLUDED.energy_kwh_used)::numeric, 4),
        energy_per_part = CASE
                              WHEN (machine_parts_produced.parts_produced + EXCLUDED.parts_produced) > 0
                              THEN ROUND(
                                  (machine_parts_produced.energy_kwh_used + EXCLUDED.energy_kwh_used)::numeric
                                  / (machine_parts_produced.parts_produced  + EXCLUDED.parts_produced)::numeric, 3)
                              ELSE machine_parts_produced.energy_per_part
                          END,
        runtime_hours   = ROUND((machine_parts_produced.runtime_hours + EXCLUDED.runtime_hours)::numeric, 4),
        idle_hours      = ROUND((machine_parts_produced.idle_hours    + EXCLUDED.idle_hours)::numeric,    4),
        efficiency_score = EXCLUDED.efficiency_score,
        recorded_at     = EXCLUDED.recorded_at
"""

# ── Upsert: rebuild shift summary from machine rows ───────────────────
UPSERT_SUMMARY_SQL = """
    INSERT INTO production_summary (
        shift,
        total_parts_produced, total_parts_rejected,
        overall_efficiency_pct, total_energy_kwh, avg_energy_per_part,
        recorded_at
    )
    SELECT
        shift,
        SUM(parts_produced),
        SUM(parts_rejected),
        ROUND(AVG(efficiency_score)::numeric, 2),
        ROUND(SUM(energy_kwh_used)::numeric, 2),
        CASE WHEN SUM(parts_produced) > 0
             THEN ROUND(SUM(energy_kwh_used)::numeric / SUM(parts_produced)::numeric, 3)
             ELSE 0 END,
        DATE_TRUNC('second', MAX(recorded_at))
    FROM machine_parts_produced
    WHERE recorded_at::date = %s AND shift = %s
    GROUP BY shift
    ON CONFLICT ((recorded_at::date), shift) DO UPDATE SET
        total_parts_produced   = EXCLUDED.total_parts_produced,
        total_parts_rejected   = EXCLUDED.total_parts_rejected,
        overall_efficiency_pct = EXCLUDED.overall_efficiency_pct,
        total_energy_kwh       = EXCLUDED.total_energy_kwh,
        avg_energy_per_part    = EXCLUDED.avg_energy_per_part,
        recorded_at            = EXCLUDED.recorded_at
"""

# ── Upsert: rebuild 'Daily' summary from shift rows ───────────────────
UPSERT_DAILY_SUMMARY_SQL = """
    INSERT INTO production_summary (
        shift,
        total_parts_produced, total_parts_rejected,
        overall_efficiency_pct, total_energy_kwh, avg_energy_per_part,
        recorded_at
    )
    SELECT
        'Daily',
        SUM(total_parts_produced),
        SUM(total_parts_rejected),
        ROUND(AVG(overall_efficiency_pct)::numeric, 2),
        ROUND(SUM(total_energy_kwh)::numeric, 2),
        CASE WHEN SUM(total_parts_produced) > 0
             THEN ROUND(SUM(total_energy_kwh)::numeric / SUM(total_parts_produced)::numeric, 3)
             ELSE 0 END,
        DATE_TRUNC('second', MAX(recorded_at))
    FROM production_summary
    WHERE recorded_at::date = %s AND shift != 'Daily'
    ON CONFLICT ((recorded_at::date), shift) DO UPDATE SET
        total_parts_produced   = EXCLUDED.total_parts_produced,
        total_parts_rejected   = EXCLUDED.total_parts_rejected,
        overall_efficiency_pct = EXCLUDED.overall_efficiency_pct,
        total_energy_kwh       = EXCLUDED.total_energy_kwh,
        avg_energy_per_part    = EXCLUDED.avg_energy_per_part,
        recorded_at            = EXCLUDED.recorded_at
"""

running = True


def _on_signal(_s, _f):
    global running
    print("\n\nStopping... Goodbye!")
    running = False


signal.signal(signal.SIGINT, _on_signal)


def get_current_shift(dt: datetime):
    """Return (shift_name, record_date) for the given UTC datetime."""
    hour = dt.hour
    d    = dt.date()
    if 6 <= hour < 14:
        return "Shift A (06-14)", d
    if 14 <= hour < 22:
        return "Shift B (14-22)", d
    # Night shift: hours 22-23 belong to today; hours 00-05 belong to the previous day
    return "Shift C (22-06)", d if hour >= 22 else d - timedelta(days=1)


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


def print_separator(char="-", width=70):
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


def backfill_today(conn):
    """Seed today's rows if missing, simulating one tick every INTERVAL_SEC seconds
    from 06:00 local time to now — exactly as if the simulation had been running
    all day. Each row gets its own realistic recorded_at timestamp.

    Also ensures machine_parts_produced has a realistic total for the current shift.
    """
    local_now = datetime.now()
    elapsed_hours = max(0.0, local_now.hour - 6 + local_now.minute / 60)
    if elapsed_hours <= 0:
        return  # Before shift start, nothing to backfill

    now_utc = datetime.now(timezone.utc).replace(microsecond=0)
    today_start_utc = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    shift, shift_date = get_current_shift(local_now)

    # Exact UTC offset as a timedelta (e.g. IST = +5h30m)
    utc_offset_td = local_now - datetime.now(timezone.utc).replace(tzinfo=None)

    TICK_HOURS = INTERVAL_SEC / 3600
    # Shift starts at 06:00 local time
    shift_start_local = local_now.replace(hour=6, minute=0, second=0, microsecond=0)

    cur = conn.cursor()

    for machine_id, p in PROFILES.items():
        row = get_daily_totals(cur, machine_id, today_start_utc)
        existing_parts = int(row[1])

        if existing_parts > 5:
            # Real simulation data already present — skip machine_metrics backfill
            parts = existing_parts
            kwh   = float(row[0])
            rt    = float(row[3])
            eff   = p["eff_base"]
        else:
            # ── Generate one tick every INTERVAL_SEC from 06:00 to now ──────
            cumulative_kwh   = 0.0
            cumulative_parts = 0
            cumulative_rej   = 0
            cumulative_rt    = 0.0
            cumulative_idle  = 0.0
            eff              = p["eff_base"]

            tick_time = shift_start_local
            rows_to_insert = []
            # Per-shift incremental accumulators for machine_parts_produced
            shift_totals = {}  # shift_name -> {parts, rej, kwh, rt, idle, eff, last_ts}

            while tick_time <= local_now:
                hour        = tick_time.hour
                is_working  = 6 <= hour < 22
                lf_low, lf_high = get_hour_load_multiplier(hour, tick_time.minute)
                load_factor = random.uniform(lf_low, lf_high)

                kw     = max(0.5, round(p["kw_base"] * load_factor + random.uniform(-p["kw_var"], p["kw_var"]) * load_factor, 1))
                pf_val = round(p["pf"] + random.uniform(-0.02, 0.02), 2)
                vr     = round(p["volt_base"] + random.uniform(-3, 3), 1)
                vy     = round(p["volt_base"] + random.uniform(-3, 3), 1)
                vb     = round(p["volt_base"] + random.uniform(-3, 3), 1)
                cr     = round(p["curr_base"] * load_factor + random.uniform(-2, 2), 1)
                eff    = max(0, min(100, p["eff_base"] + random.randint(-5, 5)))

                parts_per_tick = p["parts_per_hour"] * load_factor * TICK_HOURS
                new_parts = int(parts_per_tick) + (1 if random.random() < (parts_per_tick % 1) else 0)
                new_rej   = sum(1 for _ in range(new_parts) if random.random() < p["reject_rate"])
                kwh_inc   = round(kw * TICK_HOURS, 4)

                cumulative_kwh    = round(cumulative_kwh + kwh_inc, 2)
                cumulative_parts += new_parts
                cumulative_rej   += new_rej
                cumulative_rt     = round(cumulative_rt + TICK_HOURS, 4)
                cumulative_idle   = round(cumulative_idle + 0.0, 4)
                epp = round(cumulative_kwh / cumulative_parts, 2) if cumulative_parts > 0 else 0.0

                # Determine which shift this tick belongs to
                tick_shift, _ = get_current_shift(tick_time)
                if tick_shift not in shift_totals:
                    shift_totals[tick_shift] = {'parts': 0, 'rej': 0, 'kwh': 0.0,
                                                'rt': 0.0, 'idle': 0.0, 'eff': eff, 'last_ts': None}
                st = shift_totals[tick_shift]
                st['parts'] += new_parts
                st['rej']   += new_rej
                st['kwh']    = round(st['kwh'] + kwh_inc, 4)
                st['rt']     = round(st['rt'] + TICK_HOURS, 4)
                st['eff']    = eff
                # Convert local tick time → exact UTC timestamp
                row_ts = (tick_time - utc_offset_td).replace(tzinfo=timezone.utc)
                st['last_ts'] = row_ts

                rows_to_insert.append((
                    machine_id, row_ts,
                    kw, cumulative_kwh, pf_val,
                    vr, vy, vb,
                    cr, cr, cr,
                    cumulative_parts, epp, cumulative_rej,
                    cumulative_rt, cumulative_idle, eff,
                ))
                tick_time += timedelta(seconds=INTERVAL_SEC)

            # Batch insert all ticks for this machine
            cur.executemany(INSERT_SQL, rows_to_insert)
            cur.execute("UPDATE machines SET status = 'running' WHERE id = %s", (machine_id,))

            parts = cumulative_parts
            kwh   = cumulative_kwh
            rt    = cumulative_rt

            # Upsert machine_parts_produced for EVERY shift that has ticks today
            for s_name, st in shift_totals.items():
                if st['parts'] == 0 and st['kwh'] == 0.0:
                    continue
                cur.execute(UPSERT_MACHINE_PARTS_SQL, (
                    machine_id, s_name,
                    st['parts'], st['rej'], PRODUCTION_TARGETS[machine_id],
                    round(st['kwh'], 4),
                    st['eff'], round(st['rt'], 4), 0.0,
                    st['last_ts'],
                ))
            # Skip the single-shift upsert below for backfill path
            continue

    conn.commit()
    cur.close()
    tick_count = int(elapsed_hours * 3600 / INTERVAL_SEC)
    print(f"  [backfill] Today's production seeded — {elapsed_hours:.1f}h elapsed, ~{tick_count} ticks/machine.")


def generate_and_insert(conn):
    """Generate one reading per machine and insert into machine_metrics."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    cur = conn.cursor()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    TICK_HOURS = INTERVAL_SEC / 3600
    # Use local time for shift detection so plant shift hours match the local clock
    shift, shift_date = get_current_shift(datetime.now())

    for machine_id, p in PROFILES.items():
        # Use local time so the plant's day-shift (06-22 local) is respected
        local_now = datetime.now()
        hour = local_now.hour
        is_working = 6 <= hour < 22
        lf_low, lf_high = get_hour_load_multiplier(hour, local_now.minute)
        load_factor = random.uniform(lf_low, lf_high)
        if local_now.weekday() == 6:
            load_factor *= 0.3

        row = get_daily_totals(cur, machine_id, today_start)
        daily_kwh, daily_parts, daily_rejections, daily_runtime, daily_idle, last_epp = (
            float(row[0]), int(row[1]), int(row[2]), float(row[3]), float(row[4]), float(row[5])
        )

        if load_factor <= 0.25 and not is_working:
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

        # ── Production tables ────────────────────────────────────────
        cur.execute(UPSERT_MACHINE_PARTS_SQL, (
            machine_id, shift,
            new_parts, new_rej, PRODUCTION_TARGETS[machine_id],
            round(kwh_inc, 4), eff,
            round(runtime_inc, 4), round(idle_inc, 4),
            now.replace(microsecond=0),  # recorded_at — no microseconds
        ))

    # ── Roll up shift + daily summaries ──────────────────────────────
    cur.execute(UPSERT_SUMMARY_SQL, (shift_date, shift))
    cur.execute(UPSERT_DAILY_SUMMARY_SQL, (shift_date,))

    conn.commit()
    cur.close()
    print(f"  [OK] Data generated at {now.strftime('%H:%M:%S')} | Shift: {shift}")

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
        inserted = ensure_machine_master_rows(conn)
        print("=" * 70)
        print("  LIVE MACHINE DETAILS  --  Generate + Fetch every 45 seconds")
        print("  Press Ctrl+C to stop")
        print("=" * 70)
        if inserted:
            print(f"  Seeded {inserted} missing machine master row(s).")

        # Pre-seed today's cumulative totals so KPI cards show realistic values
        backfill_today(conn)

        while running:
            cycle += 1
            print(f"\n{'=' * 70}")
            print(f"  Cycle #{cycle}  --  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print("=" * 70)

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
