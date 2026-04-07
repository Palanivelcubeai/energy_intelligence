const pool=require("./src/db");
pool.query(`
  SELECT machine_id, machine_heat_c, machine_vibration_mm_s, machine_speed_rpm, recorded_at
  FROM machine_metrics
  WHERE machine_heat_c IS NOT NULL OR machine_vibration_mm_s IS NOT NULL OR machine_speed_rpm IS NOT NULL
  ORDER BY recorded_at DESC
  LIMIT 10
`).then(r=>{console.log(r.rows); process.exit(0);}).catch(e=>{console.error(e); process.exit(1);});
