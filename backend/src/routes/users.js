const router = require("express").Router();
const bcrypt = require("bcrypt");
const pool = require("../db");

// GET /api/users
router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, role, is_main_admin FROM users ORDER BY created_at"
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users
router.post("/", async (req, res) => {
  try {
    const { name, email, role, password } = req.body;
    if (!name || !email || !role || !password) {
      return res.status(400).json({ error: "name, email, role, and password are required" });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, role`,
      [name, email, hash, role.toLowerCase()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("POST /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/users/:id
router.put("/:id", async (req, res) => {
  try {
    const { name, email, role, password, currentPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required to edit user" });
    }
    // Verify current password
    const { rows: userRows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.params.id]);
    if (userRows.length === 0) return res.status(404).json({ error: "User not found" });
    const valid = await bcrypt.compare(currentPassword, userRows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query = `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email),
               role = COALESCE($3, role), password_hash = $4, updated_at = NOW()
               WHERE id = $5 RETURNING id, name, email, role`;
      params = [name, email, role?.toLowerCase(), hash, req.params.id];
    } else {
      query = `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email),
               role = COALESCE($3, role), updated_at = NOW()
               WHERE id = $4 RETURNING id, name, email, role`;
      params = [name, email, role?.toLowerCase(), req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("PUT /users/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/users/:id
router.delete("/:id", async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT is_main_admin FROM users WHERE id = $1", [req.params.id]);
    if (check.length === 0) return res.status(404).json({ error: "User not found" });
    if (check[0].is_main_admin) return res.status(403).json({ error: "Cannot delete the main admin" });
    const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("DELETE /users/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
