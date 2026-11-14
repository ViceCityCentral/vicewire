/* ==========================================================================
   GTA VI · Vice City Countdown — behaviour
   1) Config  2) Current date  3) Countdown  4) Quotes  5) Music player  6) Boot
   ========================================================================== */
(function () {
  "use strict";

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
    fadeMs: 400
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

  /* 5) Background music player ------------------------------------------- */
  function initMusicPlayer() {
    const player = $("musicPlayer");
    const audio = $("musicAudio");
    const toggle = $("musicToggle");
    const volume = $("musicVolume");
    const error = $("musicError");
    if (!player || !audio || !toggle) return;

    function clampVolume(value) {
      const v = Number(value);
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    }

    audio.loop = true;
    if (volume) audio.volume = clampVolume(volume.value);

    function setPlaying(isPlaying) {
      player.classList.toggle("is-playing", isPlaying);
      toggle.setAttribute("aria-pressed", String(isPlaying));
      toggle.setAttribute("aria-label", (isPlaying ? "Pause" : "Play") + " background music");
    }

    function showMusicError() {
      player.classList.add("has-error");
      if (error) error.hidden = false;
    }

    // Browsers block autoplay, so the track only ever starts from this click.
    function togglePlayback() {
      if (audio.paused) {
        const started = audio.play();
        if (started && typeof started.catch === "function") started.catch(showMusicError);
      } else {
        audio.pause();
      }
    }

    toggle.addEventListener("click", togglePlayback);

    audio.addEventListener("play", function () {
      setPlaying(true);
      player.classList.remove("has-error");
      if (error) error.hidden = true;
    });

    audio.addEventListener("pause", function () {
      setPlaying(false);
    });

    audio.addEventListener("error", showMusicError);

    if (volume) {
      volume.addEventListener("input", function () {
        audio.volume = clampVolume(volume.value);
      });
    }

    setPlaying(false);
  }

  /* 6) Boot -------------------------------------------------------------- */
  function init() {
    renderToday();
    describeRelease();
    renderCountdown();

    // Keep the header date fresh (a minute is plenty).
    window.setInterval(renderToday, 60000);

    const btn = newQuoteBtn();
    if (btn) btn.addEventListener("click", fetchQuote);

    initMusicPlayer();
    fetchQuote();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    countdownTimer = window.setInterval(renderCountdown, 1000);
  });
})();
