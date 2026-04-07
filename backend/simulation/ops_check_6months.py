import argparse
import math
import random
import signal
import time
from datetime import date, datetime, time as dtime, timedelta, timezone

import psycopg2

from fetch_machine_details import (
    PROFILES,
    PRODUCTION_TARGETS,
    ensure_machine_master_rows,
    get_hour_load_multiplier,
)

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db_config import DB_CONFIG

SHIFT_WINDOWS = [
    ("Shift A (06-14)", 6, 14),
    ("Shift B (14-22)", 14, 22),
    ("Shift C (22-06)", 22, 30),
]

STOP_REQUESTED = False
LOCAL_TZ = datetime.now().astimezone().tzinfo

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

UPSERT_MACHINE_PARTS_REPLACE_SQL = """
    INSERT INTO machine_parts_produced (
        machine_id, shift,
        parts_produced, parts_rejected, production_target,
        energy_kwh_used, energy_per_part,
        efficiency_score, runtime_hours, idle_hours,
        recorded_at
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (machine_id, (recorded_at::date), shift)
    DO UPDATE SET
        parts_produced = EXCLUDED.parts_produced,
        parts_rejected = EXCLUDED.parts_rejected,
        production_target = EXCLUDED.production_target,
        energy_kwh_used = EXCLUDED.energy_kwh_used,
        energy_per_part = EXCLUDED.energy_per_part,
        efficiency_score = EXCLUDED.efficiency_score,
        runtime_hours = EXCLUDED.runtime_hours,
        idle_hours = EXCLUDED.idle_hours,
        recorded_at = EXCLUDED.recorded_at
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
    print("\nStop requested. Shutting down safely...")


def daterange(start_day: date, end_day: date):
    days = (end_day - start_day).days + 1
    for i in range(days):
        yield start_day + timedelta(days=i)


def to_utc(local_naive: datetime) -> datetime:
    return local_naive.replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)


def get_shift_for_local(local_dt: datetime):
    hour = local_dt.hour
    d = local_dt.date()
    if 6 <= hour < 14:
        return "Shift A (06-14)", d
    if 14 <= hour < 22:
        return "Shift B (14-22)", d
    return "Shift C (22-06)", d if hour >= 22 else d - timedelta(days=1)


def get_shift_bounds(day: date, shift_name: str):
    if shift_name == "Shift A (06-14)":
        start = datetime.combine(day, dtime(6, 0))
        end = datetime.combine(day, dtime(14, 0))
    elif shift_name == "Shift B (14-22)":
        start = datetime.combine(day, dtime(14, 0))
        end = datetime.combine(day, dtime(22, 0))
    else:
        start = datetime.combine(day, dtime(22, 0))
        end = datetime.combine(day + timedelta(days=1), dtime(6, 0))
    return start, end


def seasonal_multiplier(day: date) -> float:
    doy = day.timetuple().tm_yday
    return 0.92 + 0.16 * (0.5 + 0.5 * math.sin((2 * math.pi * doy) / 365.25))


def weekday_multiplier(day: date) -> float:
    wd = day.weekday()
    if wd == 6:
        return 0.62
    if wd == 5:
        return 0.82
    return 1.0


def machine_tick(profile: dict, local_dt: datetime, tick_hours: float):
    lf_low, lf_high = get_hour_load_multiplier(local_dt.hour, local_dt.minute)
    lf = random.uniform(lf_low, lf_high)
    lf *= seasonal_multiplier(local_dt.date())
    lf *= weekday_multiplier(local_dt.date())
    lf *= random.uniform(0.94, 1.06)
    lf = max(0.08, min(1.25, lf))

    maintenance = random.random() < 0.0015
    running = lf > 0.22 and not maintenance

    if maintenance:
        kw = round(random.uniform(0.2, 1.1), 2)
        pf = round(random.uniform(0.3, 0.6), 2)
        phase_jitter = 8.0
    elif running:
        kw = max(
            0.5,
            round(
                profile["kw_base"] * lf
                + random.uniform(-profile["kw_var"], profile["kw_var"]) * lf,
                2,
            ),
        )
        pf = round(min(0.99, max(0.75, profile["pf"] + random.uniform(-0.04, 0.04))), 2)
        phase_jitter = 4.5
    else:
        kw = round(random.uniform(0.3, 1.7), 2)
        pf = round(random.uniform(0.4, 0.65), 2)
        phase_jitter = 6.0

    v_base = profile["volt_base"] + random.uniform(-2.0, 2.0)
    vr = round(v_base + random.uniform(-phase_jitter, phase_jitter), 1)
    vy = round(v_base + random.uniform(-phase_jitter, phase_jitter), 1)
    vb = round(v_base + random.uniform(-phase_jitter, phase_jitter), 1)

    c_base = profile["curr_base"] * lf if running else random.uniform(0.2, 1.0)
    cr = round(max(0.0, c_base + random.uniform(-3.0, 3.0)), 1)
    cy = round(max(0.0, c_base + random.uniform(-3.0, 3.0)), 1)
    cb = round(max(0.0, c_base + random.uniform(-3.0, 3.0)), 1)

    parts_rate = profile["parts_per_hour"] * (lf if running else 0.0)
    expected_parts = max(0.0, parts_rate * tick_hours)
    new_parts = int(expected_parts) + (1 if random.random() < (expected_parts % 1) else 0)
    new_rej = sum(1 for _ in range(new_parts) if random.random() < profile["reject_rate"])

    runtime_inc = round(tick_hours if running else tick_hours * 0.1, 4)
    idle_inc = round(max(0.0, tick_hours - runtime_inc), 4)
    kwh_inc = round(kw * tick_hours, 4)

    eff = max(0, min(100, profile["eff_base"] + random.randint(-6, 6) - (3 if maintenance else 0)))
    status = "maintenance" if maintenance else ("running" if running else "idle")

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


def upsert_shift_and_daily_summary(cur, day: date, shift_name: str):
    cur.execute(UPSERT_SHIFT_SUMMARY_SQL, (day, shift_name))
    cur.execute(UPSERT_DAILY_SUMMARY_SQL, (day,))


def backfill_six_months(conn, days: int, step_sec: int):
    tick_hours = step_sec / 3600.0
    end_day = datetime.now().date()
    start_day = end_day - timedelta(days=max(0, days - 1))
    backfill_end_local = datetime.now()

    print(f"Backfilling from {start_day} to {end_day} ({days} days), step={step_sec}s")

    cur = conn.cursor()
    processed = 0

    try:
        for day in daterange(start_day, end_day):
            if STOP_REQUESTED:
                conn.rollback()
                print("Backfill interrupted; rolled back current uncommitted day.")
                return

            daily = {
                mid: {"kwh": 0.0, "parts": 0, "rej": 0, "rt": 0.0, "idle": 0.0, "eff": p["eff_base"]}
                for mid, p in PROFILES.items()
            }

            for shift_name, _, _ in SHIFT_WINDOWS:
                if STOP_REQUESTED:
                    break

                shift_start, shift_end = get_shift_bounds(day, shift_name)
                effective_shift_end = min(shift_end, backfill_end_local)
                if effective_shift_end <= shift_start:
                    continue
                tick_time = shift_start
                shift_totals = {
                    mid: {"parts": 0, "rej": 0, "kwh": 0.0, "rt": 0.0, "idle": 0.0, "eff": PROFILES[mid]["eff_base"], "last_ts": None}
                    for mid in PROFILES
                }

                while tick_time < effective_shift_end and not STOP_REQUESTED:
                    ts_utc = to_utc(tick_time)
                    for machine_id, profile in PROFILES.items():
                        reading = machine_tick(profile, tick_time, tick_hours)
                        st = daily[machine_id]
                        st["kwh"] = round(st["kwh"] + reading["kwh_inc"], 4)
                        st["parts"] += reading["new_parts"]
                        st["rej"] += reading["new_rej"]
                        st["rt"] = round(st["rt"] + reading["runtime_inc"], 4)
                        st["idle"] = round(st["idle"] + reading["idle_inc"], 4)
                        st["eff"] = reading["eff"]

                        epp = round(st["kwh"] / st["parts"], 3) if st["parts"] > 0 else 0.0

                        cur.execute(
                            INSERT_METRIC_SQL,
                            (
                                machine_id,
                                ts_utc,
                                reading["kw"],
                                st["kwh"],
                                reading["pf"],
                                reading["vr"],
                                reading["vy"],
                                reading["vb"],
                                reading["cr"],
                                reading["cy"],
                                reading["cb"],
                                st["parts"],
                                epp,
                                st["rej"],
                                st["rt"],
                                st["idle"],
                                st["eff"],
                            ),
                        )

                        sst = shift_totals[machine_id]
                        sst["parts"] += reading["new_parts"]
                        sst["rej"] += reading["new_rej"]
                        sst["kwh"] = round(sst["kwh"] + reading["kwh_inc"], 4)
                        sst["rt"] = round(sst["rt"] + reading["runtime_inc"], 4)
                        sst["idle"] = round(sst["idle"] + reading["idle_inc"], 4)
                        sst["eff"] = reading["eff"]
                        sst["last_ts"] = ts_utc

                    tick_time += timedelta(seconds=step_sec)

                for machine_id, sst in shift_totals.items():
                    if sst["parts"] == 0 and sst["kwh"] == 0.0:
                        continue
                    energy_per_part = round(sst["kwh"] / sst["parts"], 3) if sst["parts"] > 0 else 0.0
                    cur.execute(
                        UPSERT_MACHINE_PARTS_REPLACE_SQL,
                        (
                            machine_id,
                            shift_name,
                            sst["parts"],
                            sst["rej"],
                            PRODUCTION_TARGETS[machine_id],
                            round(sst["kwh"], 4),
                            energy_per_part,
                            sst["eff"],
                            round(sst["rt"], 4),
                            round(sst["idle"], 4),
                            sst["last_ts"],
                        ),
                    )

                if any(v["last_ts"] is not None for v in shift_totals.values()):
                    upsert_shift_and_daily_summary(cur, day, shift_name)

            conn.commit()
            processed += 1
            if processed % 7 == 0 or day == end_day:
                print(f"Backfill progress: {processed}/{days} day(s), latest={day}")

    finally:
        cur.close()


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


def run_live(conn, interval_sec: int):
    tick_hours = interval_sec / 3600.0
    print(f"Live mode started (interval={interval_sec}s). Press Ctrl+C to stop.")

    while not STOP_REQUESTED:
        tick_start = time.time()
        local_now = datetime.now()
        now_utc = datetime.now(timezone.utc).replace(microsecond=0)
        shift_name, shift_day = get_shift_for_local(local_now)
        day_start_utc = to_utc(datetime.combine(local_now.date(), dtime(0, 0)))

        cur = conn.cursor()
        statuses = {}

        try:
            for machine_id, profile in PROFILES.items():
                totals = fetch_daily_totals(cur, machine_id, day_start_utc)
                reading = machine_tick(profile, local_now, tick_hours)

                total_kwh = round(totals["kwh"] + reading["kwh_inc"], 4)
                total_parts = totals["parts"] + reading["new_parts"]
                total_rej = totals["rej"] + reading["new_rej"]
                total_rt = round(totals["rt"] + reading["runtime_inc"], 4)
                total_idle = round(totals["idle"] + reading["idle_inc"], 4)

                if total_parts > 0 and reading["new_parts"] > 0:
                    epp = round(total_kwh / total_parts, 3)
                else:
                    epp = totals["last_epp"]

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

            upsert_shift_and_daily_summary(cur, shift_day, shift_name)
            conn.commit()

            stamp = now_utc.strftime("%Y-%m-%d %H:%M:%S")
            status_line = "  ".join([f"{mid}={st}" for mid, st in sorted(statuses.items())])
            print(f"[{stamp}] {status_line}")

        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

        elapsed = time.time() - tick_start
        sleep_for = max(0.0, interval_sec - elapsed)
        slept = 0.0
        while slept < sleep_for and not STOP_REQUESTED:
            chunk = min(0.2, sleep_for - slept)
            time.sleep(chunk)
            slept += chunk


def parse_args():
    parser = argparse.ArgumentParser(
        description="Backfill 6 months of realistic production data and continue live simulation."
    )
    parser.add_argument("--days", type=int, default=182, help="Number of historical days to backfill.")
    parser.add_argument(
        "--backfill-step-sec",
        type=int,
        default=600,
        help="Historical simulation step in seconds (default 600 = 10 minutes).",
    )
    parser.add_argument(
        "--live-interval-sec",
        type=int,
        default=20,
        help="Live tick interval in seconds.",
    )
    parser.add_argument(
        "--skip-backfill",
        action="store_true",
        help="Skip historical backfill and start directly in live mode.",
    )
    parser.add_argument(
        "--no-live",
        action="store_true",
        help="Run only historical backfill and exit.",
    )
    return parser.parse_args()


def main():
    signal.signal(signal.SIGINT, on_sigint)
    args = parse_args()

    conn = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        inserted = ensure_machine_master_rows(conn)
        if inserted:
            print(f"Added {inserted} missing machine master row(s).")

        if not args.skip_backfill:
            backfill_six_months(conn, args.days, args.backfill_step_sec)

        if STOP_REQUESTED:
            return

        if args.no_live:
            print("Backfill completed. Live mode disabled (--no-live).")
            return

        run_live(conn, args.live_interval_sec)

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn is not None:
            conn.close()
            print("Connection closed.")


if __name__ == "__main__":
    main()
