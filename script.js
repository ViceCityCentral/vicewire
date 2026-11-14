/* ==========================================================================
   GTA VI · Vice City Countdown — behaviour
   1) Config  2) Date  3) Countdown  4) Music player  5) Map viewer
   6) Scroll reveal  7) Boot
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

    /* Officially released GTA VI music, streamed by the rights holders' own
       official player, shown in full. No audio file is bundled, downloaded,
       extracted or re-uploaded: YouTube's own player streams the track, the
       page only sends it play/pause/volume commands through that player's API,
       and YouTube's controls, title and branding are left untouched.

       "Flower In A Hurricane" — Justice featuring Tame Impala, SZA and King
       Gizzard & the Lizard Wizard — is the first single from the game and this
       is the official upload. Change videoId/watchUrl/title for another official
       upload and the play/pause button, the volume slider and the title follow.

       There is no second audio source: if YouTube refuses to play, the card
       says so and links to the track's official page rather than streaming the
       song from anywhere else. */
    music: {
      videoId: "5dPwBWvmcbQ",
      iframeApi: "https://www.youtube.com/iframe_api",
      host: "https://www.youtube-nocookie.com",
      watchUrl: "https://www.youtube.com/watch?v=5dPwBWvmcbQ",
      title: "Flower In A Hurricane — Justice",
      volume: 45,           // 0-100, and the volume slider's starting position
      startTimeoutMs: 5000  // how long a play request may stay silent before we hint
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

  /* 4) Official music player ----------------------------------------------
     YouTube's own player, shown in full inside the card, streams the track.
     The visitor's pink play/pause button and volume slider drive that same
     player through YouTube's official IFrame Player API and mirror its real
     state; nothing is downloaded, extracted or re-hosted, and YouTube's
     controls, title and branding stay exactly as YouTube renders them. */
  function initMusicPlayer() {
    const player = $("musicPlayer");
    const stage = $("musicStage");
    const toggle = $("musicToggle");
    const volume = $("musicVolume");
    const error = $("musicError");
    const title = $("musicTitle");
    if (!player || !stage || !toggle) return;

    const MUSIC = CONFIG.music;
    let wantedVolume = Math.min(100, Math.max(0, MUSIC.volume));

    let yt = null;             // YouTube's player, once its API is up
    let ytReady = false;
    let ytFailed = false;

    let wantPlay = false;      // the visitor has asked for sound
    let playWhenReady = false; // play was pressed before the player was up
    let playing = false;       // last state reported by the live player
    let watchdog = 0;          // timer that reports a play request with no sound

    if (volume) volume.value = String(wantedVolume / 100);

    function setPlaying(isPlaying) {
      playing = isPlaying;
      player.classList.toggle("is-playing", isPlaying);
      toggle.setAttribute("aria-pressed", String(isPlaying));
      toggle.setAttribute("aria-label", (isPlaying ? "Pause" : "Play") + " official GTA VI music");
    }

    function showError(markup) {
      if (error) {
        error.innerHTML = markup || giveUpMarkup();
        error.hidden = false;
      }
      player.classList.add("has-error");
    }

    function clearError() {
      player.classList.remove("has-error");
      if (error) error.hidden = true;
    }

    // Only for the case where YouTube's own player will not run at all.
    function giveUpMarkup() {
      return "The official player can\u2019t start here right now \u2014 open the track on " +
        '<a class="player__external" href="' + MUSIC.watchUrl + '" target="_blank" rel="noopener noreferrer">YouTube</a>.';
    }

    // A play request that never turns into sound is nearly always the browser's
    // autoplay policy holding playback back, which one more click clears.
    function noteSilence() {
      if (!error) return;
      player.classList.add("has-error");
      error.textContent = "The music didn't start — press the pink button once more.";
      error.hidden = false;
    }

    function armWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(function () {
        if (!playing) noteSilence();
      }, MUSIC.startTimeoutMs);
    }

    // A source that reports PLAY and then stops on its own (a rights or region
    // refusal looks exactly like this) must not leave the card silent with no
    // explanation: say plainly that nothing can play here after all.
    function armResumeWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(function () {
        if (wantPlay && !playing) showError(giveUpMarkup());
      }, MUSIC.startTimeoutMs);
    }

    /* Play / pause --------------------------------------------------------- */
    function requestPlay() {
      clearError();
      wantPlay = true;
      if (!ytReady) {
        playWhenReady = true;
        loadYouTubeApi();
        return;
      }
      try {
        if (typeof yt.isMuted === "function" && yt.isMuted() && typeof yt.unMute === "function") yt.unMute();
        yt.setVolume(wantedVolume);
        yt.playVideo();
        armWatchdog();
      } catch (err) {
        failOver();
      }
    }

    function requestPause() {
      wantPlay = false;
      clearTimeout(watchdog);
      if (!ytReady) return;
      try { yt.pauseVideo(); } catch (err) { /* the player is gone */ }
    }

    function togglePlayback() {
      if (playing) requestPause();
      else requestPlay();
    }

    toggle.addEventListener("click", togglePlayback);

    if (volume) {
      volume.addEventListener("input", function () {
        wantedVolume = Math.round(Math.min(1, Math.max(0, Number(volume.value) || 0)) * 100);
        if (!ytReady) return;
        try { yt.setVolume(wantedVolume); } catch (err) { /* nothing to set */ }
      });
    }

    /* YouTube's own player -------------------------------------------------- */
    function loadYouTubeApi() {
      if (yt || ytFailed) return;
      if (window.YT && window.YT.Player) {
        buildYouTubePlayer();
        return;
      }
      if (document.getElementById("ytIframeApi")) return;   // already loading

      // The API calls this global once it is ready.
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previous === "function") previous();
        buildYouTubePlayer();
      };

      const script = document.createElement("script");
      script.id = "ytIframeApi";
      script.src = MUSIC.iframeApi;
      script.onerror = function () { failOver(); };
      document.head.appendChild(script);
    }

    function buildYouTubePlayer() {
      if (yt || ytFailed || !window.YT || !window.YT.Player) {
        if (!window.YT || !window.YT.Player) failOver();
        return;
      }
      yt = new window.YT.Player(stage.id, {
        videoId: MUSIC.videoId,
        host: MUSIC.host,
        playerVars: {
          origin: window.location.origin,
          playsinline: 1,
          // YouTube's own controls stay on screen and usable: this page never
          // hides, restyles or disables the player it embeds.
          controls: 1,
          rel: 0
        },
        events: {
          onReady: onYouTubeReady,
          onStateChange: onYouTubeState,
          onError: function () { failOver(); }
        }
      });
    }

    function onYouTubeReady() {
      ytReady = true;
      try {
        // YouTube's generated iframe carries no accessible name of its own.
        const frame = typeof yt.getIframe === "function" ? yt.getIframe() : null;
        if (frame && !frame.getAttribute("title")) {
          frame.setAttribute("title", MUSIC.title + " — official YouTube player");
        }
      } catch (err) { /* there is no iframe to name yet */ }
      try {
        yt.setVolume(wantedVolume);
        // Show the official upload's own title when the player offers it.
        const data = typeof yt.getVideoData === "function" ? yt.getVideoData() : null;
        if (title && data && typeof data.title === "string" && data.title.trim()) {
          title.textContent = data.title.trim();
          title.title = data.title.trim();
        }
      } catch (err) { /* the player has no volume or title yet */ }

      if (playWhenReady) {
        playWhenReady = false;
        requestPlay();
      }
    }

    function onYouTubeState(event) {
      const S = window.YT && window.YT.PlayerState;
      if (!S) return;
      clearTimeout(watchdog);
      if (event.data === S.PLAYING) {
        clearError();
        setPlaying(true);
      } else if (event.data === S.PAUSED) {
        setPlaying(false);
        armResumeWatchdog();
      } else if (event.data === S.ENDED) {
        wantPlay = false;
        setPlaying(false);
      }
    }

    /* Giving up ------------------------------------------------------------- */
    // YouTube's player refused to run. Rather than stream the song from
    // somewhere else, the card says so and links to the track's official page.
    function failOver() {
      clearTimeout(watchdog);
      setPlaying(false);
      ytFailed = true;
      yt = null;
      ytReady = false;
      playWhenReady = false;
      showError(giveUpMarkup());
    }

    setPlaying(false);
    if (title && MUSIC.title) title.textContent = MUSIC.title;

    // Prepare the official player after the page has loaded, so nothing here
    // delays the site. Nothing plays on its own: the pink button does that.
    window.addEventListener("load", function () {
      setTimeout(loadYouTubeApi, 800);
    });
    if (document.readyState === "complete") setTimeout(loadYouTubeApi, 800);
  }

  /* 5) Explore Leonida — map viewer ---------------------------------------
     Zoom, pan and fullscreen for this site's own static Leonida map. The
     picture is a local image, so no map service is contacted and nothing about
     the geography is invented here. */
  function initMapViewer() {
    const shell = $("mapShell");
    const viewport = $("mapViewport");
    const image = $("mapImage");
    const empty = $("mapEmpty");
    const fullBtn = $("mapFull");
    if (!shell || !viewport || !image) return;

    const MIN = 1;      // "fit the frame" — here the map is shown at its own size
    const MAX = 4;      // 4x the artwork's own pixels is as far as it stays usable
    const zoomLabel = $("mapZoomLevel");
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
        fit: fit,
        maxX: Math.max(0, (nw * fit * scale - cw) / 2),
        maxY: Math.max(0, (nh * fit * scale - ch) / 2)
      };
    }

    function render() {
      const l = limits();
      x = clamp(x, -l.maxX, l.maxX);
      y = clamp(y, -l.maxY, l.maxY);
      image.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) scale(" + scale.toFixed(3) + ")";

      /* The readout is the map's real size on screen as a share of the
         artwork's own pixels: 100% is the map at its original size, anything
         above it is an enlargement of those same pixels. */
      if (zoomLabel && (image.naturalWidth || 0) > 1) {
        const percent = Math.round(l.fit * scale * 100);
        const text = percent + "%";
        if (zoomLabel.textContent !== text) zoomLabel.textContent = text;
        zoomLabel.classList.toggle("is-enlarged", percent > 100);
      }
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

  /* 6) Scroll reveal ------------------------------------------------------ */
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

  /* 7) Boot -------------------------------------------------------------- */
  function init() {
    renderToday();
    describeRelease();
    renderCountdown();

    // Keep the header date fresh (a minute is plenty).
    window.setInterval(renderToday, 60000);

    initMusicPlayer();
    initMapViewer();
    initReveal();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    countdownTimer = window.setInterval(renderCountdown, 1000);
  });
})();
