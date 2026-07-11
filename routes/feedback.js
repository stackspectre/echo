const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const db = require("../db");
const { broadcast } = require("../sse");
const { sendFeedbackEmail } = require("../email");

const postLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this connection. Please try again later." },
});
const replyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many replies from this connection. Please try again later." },
});
const likeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GET /api/feedback?sort=newest|top|liked&q=search */
router.get("/", async (req, res) => {
  try {
    const sort = ["newest", "top", "liked"].includes(req.query.sort) ? req.query.sort : "newest";
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
    const data = await db.listFeedback({ sort, q });
    res.json(data);
  } catch (err) {
    console.error("[GET /api/feedback]", err);
    res.status(500).json({ error: "Could not load feedback right now." });
  }
});

/** GET /api/feedback/stats — public aggregate numbers for the hero counters (no PII). */
router.get("/stats", async (req, res) => {
  try {
    res.json(await db.getStats());
  } catch (err) {
    console.error("[GET /api/feedback/stats]", err);
    res.status(500).json({ error: "Could not load stats right now." });
  }
});

/** POST /api/feedback — create new feedback. */
router.post("/", postLimiter, async (req, res) => {
  try {
    const { name, email, rating, text } = req.body || {};

    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
      return res.status(400).json({ error: "Name is required (max 60 characters)." });
    }
    if (typeof email !== "string" || !EMAIL_RE.test(email.trim()) || email.trim().length > 80) {
      return res.status(400).json({ error: "A valid email is required." });
    }
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "Rating must be a whole number between 1 and 5." });
    }
    if (typeof text !== "string" || !text.trim() || text.trim().length > 300) {
      return res.status(400).json({ error: "Feedback text is required (max 300 characters)." });
    }

    const feedback = await db.createFeedback({
      name: name.trim(),
      email: email.trim(),
      rating: ratingNum,
      text: text.trim(),
    });

    broadcast("feedback:new", feedback);
    sendFeedbackEmail(feedback).catch((err) => console.error("[email] failed to send:", err.message));

    res.status(201).json(feedback);
  } catch (err) {
    console.error("[POST /api/feedback]", err);
    res.status(500).json({ error: "Could not save your feedback right now. Please try again." });
  }
});

/** POST /api/feedback/:id/reply */
router.post("/:id/reply", replyLimiter, async (req, res) => {
  try {
    const { name, text } = req.body || {};

    if (typeof name !== "string" || !name.trim() || name.trim().length > 40) {
      return res.status(400).json({ error: "Name is required (max 40 characters)." });
    }
    if (typeof text !== "string" || !text.trim() || text.trim().length > 300) {
      return res.status(400).json({ error: "Reply text is required (max 300 characters)." });
    }

    const reply = await db.addReply(req.params.id, { name: name.trim(), text: text.trim() });
    if (!reply) return res.status(404).json({ error: "That feedback no longer exists." });

    broadcast("feedback:reply", { feedbackId: req.params.id, reply });
    res.status(201).json(reply);
  } catch (err) {
    console.error("[POST /api/feedback/:id/reply]", err);
    res.status(500).json({ error: "Could not post your reply right now. Please try again." });
  }
});

/** POST /api/feedback/:id/like — toggles a like for the requesting client. */
router.post("/:id/like", likeLimiter, async (req, res) => {
  try {
    const clientId = req.get("X-Client-Id");
    if (!clientId || typeof clientId !== "string" || clientId.length > 100) {
      return res.status(400).json({ error: "Missing client id." });
    }

    const result = await db.toggleLike(req.params.id, clientId);
    if (!result) return res.status(404).json({ error: "That feedback no longer exists." });

    broadcast("feedback:like", { feedbackId: req.params.id, likes: result.likes });
    res.json(result);
  } catch (err) {
    console.error("[POST /api/feedback/:id/like]", err);
    res.status(500).json({ error: "Could not update your like right now. Please try again." });
  }
});

module.exports = router;
