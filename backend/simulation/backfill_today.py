import psycopg2
import sys
import os
import random
import math
from datetime import datetime, timedelta

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))) 
from db_config import DB_CONFIG

MACHINES = {
    'CNC-1': {'power': 18.5, 'target': 265},
    'CNC-2': {'power': 22.0, 'target': 228},
    'CNC-3': {'power': 14.0, 'target': 163},
    'CNC-4': {'power': 15.8, 'target': 301},
    'CNC-5': {'power': 13.0, 'target': 202}
}

INTERVAL_SEC = 900

def get_shift_info(dt):
    h = dt.hour
    if 6 <= h < 14:
        return 'Shift A (06-14)', dt.date()
    elif 14 <= h < 22:
        return 'Shift B (14-22)', dt.date()
    else:
        shift_date = dt.date() if h >= 22 else (dt - timedelta(days=1)).date()  
        return 'Shift C (22-06)', shift_date

def get_load_factor(dt):
    h = dt.hour
    base = 0.85 if 6 <= h < 14 else (0.75 if 14 <= h < 22 else 0.4)
    # seasonal variance
    day_of_year = dt.timetuple().tm_yday
    season = math.sin((day_of_year / 365.0) * math.pi) * 0.1
    return base + season

def clear_today(cur, start_dt, end_dt):
    print("Clearing today's existing records in range...")
    query = "DELETE FROM machine_metrics WHERE recorded_at >= %s AND recorded_at <= %s"
    cur.execute(query, (start_dt, end_dt))
    query2 = "DELETE FROM machine_parts_produced WHERE recorded_at >= %s AND recorded_at <= %s"
    cur.execute(query2, (start_dt, end_dt))

def run():
    now = datetime.now()
    start_dt = datetime.combine(now.date(), datetime.min.time()).replace(tzinfo=None)
    end_dt = now.replace(tzinfo=None)

    print(f"Backfilling today data from {start_dt} to {end_dt}...")
    print(f"Interval: {INTERVAL_SEC} seconds per tick.")

    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    cur = conn.cursor()

    clear_today(cur, start_dt, end_dt)

    current_time = start_dt
    tick_hours = INTERVAL_SEC / 3600.0

    metrics_buffer = []
    parts_buffer = {}

    total_ticks = int((end_dt - start_dt).total_seconds() / INTERVAL_SEC)       
    ticks_done = 0

    while current_time <= end_dt:
        shift_name, shift_date = get_shift_info(current_time)
        load = get_load_factor(current_time)

        for m_id, m_info in MACHINES.items():
            base_kw = m_info['power']

            is_running = random.random() < 0.90
            status = 'running' if is_running else 'idle'
            kw = (base_kw * load * random.uniform(0.9, 1.1)) if is_running else (base_kw * 0.05)
            pf = random.uniform(0.92, 0.98) if is_running else random.uniform(0.6, 0.8)
            energy_kwh = kw * tick_hours

            parts_key = (m_id, shift_date, shift_name)
            if parts_key not in parts_buffer:
                parts_buffer[parts_key] = {'p': 0, 'r': 0, 'rh': 0, 'ih': 0, 'e': 0}

            b = parts_buffer[parts_key]
            b['e'] += energy_kwh
            if is_running:
                b['rh'] += tick_hours
                parts_to_add = int((m_info['target']/3 / (8/tick_hours)) * random.uniform(0.8, 1.2))
                b['p'] += parts_to_add
                if random.random() < 0.1: b['r'] += int(parts_to_add * 0.05)    
            else:
                b['ih'] += tick_hours

            metrics_buffer.append((
                m_id, current_time.strftime('%Y-%m-%d %H:%M:%S'),
                kw, b['e'], pf,
                random.uniform(220, 240) if is_running else 0, # vr
                random.uniform(220, 240) if is_running else 0, # vy
                random.uniform(220, 240) if is_running else 0, # vb
                random.uniform(10, 30) if is_running else 0, # cr
                random.uniform(10, 30) if is_running else 0, # cy
                random.uniform(10, 30) if is_running else 0, # cb
                b['p'],
                b['e']/b['p'] if b['p'] > 0 else 0, # epp
                b['r'],
                b['rh'],
                b['ih'],
                random.randint(60, 98) # eff
            ))

        current_time += timedelta(seconds=INTERVAL_SEC)
        ticks_done += 1

    if metrics_buffer:
        cur.executemany('''
            INSERT INTO machine_metrics (
                machine_id, recorded_at, kw, kwh, power_factor,
                voltage_r, voltage_y, voltage_b,
                current_r, current_y, current_b,
                parts_produced, energy_per_part, rejection_count,
                runtime_hours, idle_hours, efficiency_score
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', metrics_buffer)

    parts_insert = []
    for (m_id, s_date, shift_name), pd in parts_buffer.items():
        parts_insert.append((
            s_date, shift_name, m_id,
            pd['p'], pd['r'], pd['e'],
            pd['rh'], pd['ih'],
            MACHINES[m_id]['target'],
            random.randint(60, 98)
        ))

    if parts_insert:
        cur.executemany('''
            INSERT INTO machine_parts_produced
            (recorded_at, shift, machine_id, parts_produced, parts_rejected, energy_kwh_used, runtime_hours, idle_hours, production_target, efficiency_score)       
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (machine_id, (recorded_at::date), shift) DO UPDATE SET
                parts_produced = EXCLUDED.parts_produced,
                parts_rejected = EXCLUDED.parts_rejected,
                energy_kwh_used = EXCLUDED.energy_kwh_used,
                runtime_hours = EXCLUDED.runtime_hours,
                idle_hours = EXCLUDED.idle_hours,
                efficiency_score = EXCLUDED.efficiency_score
        ''', parts_insert)

    conn.commit()
    cur.close()
    
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../db')))
    try:
        import build_reports_dataset
        build_reports_dataset.main()
    except Exception as e:
        print("Dataset rebuild notice:", e)

    print("Done generated today data successfully!")

if __name__ == '__main__':
    run()
