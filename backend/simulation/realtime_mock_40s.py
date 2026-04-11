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

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from db_config import DB_CONFIG

DEFAULT_INTERVAL_SEC = 40
STOP_REQUESTED = False
DEFAULT_TEST_MODE = "normal"

# Machine-wise signal tuning so each CNC has distinct heat/vibration behavior.
MACHINE_SIGNAL_TUNING = {
    "CNC-1": {"heat_bias": -2.0, "vib_bias": -0.08, "heat_kw_gain": 1.75, "vib_imbalance_gain": 0.070},
    "CNC-2": {"heat_bias": 2.2, "vib_bias": 0.20, "heat_kw_gain": 2.05, "vib_imbalance_gain": 0.095},
    "CNC-3": {"heat_bias": 1.0, "vib_bias": 0.10, "heat_kw_gain": 1.95, "vib_imbalance_gain": 0.085},
    "CNC-4": {"heat_bias": -0.6, "vib_bias": -0.02, "heat_kw_gain": 1.85, "vib_imbalance_gain": 0.080},
    "CNC-5": {"heat_bias": 1.4, "vib_bias": 0.25, "heat_kw_gain": 1.98, "vib_imbalance_gain": 0.100},
}

# Industry-inspired CNC behavior profiles (used to simulate realistic live variation).
MACHINE_REALISM_PROFILES = {
    "CNC-1": {"model": "Haas VF-2", "cycle_sec": 205, "cycle_cv": 0.10, "pm_interval_h": 220, "microstop_h": 0.35, "warmup_min": 24, "wear_h": 0.0009},
    "CNC-2": {"model": "DMG Mori", "cycle_sec": 230, "cycle_cv": 0.11, "pm_interval_h": 180, "microstop_h": 0.55, "warmup_min": 28, "wear_h": 0.0013},
    "CNC-3": {"model": "Mazak", "cycle_sec": 285, "cycle_cv": 0.12, "pm_interval_h": 165, "microstop_h": 0.70, "warmup_min": 30, "wear_h": 0.0016},
    "CNC-4": {"model": "Fanuc", "cycle_sec": 185, "cycle_cv": 0.09, "pm_interval_h": 240, "microstop_h": 0.30, "warmup_min": 22, "wear_h": 0.0008},
    "CNC-5": {"model": "Okuma", "cycle_sec": 255, "cycle_cv": 0.11, "pm_interval_h": 190, "microstop_h": 0.60, "warmup_min": 26, "wear_h": 0.0012},
}

BASE_METRIC_COLUMNS = [
    "machine_id", "recorded_at",
    "kw", "kwh", "power_factor",
    "voltage_r", "voltage_y", "voltage_b",
    "current_r", "current_y", "current_b",
    "parts_produced", "energy_per_part", "rejection_count",
    "runtime_hours", "idle_hours", "efficiency_score",
]

# Optional columns are inserted only if they exist in machine_metrics table.
OPTIONAL_SIGNAL_COLUMNS = [
    "machine_heat_c",
    "machine_vibration_mm_s",
]

INSERT_METRIC_SQL = ""
INSERT_SIGNAL_COLUMNS = []

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


def init_machine_runtime_state():
    state = {}
    for machine_id in PROFILES:
        # Different seed values per machine avoid synchronized behavior.
        seed_wear = random.uniform(0.05, 0.28)
        state[machine_id] = {
            "wear": seed_wear,
            "spindle_hours": random.uniform(12.0, 48.0),
            "hours_since_pm": random.uniform(15.0, 90.0),
            "thermal_c": random.uniform(34.0, 42.0),
            "phase": random.uniform(0.0, 2 * math.pi),
        }
    return state


def init_metric_insert_sql(conn):
    global INSERT_METRIC_SQL, INSERT_SIGNAL_COLUMNS

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'machine_metrics'
            """
        )
        metric_cols = {r[0] for r in cur.fetchall()}

    INSERT_SIGNAL_COLUMNS = [c for c in OPTIONAL_SIGNAL_COLUMNS if c in metric_cols]
    all_cols = BASE_METRIC_COLUMNS + INSERT_SIGNAL_COLUMNS
    placeholders = ", ".join(["%s"] * len(all_cols))
    INSERT_METRIC_SQL = f"""
        INSERT INTO machine_metrics (
            {", ".join(all_cols)}
        ) VALUES (
            {placeholders}
        )
    """

    if INSERT_SIGNAL_COLUMNS:
        print(f"Signal columns enabled: {', '.join(INSERT_SIGNAL_COLUMNS)}")
    else:
        print("Signal columns not found in machine_metrics; generating values in simulator output only.")


def generate_machine_tick(machine_id: str, profile: dict, local_dt: datetime, tick_hours: float, runtime_state: dict):
    realism = MACHINE_REALISM_PROFILES.get(machine_id, {
        "cycle_sec": 240,
        "cycle_cv": 0.1,
        "pm_interval_h": 200,
        "microstop_h": 0.5,
        "warmup_min": 25,
        "wear_h": 0.001,
    })

    lf_low, lf_high = get_hour_load_multiplier(local_dt.hour, local_dt.minute)
    load_factor = random.uniform(lf_low, lf_high)
    load_factor *= seasonal_multiplier(local_dt)
    load_factor *= shift_intensity(local_dt)
    if local_dt.weekday() == 6:  # Sunday
        load_factor *= 0.65

    # Oscillation simulates realistic tool engagement and batch behavior.
    runtime_state["phase"] = (runtime_state["phase"] + tick_hours * 2.7) % (2 * math.pi)
    phase = runtime_state["phase"]
    fast_cycle = math.sin(phase * 3.4) * 0.09
    medium_cycle = math.sin(phase * 0.9) * 0.07
    surge = random.uniform(0.08, 0.25) if random.random() < 0.03 else 0.0
    dip = -random.uniform(0.10, 0.28) if random.random() < 0.03 else 0.0

    # Warm-up after shift start lowers load initially and rises gradually.
    minutes_into_shift = (local_dt.hour % 8) * 60 + local_dt.minute
    warmup_progress = min(1.0, minutes_into_shift / max(1, realism["warmup_min"]))
    effective_load = max(0.08, min(1.28, (load_factor + fast_cycle + medium_cycle + surge + dip) * (0.75 + 0.25 * warmup_progress)))

    # Tool wear grows with spindle usage and impacts quality/energy/vibration.
    wear = runtime_state["wear"]
    hours_since_pm = runtime_state["hours_since_pm"]
    pm_due_ratio = hours_since_pm / max(1.0, realism["pm_interval_h"])
    microstop_prob = min(0.45, realism["microstop_h"] * tick_hours * (1.0 + wear))
    microstop = random.random() < microstop_prob
    scheduled_maintenance = pm_due_ratio >= 1.0 and random.random() < min(0.5, 0.10 + (pm_due_ratio - 1.0) * 0.35)

    maintenance = scheduled_maintenance or (random.random() < 0.0008)
    if maintenance:
        status = "maintenance"
        kw = round(random.uniform(0.2, 1.0), 2)
        pf = round(random.uniform(0.3, 0.6), 2)
        runtime_inc = round(tick_hours * 0.08, 4)
        idle_inc = round(max(0.0, tick_hours - runtime_inc), 4)
        runtime_state["hours_since_pm"] = max(0.0, runtime_state["hours_since_pm"] - random.uniform(30.0, 80.0))
        runtime_state["wear"] = max(0.04, runtime_state["wear"] - random.uniform(0.08, 0.20))
    elif microstop:
        status = "idle"
        kw = round(random.uniform(0.5, 2.2), 2)
        pf = round(random.uniform(0.45, 0.72), 2)
        runtime_inc = round(tick_hours * random.uniform(0.25, 0.55), 4)
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

    # Increment wear/runtime state.
    runtime_state["spindle_hours"] += runtime_inc
    runtime_state["hours_since_pm"] += runtime_inc
    runtime_state["wear"] = min(0.98, runtime_state["wear"] + (runtime_inc * realism["wear_h"]))
    wear = runtime_state["wear"]

    v_base = profile["volt_base"] + random.uniform(-2.5, 2.5)
    jitter = 6.0 if status != "running" else 4.2
    vr = round(v_base + random.uniform(-jitter, jitter), 1)
    vy = round(v_base + random.uniform(-jitter, jitter), 1)
    vb = round(v_base + random.uniform(-jitter, jitter), 1)

    c_base = profile["curr_base"] * effective_load * (1.0 + 0.15 * wear) if status == "running" else random.uniform(0.2, 1.2)
    cr = round(max(0.0, c_base + random.uniform(-2.8, 2.8)), 1)
    cy = round(max(0.0, c_base + random.uniform(-2.8, 2.8)), 1)
    cb = round(max(0.0, c_base + random.uniform(-2.8, 2.8)), 1)

    avg_current = (cr + cy + cb) / 3.0
    current_imbalance = abs(cr - avg_current) + abs(cy - avg_current) + abs(cb - avg_current)

    # Derived condition signals for predictive maintenance (physically correlated + machine-specific tuning).
    t = MACHINE_SIGNAL_TUNING.get(machine_id, {"heat_bias": 0.0, "vib_bias": 0.0, "heat_kw_gain": 1.9, "vib_imbalance_gain": 0.08})
    ambient_c = 29.0 + 3.5 * math.sin((2 * math.pi * (local_dt.hour + local_dt.minute / 60.0)) / 24.0)
    heat_target = (
        ambient_c
        + t["heat_bias"]
        + kw * t["heat_kw_gain"]
        + avg_current * 0.20
        + current_imbalance * 0.30
        + wear * 18.0
    )
    thermal_alpha = 0.42 if status == "running" else 0.22
    runtime_state["thermal_c"] = runtime_state["thermal_c"] + thermal_alpha * (heat_target - runtime_state["thermal_c"]) + random.uniform(-0.7, 0.7)
    heat_c = round(max(28.0, min(125.0, runtime_state["thermal_c"])), 1)
    vibration_mm_s = round(
        max(
            0.4,
            min(
                16.0,
                0.7
                + t["vib_bias"]
                + current_imbalance * t["vib_imbalance_gain"]
                + (1.0 - pf) * 4.0
                + wear * 1.4
                + random.uniform(0.0, 0.6),
            ),
        ),
        2,
    )

    # Production now follows cycle-time behavior with part-to-part variation.
    if status == "running":
        cycle_time = max(45.0, random.gauss(realism["cycle_sec"], realism["cycle_sec"] * realism["cycle_cv"]))
        capacity_parts = (runtime_inc * 3600.0) / cycle_time
        quality_drag = max(0.45, 1.0 - (wear * 0.28))
        expected_parts = max(0.0, capacity_parts * max(0.3, effective_load) * quality_drag)
    else:
        expected_parts = 0.0
    new_parts = int(expected_parts) + (1 if random.random() < (expected_parts % 1) else 0)

    reject_rate_live = min(0.35, max(0.001, profile["reject_rate"] * (1.0 + wear * 5.0) + max(0.0, (heat_c - 75.0)) * 0.0018))
    new_rej = sum(1 for _ in range(new_parts) if random.random() < reject_rate_live)

    kwh_inc = round(kw * tick_hours, 4)
    quality_pct = (1.0 - (new_rej / max(1, new_parts))) if new_parts > 0 else 0.96
    availability_pct = runtime_inc / max(0.0001, runtime_inc + idle_inc)
    performance_pct = min(1.0, expected_parts / max(1e-6, profile["parts_per_hour"] * tick_hours)) if status == "running" else 0.5
    oee_like = availability_pct * performance_pct * quality_pct
    eff = int(max(30, min(99, round((profile["eff_base"] * 0.55) + (oee_like * 45) - wear * 18 + random.uniform(-2.0, 2.0)))))

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
        "heat_c": heat_c,
        "vibration_mm_s": vibration_mm_s,
    }


def apply_test_mode(machine_id: str, profile: dict, reading: dict, tick_hours: float, test_mode: str):
    if test_mode != "predictive":
        return reading

    tuned = dict(reading)

    # Build deterministic risk spread for Predictive Maintenance page testing.
    if machine_id == "CNC-1":
        # Healthy baseline machine
        tuned["kw"] = round(min(tuned["kw"], profile["kw_base"] * 0.95), 2)
        tuned["pf"] = round(max(0.92, tuned["pf"]), 2)
        tuned["heat_c"] = round(max(40.0, tuned["heat_c"] - random.uniform(4.0, 8.0)), 1)
        tuned["vibration_mm_s"] = round(max(0.6, tuned["vibration_mm_s"] - random.uniform(0.2, 0.5)), 2)
        tuned["eff"] = min(98, tuned["eff"] + random.randint(3, 7))

    elif machine_id == "CNC-2":
        # Critical behavior: overheating + high vibration + overload
        tuned["kw"] = round(max(tuned["kw"], profile["kw_base"] * random.uniform(1.25, 1.4)), 2)
        tuned["pf"] = round(max(0.72, min(0.88, tuned["pf"] - random.uniform(0.07, 0.12))), 2)
        tuned["heat_c"] = round(min(125.0, tuned["heat_c"] + random.uniform(16.0, 24.0)), 1)
        tuned["vibration_mm_s"] = round(min(16.0, tuned["vibration_mm_s"] + random.uniform(2.2, 4.0)), 2)
        tuned["new_parts"] = max(0, int(tuned["new_parts"] * 0.45))
        tuned["new_rej"] += random.randint(2, 5)
        tuned["eff"] = max(35, tuned["eff"] - random.randint(20, 35))

    elif machine_id == "CNC-3":
        # Low health + high power per part
        tuned["kw"] = round(max(tuned["kw"], profile["kw_base"] * random.uniform(1.0, 1.15)), 2)
        tuned["heat_c"] = round(min(120.0, tuned["heat_c"] + random.uniform(8.0, 14.0)), 1)
        tuned["vibration_mm_s"] = round(min(12.0, tuned["vibration_mm_s"] + random.uniform(1.0, 2.0)), 2)
        tuned["new_parts"] = max(0, int(tuned["new_parts"] * 0.35))
        tuned["new_rej"] += random.randint(1, 3)
        tuned["eff"] = max(42, tuned["eff"] - random.randint(15, 28))

    elif machine_id == "CNC-4":
        # Medium risk profile
        tuned["kw"] = round(max(tuned["kw"], profile["kw_base"] * random.uniform(1.05, 1.18)), 2)
        tuned["heat_c"] = round(min(115.0, tuned["heat_c"] + random.uniform(4.0, 9.0)), 1)
        tuned["vibration_mm_s"] = round(min(10.0, tuned["vibration_mm_s"] + random.uniform(0.6, 1.3)), 2)
        tuned["new_rej"] += random.randint(0, 2)
        tuned["eff"] = max(55, tuned["eff"] - random.randint(5, 14))

    elif machine_id == "CNC-5":
        # Vibration-focused high risk case
        tuned["kw"] = round(max(tuned["kw"], profile["kw_base"] * random.uniform(1.1, 1.25)), 2)
        tuned["heat_c"] = round(min(118.0, tuned["heat_c"] + random.uniform(6.0, 12.0)), 1)
        tuned["vibration_mm_s"] = round(min(16.0, tuned["vibration_mm_s"] + random.uniform(2.0, 3.5)), 2)
        tuned["new_parts"] = max(0, int(tuned["new_parts"] * 0.6))
        tuned["new_rej"] += random.randint(1, 4)
        tuned["eff"] = max(45, tuned["eff"] - random.randint(12, 24))

    tuned["kwh_inc"] = round(tuned["kw"] * tick_hours, 4)
    return tuned


def build_metric_values(machine_id, now_utc, reading, totals):
    values = {
        "machine_id": machine_id,
        "recorded_at": now_utc,
        "kw": reading["kw"],
        "kwh": totals["kwh"],
        "power_factor": reading["pf"],
        "voltage_r": reading["vr"],
        "voltage_y": reading["vy"],
        "voltage_b": reading["vb"],
        "current_r": reading["cr"],
        "current_y": reading["cy"],
        "current_b": reading["cb"],
        "parts_produced": totals["parts"],
        "energy_per_part": totals["epp"],
        "rejection_count": totals["rej"],
        "runtime_hours": totals["rt"],
        "idle_hours": totals["idle"],
        "efficiency_score": reading["eff"],
        "machine_heat_c": reading["heat_c"],
        "machine_vibration_mm_s": reading["vibration_mm_s"],
    }

    return tuple(values[c] for c in (BASE_METRIC_COLUMNS + INSERT_SIGNAL_COLUMNS))


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


def run_simulation(conn, interval_sec: int, max_ticks: int = 0, test_mode: str = DEFAULT_TEST_MODE):
    tick_hours = interval_sec / 3600.0
    ticks = 0
    machine_runtime_state = init_machine_runtime_state()

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
        signal_rows = []

        try:
            for machine_id, profile in PROFILES.items():
                totals = fetch_daily_totals(cur, machine_id, day_start_utc)
                reading = generate_machine_tick(machine_id, profile, local_now, tick_hours, machine_runtime_state[machine_id])
                reading = apply_test_mode(machine_id, profile, reading, tick_hours, test_mode)

                total_kwh = round(totals["kwh"] + reading["kwh_inc"], 4)
                total_parts = totals["parts"] + reading["new_parts"]
                total_rej = totals["rej"] + reading["new_rej"]
                total_rt = round(totals["rt"] + reading["runtime_inc"], 4)
                total_idle = round(totals["idle"] + reading["idle_inc"], 4)
                epp = round(total_kwh / total_parts, 3) if total_parts > 0 else totals["last_epp"]

                total_snapshot = {
                    "kwh": total_kwh,
                    "parts": total_parts,
                    "rej": total_rej,
                    "rt": total_rt,
                    "idle": total_idle,
                    "epp": epp,
                }

                cur.execute(
                    INSERT_METRIC_SQL,
                    build_metric_values(machine_id, now_utc, reading, total_snapshot),
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
                signal_rows.append((machine_id, reading["heat_c"], reading["vibration_mm_s"]))

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
        if signal_rows:
            machine_signals = " | ".join([f"{mid}:H={heat}C V={vib}mm/s" for mid, heat, vib in signal_rows])
            print(f"[{stamp}] {shift_name} | {status_line} | {machine_signals}")
        else:
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
    parser.add_argument(
        "--test-mode",
        choices=["normal", "predictive"],
        default=DEFAULT_TEST_MODE,
        help="normal: regular plant behavior, predictive: risk-spread scenario for Predictive Maintenance page testing.",
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

        init_metric_insert_sql(conn)

        if not args.no_clean_future:
            clean_future_rows_once(conn)
            print("Startup cleanup complete: removed future-dated rows.")

        run_simulation(conn, args.interval_sec, args.max_ticks, args.test_mode)

    except psycopg2.Error as e:
        print(f"Database error: {e}")
    finally:
        if conn is not None:
            conn.close()
            print("Connection closed.")


if __name__ == "__main__":
    main()
