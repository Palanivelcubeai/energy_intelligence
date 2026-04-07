const pool = require("./src/db");
const sql = `
ALTER TABLE machine_metrics ADD COLUMN IF NOT EXISTS machine_heat_c NUMERIC(6,2);
ALTER TABLE machine_metrics ADD COLUMN IF NOT EXISTS machine_vibration_mm_s NUMERIC(6,2);
ALTER TABLE machine_metrics ADD COLUMN IF NOT EXISTS machine_speed_rpm INT;
`;
pool.query(sql)
  .then(() => pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='machine_metrics' AND column_name IN ('machine_heat_c','machine_vibration_mm_s','machine_speed_rpm') ORDER BY column_name"))
  .then((r) => { console.log(r.rows); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
