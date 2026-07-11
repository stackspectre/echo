const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const db = require("../db");
const { broadcast } = require("../sse");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Not authenticated." });
}

/** POST /api/admin/login — { password } */
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) {
      return res.status(500).json({ error: "Admin password is not configured on the server (see .env)." });
    }
    const { password } = req.body || {};
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Password is required." });
    }

    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.status(401).json({ error: "Incorrect password." });

    req.session.isAdmin = true;
    res.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/admin/login]", err);
    res.status(500).json({ error: "Login failed — please try again." });
  }
});

/** POST /api/admin/logout */
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/** GET /api/admin/session — lets the admin page check if it's already logged in. */
router.get("/session", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

/** GET /api/admin/feedback — full detail (unmasked email), protected. */
router.get("/feedback", requireAuth, async (req, res) => {
  try {
    res.json(await db.listFeedback({ sort: "newest", q: "" }));
  } catch (err) {
    console.error("[GET /api/admin/feedback]", err);
    res.status(500).json({ error: "Could not load feedback right now." });
  }
});

/** GET /api/admin/stats — protected. */
router.get("/stats", requireAuth, async (req, res) => {
  try {
    res.json(await db.getStats());
  } catch (err) {
    console.error("[GET /api/admin/stats]", err);
    res.status(500).json({ error: "Could not load stats right now." });
  }
});

/** DELETE /api/admin/feedback/:id — removes feedback and its replies/likes. */
router.delete("/feedback/:id", requireAuth, async (req, res) => {
  try {
    const ok = await db.deleteFeedback(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found." });
    broadcast("feedback:delete", { feedbackId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/admin/feedback/:id]", err);
    res.status(500).json({ error: "Could not delete right now." });
  }
});

/** DELETE /api/admin/reply/:id */
router.delete("/reply/:id", requireAuth, async (req, res) => {
  try {
    const result = await db.deleteReply(req.params.id);
    if (!result) return res.status(404).json({ error: "Not found." });
    broadcast("feedback:reply:delete", result);
    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/admin/reply/:id]", err);
    res.status(500).json({ error: "Could not delete right now." });
  }
});

module.exports = router;
