# Echo — feedback wall (full backend)

A public feedback wall with a real backend: everyone's feedback is saved to
MongoDB, shows up for every visitor (not just you), updates live for anyone
on the site without a refresh, notifies you by email, and has a
password-protected admin panel to manage it all.

**Pure JavaScript stack — nothing to compile, no Python required.** Every
dependency here (Express, Mongoose, bcryptjs, etc.) is plain JS. If you hit
build errors before, it was `better-sqlite3` trying to compile native code —
this version doesn't use it at all.

**This is a real Node.js server**, not a file you open in a browser. You run
it (locally, or on a host later) and it serves the site.

---

## 1. What's inside

```
server.js          → the Express app / entry point
db.js               → MongoDB models + queries (Mongoose)
sse.js               → realtime push to every connected browser
email.js             → sends you an email for every new feedback
routes/feedback.js   → public API: list/create feedback, like, reply
routes/admin.js      → admin API: login, stats, delete feedback/replies
scripts/hash-password.js → helper to generate your admin password hash
public/              → the actual website (served as static files)
  index.html, styles.css, script.js   → the feedback wall
  admin.html, admin.css, admin.js      → the admin panel (/admin)
.env.example         → copy this to .env and fill in your own secrets
```

The wall starts completely empty — no dummy/fake data anywhere. It fills up
with real submissions only.

## 2. Prerequisites

- **Node.js 18+** (you have v24 — that's fine, everything here is compatible).
- **MongoDB running somewhere you can reach.** Since you already have an
  Express + Mongo setup on your machine, you likely already have this —
  just point `MONGODB_URI` at it (step 4). If not: install MongoDB Community
  Server locally, or create a free cluster on
  [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and use that
  connection string instead.

## 3. Install

```bash
npm install
```

This installs exactly 8 packages, all pure JS: `express`, `mongoose`,
`bcryptjs`, `cors`, `dotenv`, `express-rate-limit`, `express-session`,
`helmet`, `nodemailer`. No native builds, no `node-gyp`, no Python.

## 4. Configure your secrets

```bash
cp .env.example .env
```

Then open `.env` and fill in:

**Database** — point this at whatever MongoDB you're already running:
```
MONGODB_URI=mongodb://127.0.0.1:27017/echo_feedback
```
(If your existing project uses a different host/port/auth, use that same
connection string here — just change the database name at the end if you
want Echo's data kept separate.)

**Session secret** (required — keeps admin logins secure):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the output into `SESSION_SECRET=`.

**Admin password** (required for the `/admin` panel):
```bash
npm run hash-password -- "choose-a-strong-password"
```
This prints an `ADMIN_PASSWORD_HASH=...` line — paste it into `.env`. Your
real password is never stored anywhere, only its hash.

**Email notifications** (optional, but you asked for this — recommended):
Set `ADMIN_EMAIL` to where you want notifications sent, and fill in
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` with real SMTP
credentials. Two easy options:
- **Gmail**: host `smtp.gmail.com`, port `587`, and a
  [Gmail App Password](https://myaccount.google.com/apppasswords) (not your
  normal password) as `SMTP_PASS`.
- **A transactional email service** (Resend, SendGrid, Postmark, etc.) — they
  all give you SMTP host/user/pass on their dashboard, usually free for low volume.

If you leave `SMTP_HOST` blank, the site still works perfectly — it just
skips sending emails and logs a warning in the terminal instead of crashing.

## 5. Run it

Make sure MongoDB is actually running first (e.g. `mongod`, or your local
service is started, or your Atlas cluster is up), then:

```bash
npm start
```

You'll see:
```
[db] connected to MongoDB
Echo is running → http://localhost:3000
Admin panel      → http://localhost:3000/admin
```

If you instead see a `✗ Could not connect to MongoDB` message, MongoDB
isn't reachable at the `MONGODB_URI` you set — start it, or fix the URI.

Open `http://localhost:3000` — that's your live feedback wall. Submit
feedback from two different browser tabs side by side and watch it appear
in both instantly (that's the realtime piece working).

## 6. The admin panel

Go to `http://localhost:3000/admin`, or — while on the main site — press
**Ctrl+Shift+A** (Cmd+Shift+A on Mac) to open it in a new tab. Log in with
the password you hashed in step 4. From there you can see full details
(including real, unmasked emails), see live stats, and delete any feedback
or individual reply.

## 7. How "global" and "live" actually work

- **Saved globally**: every submission is written to MongoDB. Anyone who
  loads the site — on any device, at any time — gets the same data from
  that one database, via `GET /api/feedback`. This is what makes it a real
  shared wall instead of something only you can see.
- **Live, no refresh needed**: every browser tab keeps one open connection
  to `GET /api/events` (Server-Sent Events). The moment anyone submits
  feedback, likes something, or replies, the server pushes that update to
  every open tab immediately.
- **Likes**: each browser gets a random anonymous ID (stored in
  `localStorage`) so the server knows to toggle *your* like on/off, without
  needing accounts or logins for visitors.

## 8. Putting this on the internet (so it's not just on your laptop)

Right now this only runs on your own machine. To make it a real public site:

1. Push this folder to a Git repository.
2. Deploy it on a Node-friendly host — **Render**, **Railway**, and
   **Fly.io** all have simple "point at a repo, it runs `npm start`" flows
   with a free tier. A plain VPS with `pm2` works too.
3. Use a MongoDB Atlas connection string for `MONGODB_URI` in production
   (a local `mongodb://127.0.0.1` won't be reachable from a hosted server).
4. Set the same environment variables from your `.env` in that host's
   dashboard (never commit `.env` itself — `.gitignore` already excludes it).
5. Set `NODE_ENV=production` and `ALLOWED_ORIGIN=https://your-real-domain.com`.
6. Make sure your host serves the site over **HTTPS** — the admin session
   cookie is set to `secure` in production, which requires it.

## 9. Security notes

- Admin password is bcrypt-hashed, never stored in plain text.
- Admin sessions use signed, `httpOnly`, `sameSite=strict` cookies.
- Submitting feedback, replying, and liking are all rate-limited per
  connection to deter spam/abuse.
- All input is validated server-side (never trust the browser alone).
- All user-generated text is HTML-escaped before it's ever rendered, on both
  the public wall and the admin panel.
- `helmet` sets sensible security headers by default.
- MongoDB `_id`s are validated before every query, so malformed IDs return a
  clean 404 instead of an error.

If you're deploying this for real, it's worth reading through `server.js`
once — the comments call out the couple of places (CSP, CORS origin) you'll
want to tighten for your specific domain.
