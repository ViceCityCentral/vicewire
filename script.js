/* ==========================================================================
   GTA VI · Vice City Countdown — behaviour
   1) Config  2) Date  3) Countdown  4) Quotes  5) Music player  6) Map viewer
   7) Scroll reveal  8) Boot
   ========================================================================== */
(function () {
  "use strict";

  // Lets the stylesheet keep the reveal animation off for visitors without JS.
  document.documentElement.classList.add("js");

  /* 1) Config ------------------------------------------------------------
     Everything you may want to tweak lives here. */
  const CONFIG = {
    // Official GTA VI release date (interpreted in the visitor's local time).
    releaseDate: new Date("2026-11-19T00:00:00"),

    // Random famous-person (stoic) quote endpoint requested for this site.
    quoteApi: "https://stoic.tekloon.net/stoic-quote",

    /* That API sends no `Access-Control-Allow-Origin` header, so a browser
       cannot call it directly from another origin — the request is blocked by
       CORS before the response can be read. To keep the site working as a
       plain static page the call is retried through read-only CORS proxies.
       The direct call is always tried first, so no third party is used if the
       API ever enables CORS or if you put your own proxy in front of it.
       Set this array to [] to disable the fallbacks. */
    corsProxies: [
      (url) => "https://r.jina.ai/" + url,
      (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
      (url) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url)
    ],

    // Per-request timeouts (ms).
    directTimeout: 6000,
    proxyTimeout: 12000,

    // Fade duration between two quotes (must match the CSS 0.4s).
    fadeMs: 400,

    /* Officially released GTA VI music, streamed by SoundCloud's own player
       from the rights holders' own upload. No audio file is bundled,
       downloaded, extracted or re-uploaded: the widget streams the track and
       this page only sends it play/pause/volume commands through SoundCloud's
       Widget API. The card is audio only — no video frame, no artwork.

       "Flower In A Hurricane" — Justice featuring Tame Impala, SZA and King
       Gizzard & the Lizard Wizard — is the first single from the game
       (Ed Banger / Because / Take-Two, released 15 October 2026) and the embed
       is Justice's own upload. index.html points its iframe at the same track.

       Swap trackUrl/title for another official upload and the play/pause
       button, the volume slider and the live title all follow. */
    music: {
      trackUrl: "https://soundcloud.com/justice-official/flower-in-a-hurricane-feat",
      widgetApi: "https://w.soundcloud.com/player/api.js",
      title: "Flower In A Hurricane — Justice",
      volume: 45   // 0-100, and the volume slider's starting position
    }
  };

  // ?date=YYYY-MM-DD overrides the release date — handy for previewing the
  // "GTA VI IS HERE!" state without waiting for launch day.
  const override = new URLSearchParams(window.location.search).get("date");
  if (override) {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) CONFIG.releaseDate = parsed;
  }

  const $ = (id) => document.getElementById(id);

  /* 2) Current date (upper-right corner) --------------------------------- */
  function renderToday() {
    const el = $("dateValue");
    if (!el) return;

    const now = new Date();
    el.textContent = now.toLocaleDateString("en-GB", {   // "14 November 2026"
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    el.dateTime = now.toISOString().slice(0, 10);
  }

  /* 3) Countdown --------------------------------------------------------- */
  const pad = (n) => String(n).padStart(2, "0");
  let countdownTimer = null;

  function setText(id, value) {
    const el = $(id);
    if (el && el.textContent !== value) el.textContent = value;
  }

  function renderCountdown() {
    const timer = $("countdownTimer");
    const here = $("hereMessage");
    const releaseLabel = $("releaseLabel");
    if (!timer || !here || !here.hidden) return;   // already in "is here" mode

    const diff = CONFIG.releaseDate.getTime() - Date.now();

    if (diff <= 0) {
      // Release reached: replace the timer with the celebration message.
      timer.hidden = true;
      if (releaseLabel) releaseLabel.hidden = true;
      here.hidden = false;
      clearInterval(countdownTimer);
      return;
    }

    const total = Math.floor(diff / 1000);
    // Days are only padded up to two digits so "365" still reads correctly.
    const days = Math.floor(total / 86400);
    setText("unitDays", days < 100 ? pad(days) : String(days));
    setText("unitHours", pad(Math.floor((total % 86400) / 3600)));
    setText("unitMinutes", pad(Math.floor((total % 3600) / 60)));
    setText("unitSeconds", pad(total % 60));
  }

  function describeRelease() {
    const formatted = CONFIG.releaseDate.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric"
    });

    const el = $("releaseLabel");
    if (el) el.textContent = "Releases " + formatted;

    // Keep the banner date in sync with the countdown's single source of truth.
    const heroDate = $("heroDate");
    if (heroDate) heroDate.textContent = formatted;
  }

  /* 4) Quotes ------------------------------------------------------------ */
  // Small offline set, used only if every network source fails.
  const FALLBACK_QUOTES = [
    { quote: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
    { quote: "We suffer more often in imagination than in reality.", author: "Seneca" },
    { quote: "It is not what happens to you, but how you react to it that matters.", author: "Epictetus" },
    { quote: "Waste no more time arguing what a good man should be. Be one.", author: "Marcus Aurelius" },
    { quote: "Luck is what happens when preparation meets opportunity.", author: "Seneca" }
  ];

  const errorBox = () => $("quoteError");
  const quoteCard = () => document.querySelector(".quote-card");
  const newQuoteBtn = () => $("newQuoteBtn");

  let isLoadingQuote = false;

  function showError(message) {
    const box = errorBox();
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  function clearError() {
    const box = errorBox();
    if (box) box.hidden = true;
  }

  /** Fade the card out, swap the text, fade back in. */
  function applyQuote(text, author) {
    const card = quoteCard();
    const textEl = $("quoteText");
    const authorEl = $("quoteAuthor");
    if (!textEl || !authorEl) return;

    const swap = () => {
      textEl.textContent = text;
      authorEl.textContent = author;
      if (card) card.classList.remove("is-fading");
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (card && !reduced) {
      card.classList.add("is-fading");
      window.setTimeout(swap, CONFIG.fadeMs);
    } else {
      swap();
    }
  }

  /** Pull { quote, author } out of either raw JSON or a proxy's wrapped text. */
  function parseQuotePayload(raw) {
    if (!raw) return null;

    const text = String(raw).trim();
    const candidates = [text];
    const braces = text.match(/\{[\s\S]*\}/);   // covers proxies that wrap the JSON
    if (braces) candidates.push(braces[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (data && typeof data.quote === "string" && data.quote.trim()) {
          const author =
            typeof data.author === "string" && data.author.trim()
              ? data.author.trim()
              : "Unknown";
          return { quote: data.quote.trim(), author };
        }
      } catch (_) {
        /* not this one — try the next candidate */
      }
    }
    return null;
  }

  function fetchWithTimeout(url, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);

    return fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then((body) => {
        const result = parseQuotePayload(body);
        if (!result) throw new Error("Unusable response");
        return result;
      })
      .finally(() => window.clearTimeout(timer));
  }

  async function getQuote() {
    // 1. Direct call — no third party involved.
    try {
      return await fetchWithTimeout(CONFIG.quoteApi, CONFIG.directTimeout);
    } catch (err) {
      console.warn("[GTA VI countdown] direct quote request failed, trying proxies:", err.message);
    }

    // 2. Race the CORS proxies and take whichever answers first.
    if (!CONFIG.corsProxies.length) throw new Error("No fallback sources configured");

    const attempts = CONFIG.corsProxies.map((build) =>
      fetchWithTimeout(build(CONFIG.quoteApi), CONFIG.proxyTimeout)
    );

    return await Promise.any(attempts);   // rejects with AggregateError if all fail
  }

  async function fetchQuote() {
    if (isLoadingQuote) return;
    isLoadingQuote = true;

    const btn = newQuoteBtn();
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-spinning");
    }
    clearError();

    try {
      const { quote, author } = await getQuote();
      applyQuote(quote, author);
    } catch (err) {
      console.error("[GTA VI countdown] every quote source failed:", err);
      const fallback = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
      applyQuote(fallback.quote, fallback.author);
      showError(
        "Couldn't reach the live quote service, so here's one from our shelf. " +
        "Check your connection and tap the diamond to try again."
      );
    } finally {
      isLoadingQuote = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-spinning");
      }
    }
  }

  /* 5) Official music player (audio only) --------------------------------
     The track is streamed by SoundCloud's own player and this card only drives
     it, through the SoundCloud Widget API: the visitor's play/pause button and
     volume slider mirror the widget's real state, and the card stays audio
     only — no video frame and no artwork anywhere. Nothing is downloaded or
     re-hosted. */
  function initMusicPlayer() {
    const player = $("musicPlayer");
    const frame = $("musicFrame");
    const toggle = $("musicToggle");
    const volume = $("musicVolume");
    const error = $("musicError");
    const title = $("musicTitle");
    if (!player || !frame || !toggle) return;

    let widget = null;
    let ready = false;
    let apiBroken = false;
    let playWhenReady = false;
    // The volume the visitor wants, 0-100. Applied as soon as the widget is up.
    let wantedVolume = Math.min(100, Math.max(0, CONFIG.music.volume));

    if (volume) volume.value = String(wantedVolume / 100);

    function setPlaying(isPlaying) {
      player.classList.toggle("is-playing", isPlaying);
      toggle.setAttribute("aria-pressed", String(isPlaying));
      toggle.setAttribute("aria-label", (isPlaying ? "Pause" : "Play") + " official GTA VI music");
    }

    function showMusicError() {
      player.classList.add("has-error");
      if (error) error.hidden = false;
    }

    function clearMusicError() {
      player.classList.remove("has-error");
      if (error) error.hidden = true;
    }

    function onReady() {
      ready = true;
      widget.setVolume(wantedVolume);

      // Show the widget's real track title, with the configured one as the
      // fallback. [From GTAVI: Original Score] style suffixes are dropped.
      widget.getCurrentSound(function (sound) {
        if (!sound || !title || typeof sound.title !== "string") return;
        const live = sound.title.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
        if (live) {
          title.textContent = live;
          title.title = sound.title;
        }
      });

      if (playWhenReady) {   // the visitor clicked before the widget was ready
        playWhenReady = false;
        widget.play();
      }
    }

    function buildWidget() {
      if (widget || apiBroken) return;
      const SC = window.SC;
      if (!SC || !SC.Widget) {
        showMusicError();
        return;
      }
      widget = SC.Widget(frame);
      widget.bind(SC.Widget.Events.READY, onReady);
      widget.bind(SC.Widget.Events.PLAY, function () {
        setPlaying(true);
        clearMusicError();
      });
      widget.bind(SC.Widget.Events.PAUSE, function () { setPlaying(false); });
      widget.bind(SC.Widget.Events.FINISH, function () { setPlaying(false); });
      widget.bind(SC.Widget.Events.ERROR, function () {
        playWhenReady = false;
        setPlaying(false);
        showMusicError();
      });
    }

    // SoundCloud's widget API, loaded once and reused.
    function loadWidgetApi() {
      if (window.SC && window.SC.Widget) {
        buildWidget();
        return;
      }
      if (apiBroken) {
        showMusicError();
        return;
      }
      if (document.getElementById("scWidgetApi")) return;   // already loading

      const script = document.createElement("script");
      script.id = "scWidgetApi";
      script.src = CONFIG.music.widgetApi;
      script.onload = buildWidget;
      script.onerror = function () {
        apiBroken = true;
        showMusicError();
      };
      document.head.appendChild(script);
    }

    // Playback never starts on its own: only a click on the pink button does.
    function togglePlayback() {
      clearMusicError();
      if (!widget || !ready) {
        playWhenReady = true;
        loadWidgetApi();
        return;
      }
      widget.toggle();   // the widget's own events keep the button in sync
    }

    toggle.addEventListener("click", togglePlayback);

    if (volume) {
      volume.addEventListener("input", function () {
        wantedVolume = Math.round(Math.min(1, Math.max(0, Number(volume.value) || 0)) * 100);
        if (widget && ready) widget.setVolume(wantedVolume);
      });
    }

    setPlaying(false);
    if (title && CONFIG.music.title) title.textContent = CONFIG.music.title;
    loadWidgetApi();
  }

  /* 6) Explore Leonida — map viewer ---------------------------------------
     Zoom, pan and fullscreen for the static Collector's Edition map. The
     picture is a local image, so no map service is contacted and nothing about
     the geography is invented here. */
  function initMapViewer() {
    const shell = $("mapShell");
    const viewport = $("mapViewport");
    const image = $("mapImage");
    const empty = $("mapEmpty");
    const fullBtn = $("mapFull");
    if (!shell || !viewport || !image) return;

    const MIN = 1;      // "fit the frame"
    const MAX = 5;
    const BUTTON_STEP = 0.6;
    const WHEEL_STEP = 1.12;
    const TAP_SLOP = 6; // px of movement still counted as a tap

    let scale = MIN;
    let x = 0;          // pan offset in px, measured from the centred position
    let y = 0;
    let active = false; // the visitor has used the map: pinching no longer pans the page

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    // The furthest the image may slide before its own edge would show.
    function limits() {
      const cw = viewport.clientWidth;
      const ch = viewport.clientHeight;
      const nw = image.naturalWidth || 1;
      const nh = image.naturalHeight || 1;
      const fit = Math.min(cw / nw, ch / nh);   // object-fit: contain
      return {
        maxX: Math.max(0, (nw * fit * scale - cw) / 2),
        maxY: Math.max(0, (nh * fit * scale - ch) / 2)
      };
    }

    function render() {
      const l = limits();
      x = clamp(x, -l.maxX, l.maxX);
      y = clamp(y, -l.maxY, l.maxY);
      image.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) scale(" + scale.toFixed(3) + ")";
    }

    function activate() { active = true; }

    // Zooms to `next` while keeping the viewport point (fx, fy) — measured from
    // the centre — under the same spot on the map.
    function zoomTo(next, fx, fy) {
      const target = clamp(next, MIN, MAX);
      if (Math.abs(target - scale) < 0.0001) return;
      const cx = fx || 0;
      const cy = fy || 0;
      const ratio = target / scale;
      x = cx - (cx - x) * ratio;
      y = cy - (cy - y) * ratio;
      scale = target;
      if (scale <= MIN + 0.001) { x = 0; y = 0; }
      render();
    }

    function zoomFrom(event, next) {
      const rect = viewport.getBoundingClientRect();
      zoomTo(next, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    }

    function reset() {
      scale = MIN;
      x = 0;
      y = 0;
      render();
    }

    // Toolbar --------------------------------------------------------------
    const zoomIn = $("mapZoomIn");
    const zoomOut = $("mapZoomOut");
    const resetBtn = $("mapReset");

    if (zoomIn) zoomIn.addEventListener("click", function () { activate(); zoomTo(scale * (1 + BUTTON_STEP)); });
    if (zoomOut) zoomOut.addEventListener("click", function () { activate(); zoomTo(scale / (1 + BUTTON_STEP)); });
    if (resetBtn) resetBtn.addEventListener("click", function () { activate(); reset(); });

    // Fullscreen -----------------------------------------------------------
    const fsSupported = !!(shell.requestFullscreen || shell.webkitRequestFullscreen);
    if (fullBtn && !fsSupported) fullBtn.hidden = true;

    function isFullscreen() {
      return document.fullscreenElement === shell || document.webkitFullscreenElement === shell;
    }

    function syncFullscreenButton() {
      if (!fullBtn) return;
      const on = isFullscreen();
      fullBtn.setAttribute("aria-pressed", String(on));
      fullBtn.textContent = on ? "Exit fullscreen" : "Fullscreen";
      render();   // the frame just changed size
    }

    if (fullBtn) {
      fullBtn.addEventListener("click", function () {
        if (isFullscreen()) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else if (shell.requestFullscreen) {
          const req = shell.requestFullscreen();
          if (req && req.catch) req.catch(function () {});   // refused: stay inline
        } else if (shell.webkitRequestFullscreen) {
          shell.webkitRequestFullscreen();
        }
      });
      ["fullscreenchange", "webkitfullscreenchange"].forEach(function (name) {
        document.addEventListener(name, syncFullscreenButton);
      });
    }

    // Wheel zoom. At rest, scrolling down still scrolls the page; once the map
    // is zoomed, the wheel belongs to the map until it is back at fit.
    viewport.addEventListener("wheel", function (event) {
      const zoomingIn = event.deltaY < 0;
      if (scale <= MIN + 0.001 && !zoomingIn) return;
      event.preventDefault();
      activate();
      zoomFrom(event, zoomingIn ? scale * WHEEL_STEP : scale / WHEEL_STEP);
    }, { passive: false });

    // Double-click is the mouse's zoom gesture (a touch double-tap would fire it
    // too, but touch has its own tap handling below).
    viewport.addEventListener("dblclick", function (event) {
      if (lastPointerType === "touch") return;
      event.preventDefault();
      activate();
      zoomFrom(event, scale <= MIN + 0.001 ? scale * (1 + BUTTON_STEP) : MIN);
    });

    // Drag and pinch -------------------------------------------------------
    // One pointer pans, two pointers pinch; a tap on the fitted map zooms in.
    const pointers = new Map();
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let moved = 0;
    let pinchStart = null;
    let lastPointerType = "mouse";
    let lastTouchY = 0;

    function pointerList() {
      return Array.from(pointers.values());
    }

    function distanceBetween(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function midpointBetween(a, b, rect) {
      return {
        x: (a.x + b.x) / 2 - rect.left - rect.width / 2,
        y: (a.y + b.y) / 2 - rect.top - rect.height / 2
      };
    }

    viewport.addEventListener("pointerdown", function (event) {
      if (pointers.size >= 2) return;
      activate();
      lastPointerType = event.pointerType || "mouse";
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (viewport.setPointerCapture) {
        try { viewport.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
      }

      const all = pointerList();
      if (all.length === 1) {
        dragging = true;
        moved = 0;
        startX = event.clientX;
        startY = event.clientY;
        startPanX = x;
        startPanY = y;
        lastTouchY = event.clientY;
      } else if (all.length === 2) {
        const rect = viewport.getBoundingClientRect();
        const mid = midpointBetween(all[0], all[1], rect);
        const dist = distanceBetween(all[0], all[1]) || 1;
        // Remember the map point under the pinch midpoint so it stays put.
        pinchStart = {
          scale: scale,
          dist: dist,
          point: { x: (mid.x - x) / scale, y: (mid.y - y) / scale }
        };
        dragging = false;
      }
    });

    viewport.addEventListener("pointermove", function (event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const all = pointerList();
      const rect = viewport.getBoundingClientRect();

      if (all.length === 1 && dragging) {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));

        if (scale > MIN + 0.001) {
          x = startPanX + dx;
          y = startPanY + dy;
          viewport.classList.add("is-dragging");
          render();
        } else if (event.pointerType !== "mouse") {
          // Nothing to pan yet, so a finger swipe over the map scrolls the page
          // instead of doing nothing (the frame swallows touch gestures).
          const step = event.clientY - lastTouchY;
          lastTouchY = event.clientY;
          if (step) window.scrollBy(0, -step);
        }
        return;
      }

      if (all.length === 2 && pinchStart) {
        const mid = midpointBetween(all[0], all[1], rect);
        const dist = distanceBetween(all[0], all[1]) || 1;
        const next = clamp(pinchStart.scale * (dist / pinchStart.dist), MIN, MAX);
        scale = next;
        x = mid.x - pinchStart.point.x * next;
        y = mid.y - pinchStart.point.y * next;
        moved = TAP_SLOP + 1;   // a pinch is never a tap
        viewport.classList.add("is-dragging");
        render();
      }
    });

    function endPointer(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      const all = pointerList();

      if (all.length === 1) {   // one finger left: pan again from where it is
        dragging = true;
        startX = all[0].x;
        startY = all[0].y;
        startPanX = x;
        startPanY = y;
        pinchStart = null;
        return;
      }

      if (all.length === 0) {
        dragging = false;
        pinchStart = null;
        viewport.classList.remove("is-dragging");
        // A tap on the fitted map zooms in — the touch equivalent of a
        // double-click, which is how a mouse zooms.
        if (moved <= TAP_SLOP && scale <= MIN + 0.001 && event.pointerType !== "mouse") {
          zoomTo(scale * (1 + BUTTON_STEP));
        }
      }
    }

    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);

    viewport.addEventListener("keydown", function (event) {
      const key = event.key;
      if (key === "+" || key === "=") { activate(); zoomTo(scale * (1 + BUTTON_STEP)); }
      else if (key === "-" || key === "_") { activate(); zoomTo(scale / (1 + BUTTON_STEP)); }
      else if (key === "0") { activate(); reset(); }
      else if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        activate();
        const step = 40;
        if (key === "ArrowLeft") x -= step;
        if (key === "ArrowRight") x += step;
        if (key === "ArrowUp") y -= step;
        if (key === "ArrowDown") y += step;
        render();
      } else {
        return;
      }
      event.preventDefault();
    });

    // A missing image says so instead of leaving an empty frame.
    image.addEventListener("error", function () {
      if (empty) empty.hidden = false;
    });
    image.addEventListener("load", function () {
      if (empty) empty.hidden = true;
      render();
    });

    window.addEventListener("resize", render);
    render();
  }

  /* 7) Scroll reveal ------------------------------------------------------ */
  // Adds .is-revealed to [data-reveal] elements the first time they come into
  // view. Without IntersectionObserver (or with no JS at all) the CSS keeps
  // them visible, so nothing is ever hidden forever.
  function initReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach(function (el) { el.classList.add("is-revealed"); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });

    targets.forEach(function (el) { observer.observe(el); });
  }

  /* 8) Boot -------------------------------------------------------------- */
  function init() {
    renderToday();
    describeRelease();
    renderCountdown();

    // Keep the header date fresh (a minute is plenty).
    window.setInterval(renderToday, 60000);

    const btn = newQuoteBtn();
    if (btn) btn.addEventListener("click", fetchQuote);

    initMusicPlayer();
    initMapViewer();
    initReveal();
    fetchQuote();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    countdownTimer = window.setInterval(renderCountdown, 1000);
  });
})();
