let warned = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function sendFeedbackEmail(feedback) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_EMAIL;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";

  if (!apiKey || !to) {
    if (!warned) {
      console.warn(
        "[email] RESEND_API_KEY / ADMIN_EMAIL not set in .env — skipping email notifications. " +
        "Feedback is still saved and shown on the wall."
      );
      warned = true;
    }
    return;
  }

  const stars = "★".repeat(feedback.rating) + "☆".repeat(5 - feedback.rating);
  const when = new Date(feedback.time).toLocaleString();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Echo Feedback <${from}>`,
      to: [to],
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
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API responded ${res.status}: ${body}`);
  }
}

module.exports = { sendFeedbackEmail };