require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const session = require("express-session");

const { connectDb } = require("./db");
const { sseHandler } = require("./sse");
const feedbackRoutes = require("./routes/feedback");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// --- security -----------------------------------------------------------------
app.set("trust proxy", 1); // needed if you deploy behind a reverse proxy (Render, Railway, Nginx, etc.)
app.use(helmet({ contentSecurityPolicy: false })); // CSP left off by default; tighten for your deployment
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || true,
    credentials: true,
  })
);
app.use(express.json({ limit: "20kb" }));

app.use(
  session({
    name: "echo.sid",
    secret: process.env.SESSION_SECRET || "please-change-this-secret-in-.env",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: isProd, // requires HTTPS in production
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// --- realtime stream (must come before static so /api/events isn't ever cached) --
app.get("/api/events", sseHandler);

// --- API ------------------------------------------------------------------------
app.use("/api/feedback", feedbackRoutes);
app.use("/api/admin", adminRoutes);

// --- frontend ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- start ------------------------------------------------------------------------
async function start() {
  try {
    await connectDb();
  } catch (err) {
    console.error("\n✗ Could not connect to MongoDB.");
    console.error("  Make sure MongoDB is running and MONGODB_URI in .env is correct.");
    console.error(`  Tried: ${process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/echo_feedback"}`);
    console.error(`  Error: ${err.message}\n`);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Echo is running → http://localhost:${PORT}`);
    console.log(`Admin panel      → http://localhost:${PORT}/admin`);
    if (!process.env.ADMIN_PASSWORD_HASH) {
      console.warn("⚠  ADMIN_PASSWORD_HASH is not set in .env — the admin panel login will not work yet.");
    }
    if (!process.env.SMTP_HOST || !process.env.ADMIN_EMAIL) {
      console.warn("⚠  SMTP_HOST / ADMIN_EMAIL not set in .env — email notifications are disabled for now.");
    }
  });
}

start();
