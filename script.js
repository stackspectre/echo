/* ===========================================================================
   ECHO — feedback wall
   -----------------------------------------------------------------------
   Sections in this file:
     1. DATA LAYER        — swap for real API calls later
     2. HELPERS           — avatars, time, escaping
     3. RENDER ENGINE      — feed cards
     4. FEED INTERACTIONS  — rating picker, like, reply, sort, search, submit
     5. SHOWPIECE LAYER    — theme toggle, cursor, particles, marquee,
                              spotlight carousel, scroll-reveal, count-up,
                              magnetic buttons, card tilt, nav scroll state

   Nothing here talks to a server. Look for "HOOK:" comments — those are
   the spots meant for real backend logic later.
=========================================================================== */

(() => {
  "use strict";

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isFinePointer = window.matchMedia("(pointer: fine)").matches;

  /* =========================================================
     1. DATA LAYER
  ========================================================= */
  const AVATAR_GRADIENTS = [
    ["#F2A73B", "#FF6B5B"],
    ["#35C2A6", "#3B82C4"],
    ["#8C8CF2", "#5B6EFF"],
    ["#FF8A65", "#F2A73B"],
    ["#35C2A6", "#8CE0C0"],
    ["#5B6EFF", "#35C2A6"],
  ];

  const now = Date.now();
  const mins = (n) => n * 60 * 1000;
  const hours = (n) => n * 60 * mins(1);
  const days = (n) => n * 24 * hours(1);

  let feedbackData = [
    {
      id: "f5", name: "Riya Kapoor", email: "riya.kapoor@mail.com", rating: 5,
      text: "The redesign feels so much calmer to use. I didn't expect a dashboard to feel this considered — nothing fights for attention anymore.",
      time: now - mins(12), likes: 24, liked: false, replies: []
    },
    {
      id: "f4", name: "Arjun Mehta", email: "arjun.m@workmail.com", rating: 4,
      text: "Onboarding is much faster now, but I still lose my place when I switch tabs mid-setup. Would love state to persist across tabs.",
      time: now - hours(2), likes: 12, liked: false,
      replies: [{ id: "r1", name: "Team Echo", text: "Logging this — tab persistence is on our shortlist for next sprint. Thank you for the specifics!", time: now - hours(1) }]
    },
    {
      id: "f3", name: "Sana Iyer", email: "sana.iyer@studio.co", rating: 5,
      text: "Support replied in nine minutes on a Sunday. Nine minutes! And they actually fixed it instead of sending a help article.",
      time: now - hours(6), likes: 41, liked: false, replies: []
    },
    {
      id: "f2", name: "Devraj Singh", email: "devraj.singh@proton.me", rating: 3,
      text: "Solid core product, but pricing tiers are confusing — I genuinely couldn't tell what separates Pro from Team until I emailed sales.",
      time: now - days(1), likes: 8, liked: false,
      replies: [
        { id: "r2", name: "Priya N.", text: "Agree completely, the comparison table needs actual numbers, not just checkmarks.", time: now - hours(20) },
        { id: "r3", name: "Team Echo", text: "Fair callout. We're rebuilding the pricing page this month — will make the deltas explicit.", time: now - hours(18) },
      ]
    },
    {
      id: "f1", name: "Meera Nair", email: "meera.nair@gmail.com", rating: 5,
      text: "Migrated our whole team over from spreadsheets last week. Everyone actually opens it now instead of avoiding it, which is the real win.",
      time: now - days(3), likes: 33, liked: false, replies: []
    },
  ];

  const spotlightData = [
    { name: "Meera Nair", time: "3 days ago", rating: 5, quote: "Migrated our whole team over from spreadsheets last week. Everyone actually opens it now instead of avoiding it." },
    { name: "Sana Iyer", time: "6 hours ago", rating: 5, quote: "Support replied in nine minutes on a Sunday. And they actually fixed it instead of sending a help article." },
    { name: "Riya Kapoor", time: "12 minutes ago", rating: 5, quote: "The redesign feels so much calmer to use. Nothing fights for attention anymore." },
    { name: "Kabir Anand", time: "2 days ago", rating: 5, quote: "First feedback tool our team didn't have to be forced into using. It just fit how we already talked." },
  ];

  const pulseItems = [
    { icon: "★★★★★", text: "Priya just rated", strong: "5/5" },
    { icon: "💬", text: "Arjun replied to", strong: "a review" },
    { icon: "✦", text: "Sana", strong: "joined the wall" },
    { icon: "❤", text: "12 people liked", strong: "Meera's feedback" },
    { icon: "★★★★☆", text: "New voice from", strong: "Devraj" },
    { icon: "💬", text: "Team Echo replied to", strong: "pricing feedback" },
    { icon: "✦", text: "Kabir", strong: "just joined the wall" },
    { icon: "❤", text: "24 people liked", strong: "Riya's feedback" },
  ];

  let currentSort = "newest";
  let currentQuery = "";
  let selectedRating = 0;

  /* =========================================================
     2. HELPERS
  ========================================================= */
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

  /* =========================================================
     3. RENDER ENGINE
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
    const repliesHTML = item.replies.map(replyRowHTML).join("");
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
          <button type="button" class="action-btn like-btn${item.liked ? " is-liked" : ""}" data-action="like">
            <span class="burst" aria-hidden="true"></span>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 13S1.5 9.4 1.5 5.4C1.5 3.4 3 2 4.9 2c1.1 0 2.1.6 2.6 1.5C8 2.6 9 2 10.1 2 12 2 13.5 3.4 13.5 5.4c0 4-6 7.6-6 7.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            <span class="count">${item.likes}</span>
          </button>
          <button type="button" class="action-btn reply-btn" data-action="toggle-reply">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 3h11v7H6l-3 3V3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            Reply${item.replies.length ? ` (${item.replies.length})` : ""}
          </button>
        </div>

        <div class="reply-composer" data-role="reply-composer">
          <div>
            <textarea rows="1" placeholder="Write a reply…" data-role="reply-input"></textarea>
            <button type="button" class="btn btn--primary" data-action="submit-reply">Post</button>
          </div>
        </div>

        ${item.replies.length ? `<div class="replies">${repliesHTML}</div>` : ""}
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
    feedEmpty.classList.toggle("hidden", data.length > 0);
    feedList.classList.toggle("hidden", data.length === 0);
    observeReveal();
    attachTilt();
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
     4. FEED INTERACTIONS
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

  nameInput.addEventListener("input", () => {
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
  });

  const messageInput = document.getElementById("fMessage");
  const charCount = document.getElementById("charCount");
  messageInput.addEventListener("input", () => {
    const len = messageInput.value.length;
    charCount.textContent = String(len);
    const counter = charCount.parentElement;
    counter.classList.toggle("is-near-limit", len >= 260 && len < 300);
    counter.classList.toggle("is-full", len >= 300);
  });

  // HOOK: real submission would POST to your backend here.
  const composerForm = document.getElementById("composerForm");
  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const email = document.getElementById("fEmail").value.trim();
    const text = messageInput.value.trim();

    if (!name || !email || !text || !selectedRating) {
      showToast("Fill in your name, email, a rating, and a message.");
      return;
    }

    const newItem = { id: "f" + Date.now(), name, email, rating: selectedRating, text, time: Date.now(), likes: 0, liked: false, replies: [] };
    feedbackData.unshift(newItem);
    currentSort = "newest";
    updateSortPills("newest");
    renderFeed();

    composerForm.reset();
    setRating(0);
    charCount.textContent = "0";
    charCount.parentElement.classList.remove("is-near-limit", "is-full");
    avatarPreview.textContent = "?";
    avatarPreview.style.background = "";

    showToast("Your voice is on the wall.");
    document.getElementById("wall").scrollIntoView({ behavior: "smooth", block: "start" });

    requestAnimationFrame(() => {
      const card = feedList.querySelector(`[data-id="${newItem.id}"]`);
      if (card) {
        card.classList.add("in-view");
        card.style.borderColor = "var(--signal)";
        setTimeout(() => (card.style.borderColor = ""), 1400);
      }
    });
  });

  feedList.addEventListener("click", (e) => {
    const card = e.target.closest(".fcard");
    if (!card) return;
    const id = card.dataset.id;
    const item = feedbackData.find((f) => f.id === id);
    if (!item) return;

    const likeBtn = e.target.closest('[data-action="like"]');
    if (likeBtn) {
      item.liked = !item.liked;
      item.likes += item.liked ? 1 : -1;
      likeBtn.classList.toggle("is-liked", item.liked);
      likeBtn.querySelector(".count").textContent = item.likes;

      if (item.liked) {
        likeBtn.classList.add("is-pulsing");
        spawnBurst(likeBtn);
        setTimeout(() => likeBtn.classList.remove("is-pulsing"), 400);
      }
      return;
    }

    const replyBtn = e.target.closest('[data-action="toggle-reply"]');
    if (replyBtn) {
      const composer = card.querySelector('[data-role="reply-composer"]');
      const isOpen = composer.classList.toggle("is-open");
      replyBtn.classList.toggle("is-open", isOpen);
      if (isOpen) composer.querySelector("textarea").focus();
      return;
    }

    const submitReplyBtn = e.target.closest('[data-action="submit-reply"]');
    if (submitReplyBtn) {
      const textarea = card.querySelector('[data-role="reply-input"]');
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      item.replies.push({ id: "r" + Date.now(), name: "You", text, time: Date.now() });
      renderFeed();
      showToast("Reply posted.");
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
  const clearSearchBtn = document.getElementById("clearSearch");
  searchInput.addEventListener("input", () => { currentQuery = searchInput.value.trim(); renderFeed(); });
  clearSearchBtn.addEventListener("click", () => { searchInput.value = ""; currentQuery = ""; renderFeed(); searchInput.focus(); });

  let toastTimer = null;
  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  /* =========================================================
     5. SHOWPIECE LAYER
  ========================================================= */

  // --- theme toggle (session-only, no storage) --------------------------
  const themeToggle = document.getElementById("themeToggle");
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const isLight = root.getAttribute("data-theme") === "light";
    root.setAttribute("data-theme", isLight ? "dark" : "light");
    themeToggle.setAttribute("aria-pressed", String(!isLight));
    themeToggle.setAttribute("aria-label", isLight ? "Switch to light mode" : "Switch to dark mode");
  });

  // --- nav scroll state ---------------------------------------------------
  const nav = document.getElementById("siteNav");
  window.addEventListener("scroll", () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 8);
  }, { passive: true });

  // --- custom cursor (fine pointer only) -----------------------------------
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

    document.addEventListener("mouseover", (e) => {
      if (e.target.closest("a, button, input, textarea, .fcard")) ring.classList.add("is-hovering");
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest("a, button, input, textarea, .fcard")) ring.classList.remove("is-hovering");
    });
  }

  // --- magnetic buttons -----------------------------------------------------
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

  // --- 3D tilt on feed cards, plus cursor-tracking glass glow -----------------
  function attachTilt() {
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

  // --- cursor-tracking glass glow for composer + spotlight cards --------------
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

  // --- scroll reveal (IntersectionObserver) -----------------------------------
  let revealObserver;
  function observeReveal() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll("[data-reveal], [data-reveal-card]").forEach((el) => el.classList.add("in-view"));
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    }
    document.querySelectorAll("[data-reveal]:not(.in-view), [data-reveal-card]:not(.in-view)").forEach((el) => revealObserver.observe(el));
  }

  // --- hero title: split into words for staggered reveal -----------------------
  function splitHeroWords() {
    const el = document.getElementById("heroTitle");
    const html = el.innerHTML;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;

    let wordIndex = 0;
    function wrapWords(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((piece) => {
            if (piece.trim() === "") { frag.appendChild(document.createTextNode(piece)); return; }
            const span = document.createElement("span");
            span.className = "word";
            span.style.setProperty("--w", wordIndex++);
            span.textContent = piece;
            frag.appendChild(span);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          wrapWords(child);
        }
      });
    }
    wrapWords(wrapper);
    el.innerHTML = wrapper.innerHTML;

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in-view")));
  }

  // --- count-up stats on scroll into view ---------------------------------------
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

  // --- pulse marquee ----------------------------------------------------------------
  function renderMarquee() {
    const track = document.getElementById("marqueeTrack");
    const chipHTML = (item) => `<div class="pulse-chip"><span class="pc-icon">${item.icon}</span> ${item.text} <strong>${item.strong}</strong></div>`;
    const html = pulseItems.map(chipHTML).join("");
    track.innerHTML = html + html; // duplicate for seamless loop
  }

  // --- spotlight carousel -----------------------------------------------------------
  // --- keep spotlight quotes to exactly 2 lines, shrinking font-size if needed ---
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

  function initSpotlight() {
    const track = document.getElementById("spotlightTrack");
    const dotsWrap = document.getElementById("spotlightDots");
    let active = 0;
    let timer = null;

    track.innerHTML = spotlightData.map((s) => `
      <div class="spotlight-slide">
        <p class="spotlight-quote">"${escapeHTML(s.quote)}"</p>
        <div class="spotlight-person">
          ${avatarHTML(s.name, "sm")}
          <div>
            <span class="fname">${escapeHTML(s.name)}</span>
            <span class="ftime">${ratingBarsHTML(s.rating)} · ${s.time}</span>
          </div>
        </div>
      </div>`).join("");

    fitAllSpotlightQuotes(track);
    window.addEventListener("resize", () => fitAllSpotlightQuotes(track));

    dotsWrap.innerHTML = spotlightData.map((_, i) => `<button type="button" class="spotlight-dot" data-index="${i}" aria-label="Show voice ${i + 1}"></button>`).join("");

    const slides = [...track.querySelectorAll(".spotlight-slide")];
    const dots = [...dotsWrap.querySelectorAll(".spotlight-dot")];

    function show(index) {
      active = (index + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle("is-active", i === active));
      dots.forEach((d, i) => d.classList.toggle("is-active", i === active));
    }

    function startAuto() {
      if (prefersReducedMotion) return;
      stopAuto();
      timer = setInterval(() => show(active + 1), 5000);
    }
    function stopAuto() { if (timer) clearInterval(timer); }

    document.getElementById("spotlightPrev").addEventListener("click", () => { show(active - 1); startAuto(); });
    document.getElementById("spotlightNext").addEventListener("click", () => { show(active + 1); startAuto(); });
    dotsWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".spotlight-dot");
      if (!btn) return;
      show(Number(btn.dataset.index));
      startAuto();
    });

    const card = document.getElementById("spotlightCard");
    card.addEventListener("mouseenter", stopAuto);
    card.addEventListener("mouseleave", startAuto);

    show(0);
    startAuto();
  }

  // --- ambient particle field in hero (canvas) ---------------------------------------
  function initParticles() {
    const canvas = document.getElementById("particleField");
    if (!canvas || prefersReducedMotion) return;
    const ctx = canvas.getContext("2d");
    let particles = [];
    let w, h, mouseX = null, mouseY = null;

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

  // --- click ripple on every .btn ------------------------------------------------
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

  // --- extra ambient floating orbs, layered behind the drifting glows -----------
  function initBgOrbs() {
    if (prefersReducedMotion) return;
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

  // --- subtle mouse-parallax on the whole background layer ----------------------
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

  // --- footer credit: "by [dev mark]" appended after the small Echo logo -------
  // The dev-mark is a plain <img> placeholder — swap DEV_LOGO_SRC below for a real logo URL/data-URI.
  const DEV_LOGO_SRC = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  function initFooterCredit() {
    const logo = document.querySelector(".site-footer .nav__logo--small");
    if (!logo) return;
    const credit = document.createElement("span");
    credit.className = "footer-credit";
    credit.innerHTML = `by <span class="dev-mark"><img class="dev-mark-img" src="${DEV_LOGO_SRC}" alt="Developer logo"></span>`;
    logo.appendChild(credit);
  }

  /* =========================================================
     INIT
  ========================================================= */
  document.getElementById("year").textContent = new Date().getFullYear();
  renderWaveform();
  renderFeed();
  renderMarquee();
  initSpotlight();
  initParticles();
  initCountUp();
  splitHeroWords();
  observeReveal();
  initRipples();
  initBgOrbs();
  initBgParallax();
  attachGlassGlow(".composer-card");
  attachGlassGlow(".spotlight-card");
  initFooterCredit();
})();