-- ============================================================
-- Migration: Create platform_users table
-- Run once against the energy_db PostgreSQL database
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(100)  UNIQUE NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          VARCHAR(20)   NOT NULL CHECK (role IN ('Admin', 'Manager', 'Operator')),
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Index for fast login lookups by email
CREATE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users (email);
