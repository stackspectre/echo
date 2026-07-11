/**
 * email.js — sends the admin a full-detail email for every new feedback.
 *
 * Reads SMTP credentials from .env. If they aren't set, notifications are
 * skipped (with a console warning) instead of crashing the server — feedback
 * still saves and shows on the wall either way.
 */

const nodemailer = require("nodemailer");

let transporter = null;
let warned = false;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function sendFeedbackEmail(feedback) {
  const to = process.env.ADMIN_EMAIL;
  const t = getTransporter();

  if (!to || !t) {
    if (!warned) {
      console.warn(
        "[email] ADMIN_EMAIL / SMTP_* not fully configured in .env — skipping email notifications. " +
          "Feedback is still saved and shown on the wall."
      );
      warned = true;
    }
    return;
  }

  const stars = "★".repeat(feedback.rating) + "☆".repeat(5 - feedback.rating);
  const when = new Date(feedback.time).toLocaleString();

  await t.sendMail({
    from: process.env.SMTP_FROM || `"Echo Feedback" <${process.env.SMTP_USER}>`,
    to,
    subject: `New feedback (${feedback.rating}/5) from ${feedback.name}`,
    text:
      `${feedback.name} <${feedback.email}>\n` +
      `Rating: ${stars} (${feedback.rating}/5)\n\n` +
      `${feedback.text}\n\n` +
      `Submitted: ${when}\n` +
      `Feedback ID: ${feedback.id}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;color:#1a1a1a">
        <h2 style="margin:0 0 8px;font-size:18px">New feedback on Echo</h2>
        <p style="margin:0 0 4px"><strong>${escapeHtml(feedback.name)}</strong> &lt;${escapeHtml(feedback.email)}&gt;</p>
        <p style="margin:0 0 12px;color:#c3810f;font-size:15px">${stars} &nbsp;(${feedback.rating}/5)</p>
        <p style="white-space:pre-wrap;line-height:1.6;font-size:15px">${escapeHtml(feedback.text)}</p>
        <p style="color:#888;font-size:12px;margin-top:16px">Submitted ${when} &middot; ID ${feedback.id}</p>
      </div>
    `,
  });
}

module.exports = { sendFeedbackEmail };
