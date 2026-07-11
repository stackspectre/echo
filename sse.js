/**
 * sse.js — Server-Sent Events.
 *
 * Every connected browser tab holds one open GET /api/events connection.
 * Whenever anyone posts feedback, likes something, or replies, the server
 * calls broadcast() and every open tab (including other visitors currently
 * on the site) receives the update instantly — no refresh required.
 */

const clients = new Set();

function sseHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  clients.add(res);

  const keepAlive = setInterval(() => {
    res.write(":ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

module.exports = { sseHandler, broadcast };
