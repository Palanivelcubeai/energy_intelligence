const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "energy-intelligence-secret-key";

// ── Middleware: verify JWT ────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });
  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM platform_users WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user)
      return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/auth/users ───────────────────────────────────────────────────────
router.get("/users", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, role, created_at FROM platform_users ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/auth/users ──────────────────────────────────────────────────────
router.post("/users", authenticate, async (req, res) => {
  if (req.user.role !== "Admin")
    return res.status(403).json({ error: "Only admins can add users" });

  const { name, email, role, password } = req.body;
  if (!name || !email || !role)
    return res.status(400).json({ error: "Name, email and role are required" });

  try {
    const hash = await bcrypt.hash(password || "Energy@321", 10);
    const { rows } = await pool.query(
      `INSERT INTO platform_users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name.trim(), email.toLowerCase().trim(), hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email already exists" });
    console.error("Add user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PUT /api/auth/users/:id ───────────────────────────────────────────────────
router.put("/users/:id", authenticate, async (req, res) => {
  if (req.user.role !== "Admin")
    return res.status(403).json({ error: "Only admins can edit users" });

  const { name, email, role } = req.body;
  if (!name || !email || !role)
    return res.status(400).json({ error: "Name, email and role are required" });

  try {
    const { rows } = await pool.query(
      `UPDATE platform_users SET name=$1, email=$2, role=$3
       WHERE id=$4
       RETURNING id, name, email, role`,
      [name.trim(), email.toLowerCase().trim(), role, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email already exists" });
    console.error("Edit user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── DELETE /api/auth/users/:id ────────────────────────────────────────────────
router.delete("/users/:id", authenticate, async (req, res) => {
  if (req.user.role !== "Admin")
    return res.status(403).json({ error: "Only admins can delete users" });

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM platform_users WHERE id=$1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
