/* ==========================================================================
   GTA VI · Vice City Countdown — behaviour
   1) Config  2) Date  3) Countdown  4) Music player  5) Scroll reveal
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

  /* 5) Scroll reveal ------------------------------------------------------ */
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

  /* 6) Boot -------------------------------------------------------------- */
  function init() {
    renderToday();
    describeRelease();
    renderCountdown();

    // Keep the header date fresh (a minute is plenty).
    window.setInterval(renderToday, 60000);

    initMusicPlayer();
    initReveal();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    countdownTimer = window.setInterval(renderCountdown, 1000);
  });
})();
