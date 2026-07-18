require("dotenv").config();

const MongoStore = require("connect-mongo").default;
const path = require("path");
const os = require("os");
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
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/echo_feedback",
      collectionName: "sessions",
      ttl: 60 * 60 * 8, // 8 hours (session expiry)
    }),
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 8,
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

  app.listen(PORT, "0.0.0.0", () => {
    // Automatically computer ka Local Network IP Address dhundta hai
    const interfaces = os.networkInterfaces();
    let networkIp = "Not found (Check Wi-Fi/LAN)";

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        // Only IPv4 aur non-internal (jo 127.0.0.1 na ho) IP select karenge
        if (net.family === "IPv4" && !net.internal) {
          networkIp = net.address;
          break;
        }
      }
      if (networkIp !== "Not found (Check Wi-Fi/LAN)") break;
    }

    console.log(`\n========================================================`);
    console.log(`🚀 ECHO SERVER IS RUNNING PERFECTLY`);
    console.log(`========================================================`);
    console.log(`💻 Local Access    → http://localhost:${PORT}`);
    console.log(`🛡️  Admin Panel     → http://localhost:${PORT}/admin`);
    console.log(`📱 Network Access  → http://${networkIp}:${PORT}`);
    console.log(`========================================================\n`);

    if (!process.env.ADMIN_PASSWORD_HASH) {
      console.warn("⚠  ADMIN_PASSWORD_HASH is not set in .env — the admin panel login will not work yet.");
    }
    if (!process.env.ADMIN_EMAIL) {
      console.warn("⚠  SMTP_HOST / ADMIN_EMAIL not set in .env — email notifications are disabled for now.");
    }
  });
}

start();