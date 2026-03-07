/**
 * Database migration script.
 * Creates the platform_users table if it does not already exist.
 * Users are managed exclusively through the Admin page (API).
 *
 * Usage:  cd backend && node seed.js
 */
require("dotenv").config();
const pool = require("./db");

async function setup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_users (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(20)  NOT NULL CHECK (role IN ('Admin','Manager','Operator')),
      created_at    TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✓ Table platform_users ready");
  console.log("Add users via the Admin page in the application.");
  process.exit(0);
}

setup().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
