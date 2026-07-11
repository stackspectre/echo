(() => {
  "use strict";

  let adminData = [];
  let query = "";

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function initialsOf(name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || "?";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts).toLocaleString();
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  const loginSection = document.getElementById("adminLogin");
  const dashSection = document.getElementById("adminDash");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const loginBtn = document.getElementById("loginBtn");

  function showDash() {
    loginSection.classList.add("hidden");
    dashSection.classList.remove("hidden");
    loadDashboard();
  }
  function showLogin() {
    dashSection.classList.add("hidden");
    loginSection.classList.remove("hidden");
  }

  async function checkSession() {
    try {
      const res = await fetch("/api/admin/session");
      const data = await res.json();
      if (data.isAdmin) showDash();
      else showLogin();
    } catch (err) {
      showLogin();
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("adminPassword").value;
    loginError.classList.add("hidden");
    loginBtn.disabled = true;
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || "Incorrect password.";
        loginError.classList.remove("hidden");
        return;
      }
      document.getElementById("adminPassword").value = "";
      showDash();
    } catch (err) {
      loginError.textContent = "Network error — please try again.";
      loginError.classList.remove("hidden");
    } finally {
      loginBtn.disabled = false;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  async function loadDashboard() {
    try {
      const [statsRes, feedbackRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/feedback"),
      ]);
      const stats = await statsRes.json();
      adminData = await feedbackRes.json();
      renderStats(stats);
      renderList();
    } catch (err) {
      showToast("Could not load dashboard data.");
    }
  }

  function renderStats(stats) {
    const el = document.getElementById("adminStats");
    const cards = [
      ["Total feedback", stats.total],
      ["Average rating", `${stats.avgRating}/5`],
      ["Feedback today", stats.feedbackToday],
      ["Replies today", stats.repliesToday],
      ["Total replies", stats.totalReplies],
    ];
    el.innerHTML = cards
      .map(([label, value]) => `<dl class="admin-stat-card"><dt>${label}</dt><dd>${value}</dd></dl>`)
      .join("");
  }

  function replyRowHTML(reply, feedbackId) {
    return `
      <div class="admin-reply-row" data-reply-id="${reply.id}">
        <div>
          <div class="admin-reply-row__text"><strong>${escapeHTML(reply.name)}:</strong> ${escapeHTML(reply.text)}</div>
          <div class="admin-reply-row__meta">${timeAgo(reply.time)}</div>
        </div>
        <button type="button" class="admin-danger-btn" data-action="delete-reply" data-reply-id="${reply.id}" data-feedback-id="${feedbackId}">Delete</button>
      </div>`;
  }

  function itemHTML(item) {
    const stars = "★".repeat(item.rating) + "☆".repeat(5 - item.rating);
    return `
      <article class="admin-item" data-id="${item.id}">
        <div class="admin-item__top">
          <div class="admin-item__who">
            <div class="avatar" style="background:#333;display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;font-family:var(--font-mono);font-size:.78rem;color:#fff;flex-shrink:0;">${initialsOf(item.name)}</div>
            <div class="admin-item__meta">
              <span class="fname">${escapeHTML(item.name)}</span>
              <span class="admin-item__email">${escapeHTML(item.email)}</span>
              <div class="admin-item__sub">${stars} (${item.rating}/5) · ${timeAgo(item.time)}</div>
            </div>
          </div>
          <button type="button" class="admin-danger-btn" data-action="delete-feedback">Delete feedback</button>
        </div>

        <p class="admin-item__text">${escapeHTML(item.text)}</p>

        <div class="admin-item__footer">
          <div class="admin-item__counts">
            <span>♥ ${item.likes} likes</span>
            <span>💬 ${item.replies.length} replies</span>
          </div>
          ${item.replies.length ? `<button type="button" class="admin-replies-toggle" data-action="toggle-replies">Show replies</button>` : ""}
        </div>

        ${item.replies.length ? `<div class="admin-replies hidden" data-role="admin-replies">${item.replies.map((r) => replyRowHTML(r, item.id)).join("")}</div>` : ""}
      </article>`;
  }

  function renderList() {
    const list = document.getElementById("adminList");
    const empty = document.getElementById("adminEmpty");
    let data = [...adminData];
    if (query) {
      const q = query.toLowerCase();
      data = data.filter((f) => f.name.toLowerCase().includes(q) || f.text.toLowerCase().includes(q));
    }
    list.innerHTML = data.map(itemHTML).join("");
    empty.classList.toggle("hidden", data.length > 0);
    list.classList.toggle("hidden", data.length === 0);
  }

  document.getElementById("adminSearch").addEventListener("input", (e) => {
    query = e.target.value.trim();
    renderList();
  });

  document.getElementById("adminList").addEventListener("click", async (e) => {
    const item = e.target.closest(".admin-item");

    const toggleBtn = e.target.closest('[data-action="toggle-replies"]');
    if (toggleBtn && item) {
      const panel = item.querySelector('[data-role="admin-replies"]');
      const isOpen = panel.classList.toggle("hidden") === false;
      toggleBtn.textContent = isOpen ? "Hide replies" : "Show replies";
      return;
    }

    const deleteFeedbackBtn = e.target.closest('[data-action="delete-feedback"]');
    if (deleteFeedbackBtn && item) {
      if (!confirm("Delete this feedback and all its replies? This cannot be undone.")) return;
      const id = item.dataset.id;
      deleteFeedbackBtn.disabled = true;
      try {
        const res = await fetch(`/api/admin/feedback/${id}`, { method: "DELETE" });
        if (!res.ok) { const data = await res.json(); showToast(data.error || "Could not delete."); return; }
        adminData = adminData.filter((f) => f.id !== id);
        renderList();
        showToast("Feedback deleted.");
      } catch (err) {
        showToast("Network error — please try again.");
      } finally {
        deleteFeedbackBtn.disabled = false;
      }
      return;
    }

    const deleteReplyBtn = e.target.closest('[data-action="delete-reply"]');
    if (deleteReplyBtn) {
      if (!confirm("Delete this reply?")) return;
      const replyId = deleteReplyBtn.dataset.replyId;
      const feedbackId = deleteReplyBtn.dataset.feedbackId;
      deleteReplyBtn.disabled = true;
      try {
        const res = await fetch(`/api/admin/reply/${replyId}`, { method: "DELETE" });
        if (!res.ok) { const data = await res.json(); showToast(data.error || "Could not delete."); return; }
        const parent = adminData.find((f) => f.id === feedbackId);
        if (parent) parent.replies = parent.replies.filter((r) => r.id !== replyId);
        renderList();
        showToast("Reply deleted.");
      } catch (err) {
        showToast("Network error — please try again.");
      } finally {
        deleteReplyBtn.disabled = false;
      }
    }
  });

  checkSession();
})();
