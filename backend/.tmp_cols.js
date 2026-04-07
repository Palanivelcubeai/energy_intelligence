const pool = require("./src/db");
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='machine_metrics' ORDER BY ordinal_position")
  .then(r => {
    console.log(r.rows.map(x => x.column_name).join(", "));
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
