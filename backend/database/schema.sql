-- ============================================================
-- Energy Intelligence Platform - PostgreSQL Database Schema
-- Database: energy_db (as configured in .env)
-- ============================================================

-- Connect to the database
-- \c energy_db;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS & AUTHENTICATION
-- ============================================================
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL CHECK (role IN ('admin', 'manager', 'operator')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. SYSTEM CONFIGURATION (single-row plant config)
-- ============================================================
CREATE TABLE system_config (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_name                VARCHAR(255)   NOT NULL DEFAULT 'Precision CNC Works',
    location                  VARCHAR(255)   NOT NULL DEFAULT 'Pune, Maharashtra',
    industry_type             VARCHAR(100)   NOT NULL DEFAULT 'Automotive Components',
    machine_count             INT            NOT NULL DEFAULT 5,
    tariff_per_kwh            NUMERIC(8,2)   NOT NULL DEFAULT 8.5,
    contract_demand_kva       NUMERIC(10,2)  NOT NULL DEFAULT 85,
    grid_emission_factor      NUMERIC(6,3)   NOT NULL DEFAULT 0.82,
    demand_penalty_rate       NUMERIC(10,2)  NOT NULL DEFAULT 350,
    renewable_percent         INT            NOT NULL DEFAULT 22 CHECK (renewable_percent BETWEEN 0 AND 100),
    pf_minimum                NUMERIC(4,2)   NOT NULL DEFAULT 0.9,
    thd_maximum               NUMERIC(6,2)   NOT NULL DEFAULT 5,
    idle_time_threshold_hrs   NUMERIC(5,1)   NOT NULL DEFAULT 1.5,
    heat_threshold_c          NUMERIC(5,1)   NOT NULL DEFAULT 85,
    demand_warning_percent    INT            NOT NULL DEFAULT 90 CHECK (demand_warning_percent BETWEEN 0 AND 100),
    energy_per_part_deviation INT            NOT NULL DEFAULT 15,
    created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. MACHINES (CNC machine master data)
-- ============================================================
CREATE TABLE machines (
    id                VARCHAR(20)  PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    status            VARCHAR(20)  NOT NULL CHECK (status IN ('running', 'idle', 'maintenance')),
    rated_power_kw    NUMERIC(10,2) NOT NULL,
    production_target INT           NOT NULL,
    heat_threshold_c  NUMERIC(5,1)  NOT NULL DEFAULT 85,
    product_type      VARCHAR(100),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. MACHINE METRICS (real-time / near-real-time snapshots)
-- ============================================================
CREATE TABLE machine_metrics (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id                VARCHAR(20)   NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    recorded_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Power & Energy
    current_power_kw          NUMERIC(10,2),
    energy_kwh                NUMERIC(10,2),
    power_factor              NUMERIC(4,2),
    frequency_hz              NUMERIC(6,2),

    -- 3-Phase Voltage (V)
    voltage_r                 INT,
    voltage_y                 INT,
    voltage_b                 INT,
    voltage_imbalance_pct     NUMERIC(5,2),

    -- 3-Phase Current (A)
    current_r                 NUMERIC(8,2),
    current_y                 NUMERIC(8,2),
    current_b                 NUMERIC(8,2),

    -- Harmonics
    thd_percent               NUMERIC(6,2),

    -- Runtime
    runtime_hours             NUMERIC(7,1),
    idle_hours                NUMERIC(7,1),

    -- Predictive maintenance condition signals
    machine_heat_c            NUMERIC(6,2),
    machine_vibration_mm_s    NUMERIC(6,2),

    -- Production
    parts_produced            INT,
    rejection_count           INT,
    energy_per_part           NUMERIC(8,3),
    efficiency_score          INT CHECK (efficiency_score BETWEEN 0 AND 100)
);

CREATE INDEX idx_machine_metrics_machine_time ON machine_metrics (machine_id, recorded_at DESC);

-- ============================================================
-- 5. DAILY ENERGY & OUTPUT RECORDS (historical per-machine daily)
-- ============================================================
CREATE TABLE energy_output_daily (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_date      DATE         NOT NULL,
    machine_id       VARCHAR(20)  NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    energy_kwh       NUMERIC(10,2),
    production       INT,
    runtime_hours    NUMERIC(7,1),
    idle_hours       NUMERIC(7,1),
    energy_per_part  NUMERIC(8,3),
    cost_per_part    NUMERIC(10,2),
    efficiency_score INT CHECK (efficiency_score BETWEEN 0 AND 100),
    status           VARCHAR(20) CHECK (status IN ('running', 'idle', 'maintenance')),
    UNIQUE (record_date, machine_id)
);

CREATE INDEX idx_energy_output_daily_date ON energy_output_daily (record_date);

-- ============================================================
-- 6. SHIFT PRODUCTION
-- ============================================================
CREATE TABLE shift_production (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_date       DATE        NOT NULL,
    shift             VARCHAR(30) NOT NULL CHECK (shift IN ('Shift A (06-14)', 'Shift B (14-22)', 'Shift C (22-06)')),
    machine_id        VARCHAR(20) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    parts_produced    INT         NOT NULL DEFAULT 0,
    parts_rejected    INT         NOT NULL DEFAULT 0,
    production_target INT         NOT NULL DEFAULT 0,
    efficiency_pct    INT CHECK (efficiency_pct BETWEEN 0 AND 100),
    UNIQUE (record_date, shift, machine_id)
);

CREATE INDEX idx_shift_production_date ON shift_production (record_date, shift);

-- ============================================================
-- 7. MONTHLY PRODUCTION AGGREGATES
-- ============================================================
CREATE TABLE monthly_production (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year              INT         NOT NULL,
    month             VARCHAR(3)  NOT NULL CHECK (month IN ('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec')),
    total_production  INT,
    total_energy_kwh  NUMERIC(12,2),
    avg_energy_per_part NUMERIC(8,3),
    efficiency_score  INT CHECK (efficiency_score BETWEEN 0 AND 100),
    carbon_intensity  NUMERIC(8,4),
    UNIQUE (year, month)
);

-- ============================================================
-- 8. DEMAND RECORDS (15-minute interval metering)
-- ============================================================
CREATE TABLE demand_records (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    demand_kva         NUMERIC(10,2) NOT NULL,
    contract_demand_kva NUMERIC(10,2) NOT NULL,
    utilization_pct    INT,
    risk_level         VARCHAR(20) CHECK (risk_level IN ('Normal', 'Warning', 'Critical'))
);

CREATE INDEX idx_demand_records_time ON demand_records (recorded_at DESC);

-- ============================================================
-- 9. POWER QUALITY RECORDS
-- ============================================================
CREATE TABLE power_quality (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id            VARCHAR(20)  NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    recorded_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    voltage_r             INT,
    voltage_y             INT,
    voltage_b             INT,
    current_r             NUMERIC(8,2),
    current_y             NUMERIC(8,2),
    current_b             NUMERIC(8,2),

    power_factor          NUMERIC(4,2),
    frequency_hz          NUMERIC(6,2),
    thd_percent           NUMERIC(6,2),
    voltage_imbalance_pct NUMERIC(5,2),
    health_score          INT CHECK (health_score BETWEEN 0 AND 100)
);

CREATE INDEX idx_power_quality_machine_time ON power_quality (machine_id, recorded_at DESC);

-- ============================================================
-- 10. AI INSIGHTS & ALERTS
-- ============================================================
CREATE TABLE insights (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id        VARCHAR(20) REFERENCES machines(id) ON DELETE SET NULL,
    severity          VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical', 'info', 'success')),
    message           TEXT        NOT NULL,
    financial_impact  VARCHAR(255),
    production_impact TEXT,
    confidence_pct    INT CHECK (confidence_pct BETWEEN 0 AND 100),
    suggested_action  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insights_severity_time ON insights (severity, created_at DESC);

-- ============================================================
-- 11. CARBON & EMISSIONS TRACKING
-- ============================================================
CREATE TABLE carbon_emissions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_date      DATE        NOT NULL,
    machine_id       VARCHAR(20) NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    energy_kwh       NUMERIC(10,2),
    parts_produced   INT,
    co2_kg           NUMERIC(10,2),
    carbon_intensity NUMERIC(8,4),
    UNIQUE (record_date, machine_id)
);

CREATE INDEX idx_carbon_emissions_date ON carbon_emissions (record_date);

-- ============================================================
-- 12. CARBON INSIGHTS
-- ============================================================
CREATE TABLE carbon_insights (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity          VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'success', 'info')),
    message           TEXT        NOT NULL,
    carbon_reduction  VARCHAR(255),
    financial_impact  VARCHAR(255),
    recommendation    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 13. REPORTS METADATA
-- ============================================================
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_key      VARCHAR(100) NOT NULL UNIQUE,
    report_name     VARCHAR(255) NOT NULL,
    description     TEXT,
    last_generated  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 14. LOAD CURVE DATA (hourly plant-level load)
-- ============================================================
CREATE TABLE load_curve (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    load_kw     NUMERIC(10,2) NOT NULL
);

CREATE INDEX idx_load_curve_time ON load_curve (recorded_at DESC);

-- ============================================================
-- 15. PRODUCTION TREND (hourly aggregate)
-- ============================================================
CREATE TABLE production_trend (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    production  INT         NOT NULL DEFAULT 0,
    energy_kwh  NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_production_trend_time ON production_trend (recorded_at DESC);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default system configuration
INSERT INTO system_config (
    plant_name, location, industry_type, machine_count,
    tariff_per_kwh, contract_demand_kva, grid_emission_factor,
    demand_penalty_rate, renewable_percent, pf_minimum,
    thd_maximum, idle_time_threshold_hrs, heat_threshold_c, demand_warning_percent,
    energy_per_part_deviation
) VALUES (
    'Precision CNC Works', 'Pune, Maharashtra', 'Automotive Components', 5,
    8.5, 85, 0.82, 350, 22, 0.9, 5, 1.5, 85, 90, 15
);

-- Machines
INSERT INTO machines (id, name, status, rated_power_kw, production_target, heat_threshold_c, product_type) VALUES
    ('CNC-1', 'CNC-1 (Haas VF-2)',  'running',     22, 160, 84, 'Shaft'),
    ('CNC-2', 'CNC-2 (DMG Mori)',   'running',     26, 140, 88, 'Gear'),
    ('CNC-3', 'CNC-3 (Mazak)',      'idle',        20, 120, 86, 'Housing'),
    ('CNC-4', 'CNC-4 (Fanuc)',      'running',     18, 170, 82, 'Bracket'),
    ('CNC-5', 'CNC-5 (Okuma)',      'maintenance', 15,  80, 87, 'Pin');

-- Default users (passwords should be hashed in production)
INSERT INTO users (name, email, password_hash, role) VALUES
    ('Admin User',    'admin@gmail.com',    '$placeholder_hash_admin',    'admin'),
    ('Plant Manager', 'manager@gmail.com',  '$placeholder_hash_manager',  'manager'),
    ('CNC Operator',  'operator@gmail.com', '$placeholder_hash_operator', 'operator'),
    ('Rajesh Kumar',  'rajesh@cncworks.in', '$placeholder_hash_rajesh',   'admin'),
    ('Priya Sharma',  'priya@cncworks.in',  '$placeholder_hash_priya',    'manager'),
    ('Amit Patel',    'amit@cncworks.in',   '$placeholder_hash_amit',     'operator'),
    ('Sneha Desai',   'sneha@cncworks.in',  '$placeholder_hash_sneha',    'manager');

-- Report definitions
INSERT INTO reports (report_key, report_name, description) VALUES
    ('daily_cnc_energy',    'Daily CNC Energy Report',      'Energy consumption summary for all CNC machines'),
    ('production',          'Production Report',            'Shift-wise and machine-wise production data'),
    ('energy_per_part',     'Energy per Part Report',       'Energy efficiency analysis per part type'),
    ('monthly_efficiency',  'Monthly Efficiency Report',    'Comprehensive monthly plant efficiency analysis'),
    ('peak_demand',         'Peak Demand Analysis',         'Demand pattern analysis and penalty risk assessment'),
    ('cost_optimization',   'Cost Optimization Report',     'Cost savings opportunities and idle waste analysis');

-- Monthly production seed (matches frontend mockData)
INSERT INTO monthly_production (year, month, total_production, total_energy_kwh) VALUES
    (2025, 'Jan', 12400, 14200),
    (2025, 'Feb', 13100, 14800),
    (2025, 'Mar', 14500, 15200),
    (2025, 'Apr', 13800, 15600),
    (2025, 'May', 15200, 16100),
    (2025, 'Jun', 14900, 15400),
    (2025, 'Jul', 15800, 16800),
    (2025, 'Aug', 16200, 17100),
    (2025, 'Sep', 15500, 16200),
    (2025, 'Oct', 16800, 17500),
    (2025, 'Nov', 15900, 16600),
    (2025, 'Dec', 14200, 15100);

-- Sample AI insights (matches frontend mockData)
INSERT INTO insights (machine_id, severity, message, financial_impact, production_impact, confidence_pct, suggested_action) VALUES
    ('CNC-3', 'warning',  'CNC-3 consuming 22% more energy per part than plant average',         '₹12,400/month excess cost',   'Tool wear may increase rejection rate',        87, 'Schedule tool inspection and calibration for CNC-3'),
    ('CNC-5', 'info',     'CNC-5 idle for 2.4 hours during production shift',                    '₹3,200 wasted energy cost',   '~45 parts lost production',                    95, 'Review production scheduling for CNC-5'),
    (NULL,    'critical', 'Peak demand may exceed contract limit at 6:45 PM',                     '₹45,000 penalty risk',        'No direct impact',                             78, 'Stagger CNC-2 and CNC-3 operations during peak hours'),
    ('CNC-4', 'success',  'CNC-4 operating at 14% better efficiency than plant average',          '₹8,200/month savings vs average', 'Highest parts/kWh ratio',                  94, 'Replicate CNC-4 operating parameters across fleet'),
    ('CNC-2', 'warning',  'CNC-2 power factor dropped below 0.9 threshold',                      '₹5,600/month PF penalty risk', 'Reduced machining precision possible',         91, 'Check capacitor bank and motor condition on CNC-2'),
    ('CNC-4', 'info',     'Shifting CNC-4 operation to off-peak hours could save significantly',  '₹32,000/month potential savings', 'Requires shift rescheduling',              82, 'Move CNC-4 heavy operations to 22:00-06:00 window'),
    ('CNC-3', 'warning',  'CNC-3 abnormal power spike detected at 14:32',                        '₹2,100 excess energy cost',    'Potential part quality deviation',              76, 'Inspect spindle drive and coolant system on CNC-3'),
    ('CNC-1', 'success',  'CNC-1 rejection rate dropped 40% after last calibration',              '₹6,800/month material savings','18 fewer rejected parts/day',                  96, 'Schedule similar calibration for other machines');

-- ============================================================
-- HELPER VIEWS (for common frontend queries)
-- ============================================================

-- Cost analysis per machine (matches costData in frontend)
CREATE VIEW v_machine_cost AS
SELECT
    m.id,
    m.name,
    e.energy_kwh,
    ROUND(e.energy_kwh * sc.tariff_per_kwh, 0)                                    AS energy_cost,
    CASE WHEN e.production > 0
         THEN ROUND(e.energy_kwh * sc.tariff_per_kwh / e.production, 2)
         ELSE 0 END                                                                AS cost_per_part,
    ROUND(e.idle_hours * 3.2 * sc.tariff_per_kwh, 0)                              AS idle_cost
FROM machines m
JOIN energy_output_daily e ON e.machine_id = m.id
CROSS JOIN system_config sc
WHERE e.record_date = CURRENT_DATE;

-- Carbon metrics by machine
CREATE VIEW v_carbon_by_machine AS
SELECT
    m.id,
    m.name,
    e.energy_kwh,
    ROUND(e.energy_kwh * sc.grid_emission_factor, 2) AS co2_kg
FROM machines m
JOIN energy_output_daily e ON e.machine_id = m.id
CROSS JOIN system_config sc
WHERE e.record_date = CURRENT_DATE;

-- Daily plant summary
CREATE VIEW v_daily_summary AS
SELECT
    e.record_date,
    SUM(e.energy_kwh)                            AS total_energy_kwh,
    SUM(e.production)                            AS total_parts,
    ROUND(AVG(e.efficiency_score), 0)            AS avg_efficiency,
    ROUND(SUM(e.energy_kwh) * sc.tariff_per_kwh, 0)      AS total_energy_cost,
    ROUND(SUM(e.energy_kwh) * sc.grid_emission_factor, 2) AS total_co2_kg
FROM energy_output_daily e
CROSS JOIN system_config sc
GROUP BY e.record_date, sc.tariff_per_kwh, sc.grid_emission_factor
ORDER BY e.record_date DESC;
