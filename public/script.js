/* ===========================================================================
   ECHO — feedback wall (live backend edition)
   -----------------------------------------------------------------------
   This file talks to the real Express + MongoDB backend in ../server.js:
     - GET  /api/feedback            initial load of every saved feedback
     - POST /api/feedback            submit new feedback
     - POST /api/feedback/:id/like   toggle a like
     - POST /api/feedback/:id/reply  post a reply
     - GET  /api/events              Server-Sent Events — live push to every
                                      open tab, so nobody needs to refresh

   No dummy data lives in this file anymore. Everything you see (the wall,
   the spotlight, the pulse ticker, the hero counters) is derived from what
   the server actually has saved.

   Sections:
     1. STATE & HELPERS     — client id, "my likes", avatars, time, escaping
     2. RENDER: FEED         — feed cards + reply panel
     3. FEED INTERACTIONS    — rating picker, submit, like, reply, sort, search
     4. RENDER: SPOTLIGHT    — derived from top-rated real feedback
     5. RENDER: PULSE TICKER — derived from real recent activity
     6. REALTIME (SSE)       — live updates for every connected visitor
     7. SHOWPIECE LAYER      — theme toggle, cursor, particles, glass glow, etc.
     8. INIT
=========================================================================== */

(() => {
  "use strict";

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isFinePointer = window.matchMedia("(pointer: fine)").matches;
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  /* =========================================================
     1. STATE & HELPERS
  ========================================================= */
  let feedbackData = []; // populated entirely from the server — no seed data
  let currentSort = "newest";
  let currentQuery = "";
  let selectedRating = 0;
  let lastSubmittedId = null;

  const AVATAR_GRADIENTS = [
    ["#F2A73B", "#FF6B5B"],
    ["#35C2A6", "#3B82C4"],
    ["#8C8CF2", "#5B6EFF"],
    ["#FF8A65", "#F2A73B"],
    ["#35C2A6", "#8CE0C0"],
    ["#5B6EFF", "#35C2A6"],
  ];

  // Anonymous per-browser id, used only so the server can toggle your own likes on/off.
  function getClientId() {
    let id = localStorage.getItem("echo_client_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("echo_client_id", id);
    }
    return id;
  }

  // Which feedback IDs *this browser* has liked — for rendering the filled heart correctly.
  const myLikes = new Set(JSON.parse(localStorage.getItem("echo_my_likes") || "[]"));
  function persistMyLikes() {
    localStorage.setItem("echo_my_likes", JSON.stringify([...myLikes]));
  }

  // Remembered display name, so replying twice doesn't mean typing your name twice.
  function getSavedName() { return localStorage.getItem("echo_display_name") || ""; }
  function saveName(name) { if (name) localStorage.setItem("echo_display_name", name); }

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

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0; }
    return Math.abs(hash);
  }

  function gradientFor(name) {
    const [a, b] = AVATAR_GRADIENTS[hashString(name) % AVATAR_GRADIENTS.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  }

  function avatarHTML(name, size = "") {
    const cls = size ? `avatar avatar--${size}` : "avatar";
    return `<div class="${cls}" style="background:${gradientFor(name)}">${initialsOf(name)}</div>`;
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function ratingBarsHTML(value) {
    let bars = "";
    for (let i = 1; i <= 5; i++) bars += `<span class="bar${i <= value ? " filled" : ""}" style="--i:${i}"></span>`;
    return `<span class="rating-bars" aria-label="${value} out of 5">${bars}</span>`;
  }

  function maskEmail(email) {
    const [user, domain] = email.split("@");
    if (!user || !domain) return email;
    const visible = user.slice(0, 2);
    return `${visible}${"•".repeat(Math.max(user.length - 2, 2))}@${domain}`;
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  /* =========================================================
     2. RENDER: FEED
  ========================================================= */
  const feedList = document.getElementById("feedList");
  const feedEmpty = document.getElementById("feedEmpty");

  function replyRowHTML(reply) {
    return `
      <div class="reply" data-reply-id="${reply.id}">
        ${avatarHTML(reply.name, "sm")}
        <div class="reply__meta">
          <div class="reply__name-row">
            <span class="fname">${escapeHTML(reply.name)}</span>
            <span class="ftime">${timeAgo(reply.time)}</span>
          </div>
          <p class="reply__text">${escapeHTML(reply.text)}</p>
        </div>
      </div>`;
  }

  function cardHTML(item) {
    const liked = myLikes.has(item.id);
    const repliesHTML = item.replies.length
      ? `<div class="replies">${item.replies.map(replyRowHTML).join("")}</div>`
      : `<p class="no-replies">No replies yet — be the first to respond.</p>`;

    return `
      <article class="fcard" data-id="${item.id}" data-reveal-card>
        <div class="fcard__top">
          ${avatarHTML(item.name)}
          <div class="fcard__meta">
            <div class="fcard__name-row">
              <span class="fname">${escapeHTML(item.name)}</span>
              ${item.rating >= 4 ? '<span class="fbadge">★ verified voice</span>' : ""}
            </div>
            <div class="fcard__sub">
              ${ratingBarsHTML(item.rating)}
              <span class="dot">·</span>
              <span class="ftime">${timeAgo(item.time)}</span>
              <span class="dot">·</span>
              <span class="femail">${maskEmail(item.email)}</span>
            </div>
          </div>
        </div>

        <p class="fcard__text">${escapeHTML(item.text)}</p>

        <div class="fcard__actions">
          <button type="button" class="action-btn like-btn${liked ? " is-liked" : ""}" data-action="like">
            <span class="burst" aria-hidden="true"></span>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 13S1.5 9.4 1.5 5.4C1.5 3.4 3 2 4.9 2c1.1 0 2.1.6 2.6 1.5C8 2.6 9 2 10.1 2 12 2 13.5 3.4 13.5 5.4c0 4-6 7.6-6 7.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            <span class="count">${item.likes}</span>
          </button>
          <button type="button" class="action-btn reply-btn" data-action="toggle-reply">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 3h11v7H6l-3 3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            Reply${item.replies.length ? ` (${item.replies.length})` : ""}
          </button>
        </div>

        <div class="reply-panel" data-role="reply-panel">
          <div>
            ${repliesHTML}
            <div class="reply-add-row">
              <input type="text" class="reply-name-input" placeholder="Your name" maxlength="40" data-role="reply-name" value="${escapeHTML(getSavedName())}">
              <div class="reply-add-row__bottom">
                <textarea rows="1" placeholder="Write a reply…" maxlength="300" data-role="reply-input"></textarea>
                <button type="button" class="btn btn--primary" data-action="submit-reply">Post</button>
              </div>
            </div>
          </div>
        </div>
      </article>`;
  }

  function getVisibleData() {
    let data = [...feedbackData];
    if (currentQuery) {
      const q = currentQuery.toLowerCase();
      data = data.filter((item) => item.name.toLowerCase().includes(q) || item.text.toLowerCase().includes(q));
    }
    if (currentSort === "newest") data.sort((a, b) => b.time - a.time);
    if (currentSort === "top") data.sort((a, b) => b.rating - a.rating || b.time - a.time);
    if (currentSort === "liked") data.sort((a, b) => b.likes - a.likes || b.time - a.time);
    return data;
  }

  function renderFeed() {
    const data = getVisibleData();
    feedList.innerHTML = data.map(cardHTML).join("");

    const showEmpty = data.length === 0;
    feedEmpty.classList.toggle("hidden", !showEmpty);
    feedList.classList.toggle("hidden", showEmpty);
    observeReveal();
    attachTilt();

    if (!showEmpty) return;

    if (feedbackData.length === 0) {
      feedEmpty.innerHTML = `Nobody's posted yet — <button type="button" id="goToComposer" class="link-btn">be the first voice</button> on the wall.`;
      const goBtn = document.getElementById("goToComposer");
      if (goBtn) goBtn.addEventListener("click", () => document.getElementById("share").scrollIntoView({ behavior: "smooth" }));
    } else {
      feedEmpty.innerHTML = `Nothing matches that search. <button type="button" id="clearSearch" class="link-btn">Clear it</button> and see the whole wall.`;
      rebindClearSearch();
    }
  }

  function renderWaveform() {
    const el = document.querySelector(".waveform");
    if (!el) return;
    const bars = 42;
    let html = "";
    for (let i = 0; i < bars; i++) {
      const min = (0.2 + Math.random() * 0.3).toFixed(2);
      const max = (0.6 + Math.random() * 0.4).toFixed(2);
      html += `<span class="wbar" style="--i:${i};--min:${min};--max:${max}"></span>`;
    }
    el.innerHTML = html;
  }

  /* =========================================================
     3. FEED INTERACTIONS
  ========================================================= */
  const ratingPicker = document.getElementById("ratingPicker");
  const ratingValueLabel = document.getElementById("ratingValue");
  const ratingInput = document.getElementById("fRating");
  ratingPicker.classList.add("is-empty");

  function setRating(value) {
    selectedRating = value;
    ratingInput.value = value;
    ratingPicker.classList.toggle("is-empty", value === 0);
    [...ratingPicker.querySelectorAll(".rating-picker__bar")].forEach((bar) => {
      const v = Number(bar.dataset.value);
      bar.classList.toggle("is-filled", v <= value);
      bar.setAttribute("aria-checked", String(v === value));
    });
    const labels = ["Tap a bar", "Poor", "Fair", "Good", "Great", "Excellent"];
    ratingValueLabel.textContent = value ? `${labels[value]} · ${value}/5` : labels[0];
  }

  ratingPicker.addEventListener("click", (e) => {
    const bar = e.target.closest(".rating-picker__bar");
    if (!bar) return;
    setRating(Number(bar.dataset.value));
  });

  const nameInput = document.getElementById("fName");
  const avatarPreview = document.getElementById("avatarPreview");

  function refreshAvatarPreview() {
    const name = nameInput.value.trim();
    if (name) {
      avatarPreview.textContent = initialsOf(name);
      avatarPreview.style.background = gradientFor(name);
      avatarPreview.style.color = "#1a1108";
    } else {
      avatarPreview.textContent = "?";
      avatarPreview.style.background = "";
      avatarPreview.style.color = "";
    }
  }
  nameInput.addEventListener("input", refreshAvatarPreview);

  const messageInput = document.getElementById("fMessage");
  const charCount = document.getElementById("charCount");
  messageInput.addEventListener("input", () => {
    const len = messageInput.value.length;
    charCount.textContent = String(len);
    const counter = charCount.parentElement;
    counter.classList.toggle("is-near-limit", len >= 260 && len < 300);
    counter.classList.toggle("is-full", len >= 300);
  });

  const composerForm = document.getElementById("composerForm");
  const submitBtn = document.getElementById("submitBtn");

  // prefill from what this browser remembers
  const savedName = getSavedName();
  if (savedName) { nameInput.value = savedName; refreshAvatarPreview(); }

  composerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const email = document.getElementById("fEmail").value.trim();
    const text = messageInput.value.trim();

    if (!name || !email || !text || !selectedRating) {
      showToast("Fill in your name, email, a rating, and a message.");
      return;
    }

    submitBtn.disabled = true;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, rating: selectedRating, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Something went wrong. Please try again.");
        return;
      }

      lastSubmittedId = data.id;
      saveName(name);
      composerForm.reset();
      setRating(0);
      charCount.textContent = "0";
      charCount.parentElement.classList.remove("is-near-limit", "is-full");
      nameInput.value = name; // keep the name field filled for next time
      refreshAvatarPreview();

      showToast("Your voice is on the wall.");
      document.getElementById("wall").scrollIntoView({ behavior: "smooth", block: "start" });
      // The card itself is added by the realtime SSE handler below, so every
      // open tab — including this one — shows exactly the same feed.
    } catch (err) {
      showToast("Network error — please check your connection and try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  feedList.addEventListener("click", async (e) => {
    const card = e.target.closest(".fcard");
    if (!card) return;
    const id = card.dataset.id;

    const likeBtn = e.target.closest('[data-action="like"]');
    if (likeBtn) {
      if (likeBtn.disabled) return;
      likeBtn.disabled = true;
      try {
        const res = await fetch(`/api/feedback/${id}/like`, {
          method: "POST",
          headers: { "X-Client-Id": getClientId() },
        });
        const data = await res.json();
        if (res.ok) {
          if (data.liked) myLikes.add(id); else myLikes.delete(id);
          persistMyLikes();
          likeBtn.classList.toggle("is-liked", data.liked);
          likeBtn.querySelector(".count").textContent = data.likes;
          const item = feedbackData.find((f) => f.id === id);
          if (item) item.likes = data.likes;
          if (data.liked) {
            likeBtn.classList.add("is-pulsing");
            spawnBurst(likeBtn);
            setTimeout(() => likeBtn.classList.remove("is-pulsing"), 400);
          }
        } else {
          showToast(data.error || "Could not update your like.");
        }
      } catch (err) {
        showToast("Network error — please try again.");
      } finally {
        likeBtn.disabled = false;
      }
      return;
    }

    const replyBtn = e.target.closest('[data-action="toggle-reply"]');
    if (replyBtn) {
      const panel = card.querySelector('[data-role="reply-panel"]');
      const isOpen = panel.classList.toggle("is-open");
      replyBtn.classList.toggle("is-open", isOpen);
      if (isOpen) panel.querySelector('[data-role="reply-input"]').focus();
      return;
    }

    const submitReplyBtn = e.target.closest('[data-action="submit-reply"]');
    if (submitReplyBtn) {
      const nameField = card.querySelector('[data-role="reply-name"]');
      const textarea = card.querySelector('[data-role="reply-input"]');
      const replyName = nameField.value.trim();
      const text = textarea.value.trim();
      if (!replyName) { nameField.focus(); showToast("Add your name so people know who replied."); return; }
      if (!text) { textarea.focus(); return; }

      submitReplyBtn.disabled = true;
      try {
        const res = await fetch(`/api/feedback/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: replyName, text }),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || "Could not post that reply.");
          return;
        }
        saveName(replyName);
        textarea.value = "";
        showToast("Reply posted.");
        // The new reply is appended by the realtime SSE handler for everyone, including us.
      } catch (err) {
        showToast("Network error — please try again.");
      } finally {
        submitReplyBtn.disabled = false;
      }
    }
  });

  feedList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.matches('[data-role="reply-input"]')) {
      e.preventDefault();
      e.target.closest(".fcard").querySelector('[data-action="submit-reply"]').click();
    }
  });

  function spawnBurst(likeBtn) {
    const burst = likeBtn.querySelector(".burst");
    burst.classList.remove("is-animating");
    void burst.offsetWidth;
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 10;
    burst.style.setProperty("--bx", `${Math.cos(angle) * dist}px`);
    burst.style.setProperty("--by", `${Math.sin(angle) * dist}px`);
    burst.classList.add("is-animating");
  }

  const sortPills = document.getElementById("sortPills");
  function updateSortPills(sort) {
    [...sortPills.querySelectorAll(".pill")].forEach((pill) => {
      const active = pill.dataset.sort === sort;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-selected", String(active));
    });
  }
  sortPills.addEventListener("click", (e) => {
    const pill = e.target.closest(".pill");
    if (!pill) return;
    currentSort = pill.dataset.sort;
    updateSortPills(currentSort);
    renderFeed();
  });

  const searchInput = document.getElementById("searchInput");
  function rebindClearSearch() {
    const btn = document.getElementById("clearSearch");
    if (!btn) return;
    btn.addEventListener("click", () => {
      searchInput.value = "";
      currentQuery = "";
      renderFeed();
      searchInput.focus();
    });
  }
  searchInput.addEventListener("input", () => { currentQuery = searchInput.value.trim(); renderFeed(); });
  rebindClearSearch();

  /* =========================================================
     4. RENDER: SPOTLIGHT (derived from real top-rated feedback)
  ========================================================= */
  let spotlightActive = 0;
  let spotlightTimer = null;
  let spotlightProgressFill = null;

  function computeSpotlightItems() {
    return [...feedbackData]
      .filter((f) => f.rating >= 4)
      .sort((a, b) => b.likes - a.likes || b.rating - a.rating || b.time - a.time)
      .slice(0, 5);
  }

  function fitSpotlightQuote(el) {
    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    let guard = 0;
    while (el.scrollHeight > el.clientHeight + 1 && size > 15 && guard < 20) {
      size -= 1;
      el.style.fontSize = size + "px";
      guard++;
    }
  }
  function fitAllSpotlightQuotes(track) {
    track.querySelectorAll(".spotlight-quote").forEach(fitSpotlightQuote);
  }

  function restartSpotlightProgress() {
    if (!spotlightProgressFill || prefersReducedMotion) return;
    spotlightProgressFill.classList.remove("is-filling");
    void spotlightProgressFill.offsetWidth;
    spotlightProgressFill.classList.add("is-filling");
  }

  function showSpotlightSlide(index) {
    const track = document.getElementById("spotlightTrack");
    const dotsWrap = document.getElementById("spotlightDots");
    const slides = [...track.querySelectorAll(".spotlight-slide")];
    const dots = [...dotsWrap.querySelectorAll(".spotlight-dot")];
    if (!slides.length) return;
    spotlightActive = (index + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle("is-active", i === spotlightActive));
    dots.forEach((d, i) => d.classList.toggle("is-active", i === spotlightActive));
    restartSpotlightProgress();
  }

  function startSpotlightAuto() {
    if (prefersReducedMotion) return;
    stopSpotlightAuto();
    spotlightTimer = setInterval(() => showSpotlightSlide(spotlightActive + 1), 5000);
  }
  function stopSpotlightAuto() { if (spotlightTimer) clearInterval(spotlightTimer); }

  function renderSpotlight() {
    const card = document.getElementById("spotlightCard");
    const track = document.getElementById("spotlightTrack");
    const dotsWrap = document.getElementById("spotlightDots");
    const items = computeSpotlightItems();

    if (!items.length) {
      track.innerHTML = "";
      dotsWrap.innerHTML = "";
      card.classList.add("is-empty");
      stopSpotlightAuto();
      return;
    }
    card.classList.remove("is-empty");

    track.innerHTML = items.map((s) => `
      <div class="spotlight-slide">
        <p class="spotlight-quote">"${escapeHTML(s.text)}"</p>
        <div class="spotlight-person">
          ${avatarHTML(s.name, "sm")}
          <div>
            <span class="fname">${escapeHTML(s.name)}</span>
            <span class="ftime">${ratingBarsHTML(s.rating)} · ${timeAgo(s.time)}</span>
          </div>
        </div>
      </div>`).join("");
    fitAllSpotlightQuotes(track);

    dotsWrap.innerHTML = items.map((_, i) => `<button type="button" class="spotlight-dot" data-index="${i}" aria-label="Show voice ${i + 1}"></button>`).join("");

    showSpotlightSlide(0);
    startSpotlightAuto();
  }

  function setupSpotlightChrome() {
    const card = document.getElementById("spotlightCard");

    const quotemark = card.querySelector(".spotlight-quotemark");
    if (quotemark && !card.querySelector(".spotlight-eq")) {
      quotemark.insertAdjacentHTML("afterend", `<span class="spotlight-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>`);
    }

    if (!card.querySelector(".spotlight-empty")) {
      const empty = document.createElement("p");
      empty.className = "spotlight-empty";
      empty.textContent = "Nobody's been featured yet — leave a great review and yours could be the first voice spotlighted here.";
      card.insertBefore(empty, card.querySelector(".spotlight-controls"));
    }

    if (!card.querySelector(".spotlight-progress__fill")) {
      const progress = document.createElement("div");
      progress.className = "spotlight-progress";
      progress.innerHTML = `<div class="spotlight-progress__fill"></div>`;
      card.appendChild(progress);
    }
    spotlightProgressFill = card.querySelector(".spotlight-progress__fill");

    document.getElementById("spotlightPrev").addEventListener("click", () => { showSpotlightSlide(spotlightActive - 1); startSpotlightAuto(); });
    document.getElementById("spotlightNext").addEventListener("click", () => { showSpotlightSlide(spotlightActive + 1); startSpotlightAuto(); });
    document.getElementById("spotlightDots").addEventListener("click", (e) => {
      const btn = e.target.closest(".spotlight-dot");
      if (!btn) return;
      showSpotlightSlide(Number(btn.dataset.index));
      startSpotlightAuto();
    });

    card.addEventListener("mouseenter", stopSpotlightAuto);
    card.addEventListener("mouseleave", startSpotlightAuto);
    window.addEventListener("resize", () => fitAllSpotlightQuotes(document.getElementById("spotlightTrack")));
  }

  /* =========================================================
     5. RENDER: PULSE TICKER (derived from real recent activity)
  ========================================================= */
  function computeTickerItems() {
    const events = [];
    feedbackData.forEach((f) => {
      events.push({ time: f.time, icon: "★".repeat(f.rating), text: `${f.name} rated`, strong: `${f.rating}/5` });
      f.replies.forEach((r) => events.push({ time: r.time, icon: "💬", text: `${r.name} replied to`, strong: `${f.name}'s feedback` }));
    });
    events.sort((a, b) => b.time - a.time);
    return events.slice(0, 14);
  }

  function renderMarquee() {
    const pulseSection = document.getElementById("pulse");
    const track = document.getElementById("marqueeTrack");
    const items = computeTickerItems();

    if (!items.length) {
      pulseSection.classList.add("hidden");
      track.innerHTML = "";
      return;
    }
    pulseSection.classList.remove("hidden");
    const chipHTML = (item) => `<div class="pulse-chip"><span class="pc-icon">${item.icon}</span> ${escapeHTML(item.text)} <strong>${escapeHTML(item.strong)}</strong></div>`;
    const html = items.map(chipHTML).join("");
    track.innerHTML = html + html; // duplicated for a seamless loop
  }

  /* =========================================================
     6. REALTIME (SSE) — live updates for every connected visitor
  ========================================================= */
  function initRealtime() {
    if (!("EventSource" in window)) return;
    const es = new EventSource("/api/events");

    es.addEventListener("feedback:new", (e) => {
      const item = JSON.parse(e.data);
      if (feedbackData.some((f) => f.id === item.id)) return;
      feedbackData.unshift(item);
      renderFeed();
      renderSpotlight();
      renderMarquee();

      if (item.id === lastSubmittedId) {
        requestAnimationFrame(() => {
          const cardEl = feedList.querySelector(`[data-id="${item.id}"]`);
          if (cardEl) {
            cardEl.style.borderColor = "var(--signal)";
            setTimeout(() => (cardEl.style.borderColor = ""), 1400);
          }
        });
      } else {
        showToast(`${item.name} just added feedback to the wall.`);
      }
    });

    es.addEventListener("feedback:like", (e) => {
      const { feedbackId, likes } = JSON.parse(e.data);
      const item = feedbackData.find((f) => f.id === feedbackId);
      if (item) item.likes = likes;
      const cardEl = feedList.querySelector(`[data-id="${feedbackId}"] .like-btn .count`);
      if (cardEl) cardEl.textContent = likes;
    });

    es.addEventListener("feedback:reply", (e) => {
      const { feedbackId, reply } = JSON.parse(e.data);
      const item = feedbackData.find((f) => f.id === feedbackId);
      if (!item || item.replies.some((r) => r.id === reply.id)) return;
      item.replies.push(reply);
      renderFeed();
      renderMarquee();
    });

    es.addEventListener("feedback:delete", (e) => {
      const { feedbackId } = JSON.parse(e.data);
      feedbackData = feedbackData.filter((f) => f.id !== feedbackId);
      renderFeed();
      renderSpotlight();
      renderMarquee();
    });

    es.addEventListener("feedback:reply:delete", (e) => {
      const { feedbackId, replyId } = JSON.parse(e.data);
      const item = feedbackData.find((f) => f.id === feedbackId);
      if (!item) return;
      item.replies = item.replies.filter((r) => r.id !== replyId);
      renderFeed();
      renderMarquee();
    });
    // EventSource auto-reconnects on drop; nothing else to do here.
  }

  async function loadFeedback() {
    try {
      const res = await fetch("/api/feedback");
      feedbackData = await res.json();
    } catch (err) {
      feedbackData = [];
      showToast("Couldn't load the wall — check your connection.");
    }
    renderFeed();
    renderSpotlight();
    renderMarquee();
  }

  async function loadPublicStats() {
    try {
      const res = await fetch("/api/feedback/stats");
      const stats = await res.json();
      const dds = document.querySelectorAll(".stats dd");
      if (dds[0]) dds[0].dataset.countTo = stats.total;
      const avgSpan = dds[1] ? dds[1].querySelector("[data-count-to]") : null;
      if (avgSpan) avgSpan.dataset.countTo = stats.avgRating;
      if (dds[2]) dds[2].dataset.countTo = stats.repliesToday;
    } catch (err) {
      // leave the markup's own defaults in place — non-critical
    }
  }

  /* =========================================================
     7. SHOWPIECE LAYER (unchanged visual system)
  ========================================================= */
  const themeToggle = document.getElementById("themeToggle");
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const isLight = root.getAttribute("data-theme") === "light";
    root.setAttribute("data-theme", isLight ? "dark" : "light");
    themeToggle.setAttribute("aria-pressed", String(!isLight));
    themeToggle.setAttribute("aria-label", isLight ? "Switch to light mode" : "Switch to dark mode");
  });

  const nav = document.getElementById("siteNav");
  window.addEventListener("scroll", () => { nav.classList.toggle("is-scrolled", window.scrollY > 8); }, { passive: true });

  if (isFinePointer && !prefersReducedMotion) {
    document.body.classList.add("cursor-ready");
    const dot = document.getElementById("cursorDot");
    const ring = document.getElementById("cursorRing");
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;
    window.addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY; });
    function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(loop);
    }
    loop();
    document.addEventListener("mouseover", (e) => { if (e.target.closest("a, button, input, textarea, .fcard")) ring.classList.add("is-hovering"); });
    document.addEventListener("mouseout", (e) => { if (e.target.closest("a, button, input, textarea, .fcard")) ring.classList.remove("is-hovering"); });
  }

  if (isFinePointer && !prefersReducedMotion) {
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        el.style.transform = `translate(${x * 0.22}px, ${y * 0.32}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  function attachTilt() {
    if (isMobile) return;
    document.querySelectorAll(".fcard").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty("--mx", `${((px + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${((py + 0.5) * 100).toFixed(1)}%`);
        if (isFinePointer && !prefersReducedMotion) {
          card.style.transform = `perspective(700px) rotateX(${-py * 5}deg) rotateY(${px * 5}deg) translateY(-2px)`;
        }
      });
      card.addEventListener("mouseleave", () => { card.style.transform = ""; });
    });
  }

  function attachGlassGlow(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 100;
      const my = ((e.clientY - r.top) / r.height) * 100;
      el.style.setProperty("--mx", `${mx.toFixed(1)}%`);
      el.style.setProperty("--my", `${my.toFixed(1)}%`);
    });
  }

  let revealObserver;
  function observeReveal() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll("[data-reveal], [data-reveal-card]").forEach((el) => el.classList.add("in-view"));
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) { entry.target.classList.add("in-view"); revealObserver.unobserve(entry.target); }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    }
    document.querySelectorAll("[data-reveal]:not(.in-view), [data-reveal-card]:not(.in-view)").forEach((el) => revealObserver.observe(el));
  }

  function splitHeroWords() {
    const el = document.getElementById("heroTitle");
    if (!el) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = el.innerHTML;
    let wordIndex = 0;

    // Track karne ke liye ki current text <em> tag ke andar hai ya nahi
    function wrapWords(node, isEm = false) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((piece) => {
            if (piece.trim() === "") {
              frag.appendChild(document.createTextNode(piece));
              return;
            }
            const span = document.createElement("span");
            span.className = "word";
            span.style.setProperty("--w", wordIndex++);
            span.style.display = "inline-block";
            span.style.willChange = "opacity, transform";

            // Agar word <em> tag ke andar hai, to gradient direct SPAN par lagao
            if (isEm) {
              span.style.fontStyle = "italic";
              span.style.background = "linear-gradient(100deg, var(--signal), var(--pulse) 65%)";
              span.style.webkitBackgroundClip = "text";
              span.style.backgroundClip = "text";
              span.style.webkitTextFillColor = "transparent";
              span.style.color = "transparent";
              span.style.webkitTransform = "translateZ(0)"; // Hardware acceleration for mobile
            }

            span.textContent = piece;
            frag.appendChild(span);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const checkEm = isEm || child.tagName.toLowerCase() === "em";
          if (checkEm) {
            child.style.fontStyle = "italic";
            child.style.display = "inline-block";
            // Parent em tag ka color remove kar rahe hain taki clash na ho
            child.style.background = "none";
            child.style.color = "inherit";
          }
          wrapWords(child, checkEm);
        }
      });
    }

    wrapWords(wrapper);
    el.innerHTML = wrapper.innerHTML;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add("in-view");

        // Mobile safety timer: 1 second baad force opacity 1
        setTimeout(() => {
          el.querySelectorAll(".word").forEach((w) => {
            w.style.opacity = "1";
            w.style.visibility = "visible";
          });
        }, 1000);
      });
    });
  }

  function initCountUp() {
    const targets = document.querySelectorAll("[data-count-to]");
    if (!targets.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const end = parseFloat(el.dataset.countTo);
        const decimals = parseInt(el.dataset.decimal || "0", 10);
        const duration = 1400;
        const start = performance.now();
        function tick(t) {
          const progress = Math.min((t - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const value = end * eased;
          el.textContent = decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString();
          if (progress < 1) requestAnimationFrame(tick);
          else el.textContent = decimals ? end.toFixed(decimals) : end.toLocaleString();
        }
        requestAnimationFrame(tick);
        obs.unobserve(el);
      });
    }, { threshold: 0.6 });
    targets.forEach((el) => obs.observe(el));
  }

  function initRipples() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.4;
      const ripple = document.createElement("span");
      ripple.className = "btn-ripple";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - r.left - size / 2}px`;
      ripple.style.top = `${e.clientY - r.top - size / 2}px`;
      btn.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  }

  function initBgOrbs() {
    if (prefersReducedMotion || isMobile) return;
    const layer = document.querySelector(".bg-layer");
    if (!layer) return;
    const colors = ["--signal", "--wave", "--pulse", "--violet"];
    for (let i = 0; i < 4; i++) {
      const orb = document.createElement("div");
      orb.className = "bg-orb";
      const size = 180 + Math.random() * 220;
      orb.style.width = orb.style.height = `${size}px`;
      orb.style.top = `${Math.random() * 90}%`;
      orb.style.left = `${Math.random() * 90}%`;
      orb.style.background = `radial-gradient(circle, var(${colors[i % colors.length]}), transparent 70%)`;
      orb.style.setProperty("--ox", `${(Math.random() - 0.5) * 120}px`);
      orb.style.setProperty("--oy", `${(Math.random() - 0.5) * 120}px`);
      orb.style.animationDuration = `${22 + Math.random() * 18}s`;
      orb.style.animationDelay = `-${Math.random() * 10}s`;
      layer.appendChild(orb);
    }
  }

  const BG_ICON_PATHS = [
    '<path d="M12 21s-7-4.5-9.5-9C1 8 2 4 6 4c2 0 3.5 1.3 6 4 2.5-2.7 4-4 6-4 4 0 5 4 3.5 8-2.5 4.5-9.5 9-9.5 9z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
    '<path d="M12 2.5l2.9 6.6 7.1.6-5.4 4.8 1.6 7-6.2-3.8-6.2 3.8 1.6-7-5.4-4.8 7.1-.6z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
    '<path d="M3 5h18v11H8l-5 4V5z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
    '<rect x="2" y="9" width="3" height="6" fill="currentColor"/><rect x="8" y="4" width="3" height="16" fill="currentColor"/><rect x="14" y="7" width="3" height="10" fill="currentColor"/><rect x="20" y="2" width="3" height="20" fill="currentColor"/>',
  ];
  function initBgIcons() {
    if (prefersReducedMotion || isMobile) return;
    const layer = document.querySelector(".bg-layer");
    if (!layer) return;
    for (let i = 0; i < 6; i++) {
      const icon = document.createElement("div");
      icon.className = "bg-icon";
      const size = 26 + Math.random() * 20;
      icon.style.width = icon.style.height = `${size}px`;
      const onLeft = i % 2 === 0;
      icon.style.left = onLeft ? `${Math.random() * 14}%` : `${86 - Math.random() * 14}%`;
      icon.style.top = `${8 + Math.random() * 84}%`;
      icon.style.setProperty("--ix", `${(Math.random() - 0.5) * 40}px`);
      icon.style.setProperty("--iy", `${(Math.random() - 0.5) * 40}px`);
      icon.style.setProperty("--ir", `${(Math.random() - 0.5) * 20}deg`);
      icon.style.animationDuration = `${14 + Math.random() * 10}s`;
      icon.style.animationDelay = `-${Math.random() * 8}s`;
      icon.innerHTML = `<svg viewBox="0 0 24 24">${BG_ICON_PATHS[i % BG_ICON_PATHS.length]}</svg>`;
      layer.appendChild(icon);
    }
  }

  function initSideSignals() {
    if (window.matchMedia("(max-width: 1180px)").matches) return;
    const layer = document.querySelector(".bg-layer");
    if (!layer) return;
    ["left", "right"].forEach((side) => {
      const bar = document.createElement("div");
      bar.className = `bg-sidebar bg-sidebar--${side}`;
      bar.innerHTML = `<span class="bg-sidebar__track"></span>`;
      layer.appendChild(bar);
    });
  }

  function initBgParallax() {
    if (!isFinePointer || prefersReducedMotion) return;
    const layer = document.querySelector(".bg-layer");
    if (!layer) return;
    let tx = 0, ty = 0, cx = 0, cy = 0;
    window.addEventListener("mousemove", (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 24;
      ty = (e.clientY / window.innerHeight - 0.5) * 24;
    });
    function loop() {
      cx += (tx - cx) * 0.05;
      cy += (ty - cy) * 0.05;
      layer.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      requestAnimationFrame(loop);
    }
    loop();
  }

  function initParticles() {
    const canvas = document.getElementById("particleField");
    if (!canvas || prefersReducedMotion || isMobile) return;
    const ctx = canvas.getContext("2d");
    let particles = [];
    let w, h;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      w = canvas.width = rect.width * devicePixelRatio;
      h = canvas.height = rect.height * devicePixelRatio;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      const count = Math.min(60, Math.floor((rect.width * rect.height) / 14000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25 * devicePixelRatio,
        vy: (Math.random() - 0.5) * 0.25 * devicePixelRatio,
        r: (Math.random() * 1.4 + 0.6) * devicePixelRatio,
      }));
    }

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#F2A73B";

    function frame() {
      ctx.clearRect(0, 0, w, h);
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 140 * devicePixelRatio;
          if (dist < maxDist) {
            ctx.strokeStyle = `rgba(242,167,59,${(1 - dist / maxDist) * 0.18})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.fillStyle = accent;
      particles.forEach((p) => {
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(frame);
  }

  // Secret shortcut: Ctrl+Shift+A opens the admin panel in a new tab.
  function initAdminShortcut() {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        window.open("/admin", "_blank");
      }
    });
  }

  /* =========================================================
     7b. FAVICON — same bar-mark logo as the nav, set on every page
  ========================================================= */
  function setFavicon() {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">' +
      '<stop offset="0" stop-color="#F2A73B"/><stop offset="1" stop-color="#FF6B5B"/>' +
      "</linearGradient></defs>" +
      '<rect x="2" y="14" width="3.6" height="8" rx="1.3" fill="url(#g)"/>' +
      '<rect x="7.8" y="9" width="3.6" height="13" rx="1.3" fill="url(#g)"/>' +
      '<rect x="13.6" y="5" width="3.6" height="17" rx="1.3" fill="url(#g)"/>' +
      '<rect x="19.4" y="1" width="3.6" height="21" rx="1.3" fill="url(#g)"/>' +
      "</svg>";
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }

  /* =========================================================
       7c. OPENING LOADER (Integrated 2026 Sequence)
    ========================================================= */
  function runOpeningLoader() {
    return new Promise((resolve) => {
      const loader = document.getElementById("siteLoader");
      const loaderText = document.getElementById("loader-text");

      if (!loader || !loaderText) {
        document.documentElement.classList.add("site-visible");
        resolve();
        return;
      }

      const buildSteps = [
        "INITIALIZING CORE...",
        "ASSEMBLING MODULES...",
        "RENDERING WALL...",
        "SYSTEM READY."
      ];

      let currentStep = 0;
      const textInterval = setInterval(() => {
        currentStep++;
        if (currentStep < buildSteps.length) {
          loaderText.textContent = buildSteps[currentStep];
        } else {
          clearInterval(textInterval);
        }
      }, 450);

      // Total buildup time: ~2 seconds
      setTimeout(() => {
        clearInterval(textInterval);
        loaderText.textContent = "WELCOME.";

        // Exact 600ms hold so user can easily read "WELCOME."
        setTimeout(() => {
          loader.classList.add("is-loaded");

          // Slight 150ms delay to smoothly float the website up into view
          setTimeout(() => {
            document.documentElement.classList.add("site-visible");
          }, 150);

          // Clean up DOM memory after fade-out completes
          setTimeout(() => {
            loader.remove();
            resolve();
          }, 1100);

        }, 600); // 600ms pause on "WELCOME."

      }, 2000);
    });
  }
  /* =========================================================
     8. INIT
  ========================================================= */
  async function boot() {
    setFavicon();

    // Safety timer: Never let a slow request freeze the screen indefinitely
    const loaderSafety = setTimeout(() => {
      const loader = document.getElementById("siteLoader");
      if (loader) {
        loader.classList.add("is-loaded");
        document.documentElement.classList.add("site-visible");
        setTimeout(() => loader.remove(), 800);
      }
    }, 6500);

    // Render static components
    document.getElementById("year").textContent = new Date().getFullYear();
    renderWaveform();
    initParticles();
    splitHeroWords();
    initRipples();
    initBgOrbs();
    initBgIcons();
    initSideSignals();
    initBgParallax();
    attachGlassGlow(".composer-card");
    attachGlassGlow(".spotlight-card");
    setupSpotlightChrome();
    initAdminShortcut();

    // Async data fetching (runs in the background while loader animates)
    await loadPublicStats();
    initCountUp();
    await loadFeedback();
    initRealtime();

    // Execute the smooth loader sequence and wait for it to finish gracefully
    await runOpeningLoader();
    clearTimeout(loaderSafety);
  }

  boot();

})();