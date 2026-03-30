import argparse
import math
import random
import signal
import time
from datetime import datetime, timedelta, timezone

import psycopg2

from fetch_machine_details import (
    PROFILES,
    PRODUCTION_TARGETS,
    ensure_machine_master_rows,
    get_hour_load_multiplier,
)

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "energy_db",
    "user": "postgres",
    "password": "12345",
}

DEFAULT_INTERVAL_SEC = 40
STOP_REQUESTED = False

INSERT_METRIC_SQL = """
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

UPSERT_MACHINE_PARTS_INCREMENT_SQL = """
    INSERT INTO machine_parts_produced (
        machine_id, shift,
        parts_produced, parts_rejected, production_target,
        energy_kwh_used, energy_per_part,
        efficiency_score, runtime_hours, idle_hours,
        recorded_at
    ) VALUES (%s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s)
    ON CONFLICT (machine_id, (recorded_at::date), shift) DO UPDATE SET
        parts_produced = machine_parts_produced.parts_produced + EXCLUDED.parts_produced,
        parts_rejected = machine_parts_produced.parts_rejected + EXCLUDED.parts_rejected,
        energy_kwh_used = ROUND((machine_parts_produced.energy_kwh_used + EXCLUDED.energy_kwh_used)::numeric, 4),
        energy_per_part = CASE
                              WHEN (machine_parts_produced.parts_produced + EXCLUDED.parts_produced) > 0
                              THEN ROUND(
                                  (machine_parts_produced.energy_kwh_used + EXCLUDED.energy_kwh_used)::numeric /
                                  (machine_parts_produced.parts_produced + EXCLUDED.parts_produced)::numeric, 3
                              )
                              ELSE machine_parts_produced.energy_per_part
                          END,
        runtime_hours = ROUND((machine_parts_produced.runtime_hours + EXCLUDED.runtime_hours)::numeric, 4),
        idle_hours = ROUND((machine_parts_produced.idle_hours + EXCLUDED.idle_hours)::numeric, 4),
        efficiency_score = EXCLUDED.efficiency_score,
        recorded_at = EXCLUDED.recorded_at
"""

UPSERT_SHIFT_SUMMARY_SQL = """
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
        total_parts_produced = EXCLUDED.total_parts_produced,
        total_parts_rejected = EXCLUDED.total_parts_rejected,
        overall_efficiency_pct = EXCLUDED.overall_efficiency_pct,
        total_energy_kwh = EXCLUDED.total_energy_kwh,
        avg_energy_per_part = EXCLUDED.avg_energy_per_part,
        recorded_at = EXCLUDED.recorded_at
"""

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
        total_parts_produced = EXCLUDED.total_parts_produced,
        total_parts_rejected = EXCLUDED.total_parts_rejected,
        overall_efficiency_pct = EXCLUDED.overall_efficiency_pct,
        total_energy_kwh = EXCLUDED.total_energy_kwh,
        avg_energy_per_part = EXCLUDED.avg_energy_per_part,
        recorded_at = EXCLUDED.recorded_at
"""

GET_DAILY_TOTALS_SQL = """
    SELECT
        COALESCE(MAX(kwh), 0),
        COALESCE(MAX(parts_produced), 0),
        COALESCE(MAX(rejection_count), 0),
        COALESCE(MAX(runtime_hours), 0),
        COALESCE(MAX(idle_hours), 0),
        COALESCE((
            SELECT energy_per_part
            FROM machine_metrics
            WHERE machine_id = %s AND recorded_at >= %s
            ORDER BY recorded_at DESC
            LIMIT 1
        ), 0)
    FROM machine_metrics
    WHERE machine_id = %s AND recorded_at >= %s
"""


def on_sigint(_sig, _frame):
    global STOP_REQUESTED
    STOP_REQUESTED = True
    print("\nStop requested. Closing simulator gracefully...")


def get_shift_for_local(local_dt: datetime):
    hour = local_dt.hour
    day = local_dt.date()
    if 6 <= hour < 14:
        return "Shift A (06-14)", day
    if 14 <= hour < 22:
        return "Shift B (14-22)", day
    return "Shift C (22-06)", day if hour >= 22 else day - timedelta(days=1)


def seasonal_multiplier(local_dt: datetime) -> float:
    doy = local_dt.timetuple().tm_yday
    # Smooth annual variation around +/- 10%
    return 0.9 + 0.2 * (0.5 + 0.5 * math.sin((2 * math.pi * doy) / 365.25))


def shift_intensity(local_dt: datetime) -> float:
    # Extra realism per shift beyond get_hour_load_multiplier.
    hour = local_dt.hour + local_dt.minute / 60.0
    if 6 <= hour < 10:
        return 1.06
    if 10 <= hour < 12:
        return 0.9
    if 12 <= hour < 13:
        return 0.74
    if 13 <= hour < 17:
        return 1.03
    if 17 <= hour < 22:
        return 0.88
    return 0.58


def generate_machine_tick(profile: dict, local_dt: datetime, tick_hours: float):
    lf_low, lf_high = get_hour_load_multiplier(local_dt.hour, local_dt.minute)
    load_factor = random.uniform(lf_low, lf_high)
    load_factor *= seasonal_multiplier(local_dt)
    load_factor *= shift_intensity(local_dt)
    if local_dt.weekday() == 6:  # Sunday
        load_factor *= 0.65

    # Oscillation simulates realistic tool engagement and batch behavior.
    fast_cycle = math.sin(2 * math.pi * time.time() / 80.0) * 0.09
    medium_cycle = math.sin(2 * math.pi * time.time() / 450.0) * 0.07
    surge = random.uniform(0.08, 0.25) if random.random() < 0.03 else 0.0
    dip = -random.uniform(0.10, 0.28) if random.random() < 0.03 else 0.0

    effective_load = max(0.08, min(1.28, load_factor + fast_cycle + medium_cycle + surge + dip))

    maintenance = random.random() < 0.0018
    if maintenance:
        status = "maintenance"
        kw = round(random.uniform(0.2, 1.0), 2)
        pf = round(random.uniform(0.3, 0.6), 2)
        runtime_inc = round(tick_hours * 0.08, 4)
        idle_inc = round(max(0.0, tick_hours - runtime_inc), 4)
    elif effective_load < 0.22:
        status = "idle"
        kw = round(random.uniform(0.3, 1.8), 2)
        pf = round(random.uniform(0.4, 0.66), 2)
        runtime_inc = round(tick_hours * 0.18, 4)
        idle_inc = round(max(0.0, tick_hours - runtime_inc), 4)
    else:
        status = "running"
        kw = max(
            0.5,
            round(
                profile["kw_base"] * effective_load
                + random.uniform(-profile["kw_var"], profile["kw_var"]) * effective_load,
                2,
            ),
        )
        pf = round(min(0.99, max(0.75, profile["pf"] + random.uniform(-0.04, 0.04))), 2)
        runtime_inc = round(tick_hours, 4)
        idle_inc = 0.0

    v_base = profile["volt_base"] + random.uniform(-2.5, 2.5)
    jitter = 6.0 if status != "running" else 4.2
    vr = round(v_base + random.uniform(-jitter, jitter), 1)
    vy = round(v_base + random.uniform(-jitter, jitter), 1)
    vb = round(v_base + random.uniform(-jitter, jitter), 1)

    c_base = profile["curr_base"] * effective_load if status == "running" else random.uniform(0.2, 1.2)
    cr = round(max(0.0, c_base + random.uniform(-2.8, 2.8)), 1)
    cy = round(max(0.0, c_base + random.uniform(-2.8, 2.8)), 1)
    cb = round(max(0.0, c_base + random.uniform(-2.8, 2.8)), 1)

    expected_parts = max(0.0, profile["parts_per_hour"] * (effective_load if status == "running" else 0.0) * tick_hours)
    new_parts = int(expected_parts) + (1 if random.random() < (expected_parts % 1) else 0)
    new_rej = sum(1 for _ in range(new_parts) if random.random() < profile["reject_rate"])

    kwh_inc = round(kw * tick_hours, 4)
    eff = max(0, min(100, profile["eff_base"] + random.randint(-6, 6) - (4 if status == "maintenance" else 0)))

    return {
        "status": status,
        "kw": kw,
        "pf": pf,
        "vr": vr,
        "vy": vy,
        "vb": vb,
        "cr": cr,
        "cy": cy,
        "cb": cb,
        "new_parts": new_parts,
        "new_rej": new_rej,
        "runtime_inc": runtime_inc,
        "idle_inc": idle_inc,
        "kwh_inc": kwh_inc,
        "eff": eff,
    }


def fetch_daily_totals(cur, machine_id: str, day_start_utc: datetime):
    cur.execute(GET_DAILY_TOTALS_SQL, (machine_id, day_start_utc, machine_id, day_start_utc))
    row = cur.fetchone()
    return {
        "kwh": float(row[0]),
        "parts": int(row[1]),
        "rej": int(row[2]),
        "rt": float(row[3]),
        "idle": float(row[4]),
        "last_epp": float(row[5]),
    }


def upsert_shift_and_daily_summary(cur, shift_day):
    local_now = datetime.now()
    shift_name, _ = get_shift_for_local(local_now)
    cur.execute(UPSERT_SHIFT_SUMMARY_SQL, (shift_day, shift_name))
    cur.execute(UPSERT_DAILY_SUMMARY_SQL, (shift_day,))


def clean_future_rows_once(conn):
    with conn.cursor() as cur:
        for table in ("machine_metrics", "machine_parts_produced", "production_summary"):
            cur.execute(f"DELETE FROM {table} WHERE recorded_at > NOW()")
        conn.commit()


def run_simulation(conn, interval_sec: int, max_ticks: int = 0):
    tick_hours = interval_sec / 3600.0
    ticks = 0

    print("=" * 72)
    print(f"Real-time CNC mock simulator started (interval: {interval_sec}s)")
    print("Press Ctrl+C to stop")
    print("=" * 72)

    while not STOP_REQUESTED:
        tick_started = time.time()
        local_now = datetime.now().astimezone()
        now_utc = datetime.now(timezone.utc).replace(microsecond=0)
        shift_name, shift_day = get_shift_for_local(local_now)
        day_start_utc = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

        cur = conn.cursor()
        statuses = {}

        try:
            for machine_id, profile in PROFILES.items():
                totals = fetch_daily_totals(cur, machine_id, day_start_utc)
                reading = generate_machine_tick(profile, local_now, tick_hours)

                total_kwh = round(totals["kwh"] + reading["kwh_inc"], 4)
                total_parts = totals["parts"] + reading["new_parts"]
                total_rej = totals["rej"] + reading["new_rej"]
                total_rt = round(totals["rt"] + reading["runtime_inc"], 4)
                total_idle = round(totals["idle"] + reading["idle_inc"], 4)
                epp = round(total_kwh / total_parts, 3) if total_parts > 0 else totals["last_epp"]

                cur.execute(
                    INSERT_METRIC_SQL,
                    (
                        machine_id,
                        now_utc,
                        reading["kw"],
                        total_kwh,
                        reading["pf"],
                        reading["vr"],
                        reading["vy"],
                        reading["vb"],
                        reading["cr"],
                        reading["cy"],
                        reading["cb"],
                        total_parts,
                        epp,
                        total_rej,
                        total_rt,
                        total_idle,
                        reading["eff"],
                    ),
                )

                cur.execute(
                    UPSERT_MACHINE_PARTS_INCREMENT_SQL,
                    (
                        machine_id,
                        shift_name,
                        reading["new_parts"],
                        reading["new_rej"],
                        PRODUCTION_TARGETS[machine_id],
                        round(reading["kwh_inc"], 4),
                        reading["eff"],
                        round(reading["runtime_inc"], 4),
                        round(reading["idle_inc"], 4),
                        now_utc,
                    ),
                )

                cur.execute("UPDATE machines SET status = %s WHERE id = %s", (reading["status"], machine_id))
                statuses[machine_id] = reading["status"]

            upsert_shift_and_daily_summary(cur, shift_day)
            conn.commit()

        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

        ticks += 1
        stamp = now_utc.strftime("%Y-%m-%d %H:%M:%S")
        status_line = "  ".join([f"{mid}={st}" for mid, st in sorted(statuses.items())])
        print(f"[{stamp}] {shift_name} | {status_line}")

        if max_ticks > 0 and ticks >= max_ticks:
            print(f"Reached max ticks ({max_ticks}). Exiting.")
            break

        elapsed = time.time() - tick_started
        sleep_for = max(0.0, interval_sec - elapsed)
        slept = 0.0
        while slept < sleep_for and not STOP_REQUESTED:
            chunk = min(0.2, sleep_for - slept)
            time.sleep(chunk)
            slept += chunk


def parse_args():
    parser = argparse.ArgumentParser(description="Real-time mock data simulator for CNC dashboard.")
    parser.add_argument("--interval-sec", type=int, default=DEFAULT_INTERVAL_SEC, help="Tick interval in seconds.")
    parser.add_argument(
        "--max-ticks",
        type=int,
        default=0,
        help="Optional limit for test runs; 0 means run forever.",
    )
    parser.add_argument(
        "--no-clean-future",
        action="store_true",
        help="Skip startup cleanup of rows with recorded_at > NOW().",
    )
    return parser.parse_args()


def main():
    signal.signal(signal.SIGINT, on_sigint)
    args = parse_args()

    if args.interval_sec <= 0:
        raise ValueError("--interval-sec must be > 0")

    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        inserted = ensure_machine_master_rows(conn)
        if inserted:
            print(f"Added {inserted} missing machine master row(s).")

        if not args.no_clean_future:
            clean_future_rows_once(conn)
            print("Startup cleanup complete: removed future-dated rows.")

        run_simulation(conn, args.interval_sec, args.max_ticks)

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn is not None:
            conn.close()
            print("Connection closed.")


if __name__ == "__main__":
    main()
