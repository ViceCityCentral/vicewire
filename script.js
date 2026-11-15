/* ==========================================================================
   GTA VI · Vice City Countdown — behaviour
   1) Config  2) Date  3) Countdown  4) Music player  5) Scroll reveal
   6) Cookie notice  7) Boot
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

       Each entry of the list below is one of those official uploads, and the
       "now playing" line in the card is the control that steps through them.
       Add an entry (videoId + watchUrl + title) and it joins the list; the
       first one is what the card starts on.

       There is no second audio source: if YouTube refuses to play, the card
       says so and links to the current track's official page rather than
       streaming the song from anywhere else. */
    music: {
      tracks: [
        {
          videoId: "5dPwBWvmcbQ",
          watchUrl: "https://www.youtube.com/watch?v=5dPwBWvmcbQ",
          title: "Flower In A Hurricane — Justice"
        },
        {
          // Michael Hunter's theme, from the release Rockstar Games itself
          // distributes to YouTube (℗ Rockstar Games) — the official upload.
          videoId: "7qfbi3HACV8",
          watchUrl: "https://www.youtube.com/watch?v=7qfbi3HACV8",
          title: "Grand Theft Auto: San Andreas (Official Theme Song)"
        }
      ],
      iframeApi: "https://www.youtube.com/iframe_api",
      host: "https://www.youtube-nocookie.com",
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
     controls, title and branding stay exactly as YouTube renders them.

     The card carries the whole track list from CONFIG.music.tracks: the "now
     playing" line steps to the next official upload, and everything that
     describes the track (title, the 1 / 2 counter, the fallback link and the
     iframe's accessible name) follows it. */
  function initMusicPlayer() {
    const player = $("musicPlayer");
    const stage = $("musicStage");
    const toggle = $("musicToggle");
    const volume = $("musicVolume");
    const error = $("musicError");
    const title = $("musicTitle");
    const counter = $("musicCount");
    const step = $("musicStep");
    if (!player || !stage || !toggle) return;

    const MUSIC = CONFIG.music;
    const tracks = MUSIC.tracks;
    let trackIndex = 0;
    let track = tracks[0];     // the upload the card is showing
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
      toggle.setAttribute("aria-label", (isPlaying ? "Pause" : "Play") + " official GTA music");
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
        '<a class="player__external" href="' + track.watchUrl + '" target="_blank" rel="noopener noreferrer">YouTube</a>.';
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

    /* Stepping through the official uploads ---------------------------------
       Everything the card says about a track is written from `track`, so
       switching is one place: pick the next entry, re-label the card, and tell
       YouTube's player to load it. If the player never came up, the labels and
       the fallback link still follow, so the visitor can reach the track on
       YouTube from the card's own link. */
    function labelTrack() {
      if (title && track.title) {
        title.textContent = track.title;
        title.title = track.title;
      }
      if (counter) counter.textContent = (trackIndex + 1) + "/" + tracks.length;
      if (step) step.setAttribute("aria-label", "Next track — " + tracks.length + " official uploads in this player");
      const fallback = error ? error.querySelector(".player__external") : null;
      if (fallback) fallback.href = track.watchUrl;
      // While it runs, YouTube's player names its own iframe from the video it
      // has loaded, which is the most accurate name there is. If the player is
      // gone, the name is kept in step with the card by hand instead.
      if (!ytReady || !yt) {
        const frame = stage.querySelector("iframe");
        if (frame) frame.setAttribute("title", track.title + " — official YouTube player");
      }
    }

    function stepTrack() {
      if (tracks.length < 2) return;
      trackIndex = (trackIndex + 1) % tracks.length;
      track = tracks[trackIndex];
      labelTrack();
      if (!ytReady || !yt) return;      // the player will start on this track
      try {
        // loadVideoById plays, cueVideoById only loads — so a visitor who has
        // not asked for sound gets the new track queued, not played at them.
        if (wantPlay) {
          yt.loadVideoById(track.videoId);
          armWatchdog();
        } else {
          yt.cueVideoById(track.videoId);
        }
      } catch (err) {
        failOver();
      }
    }

    if (step) step.addEventListener("click", stepTrack);

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
        videoId: track.videoId,
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
          frame.setAttribute("title", track.title + " — official YouTube player");
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
    labelTrack();   // title, the 1/2 counter and the fallback link

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

  /* 6) Cookie notice ------------------------------------------------------
     The notice is informational: it explains that the page loads YouTube's
     players and Google Fonts, and it records the visitor's answer in one cookie
     on their own device so the card does not come back on every visit. No
     answer changes what the page loads — the embeds are the page — so the
     buttons only store the answer, and the card says as much.

     Reuse: raise CHOICE_VERSION after rewording the notice and everyone who has
     not answered that version is asked once more. */
  const COOKIE = {
    name: "viceCityCentralCookies_v1",
    days: 180,
    version: 1,
    accepted: "accepted",
    declined: "declined"
  };

  function readCookieChoice() {
    const match = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + COOKIE.name + "=([^;]*)")
    );
    if (!match) return null;
    // e.g. "accepted.1" — an older wording's answer does not count as this one's,
    // and anything that is not one of the two known answers is ignored.
    const parts = decodeURIComponent(match[1]).split(".");
    const known = parts[0] === COOKIE.accepted || parts[0] === COOKIE.declined;
    return known && Number(parts[1]) === COOKIE.version ? parts[0] : null;
  }

  // Best effort: a browser that blocks cookies (or private mode) simply keeps
  // the card for next time, which is why the return value is not checked.
  function storeCookieChoice(choice) {
    const expires = new Date(Date.now() + COOKIE.days * 86400000).toUTCString();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      COOKIE.name + "=" + encodeURIComponent(choice + "." + COOKIE.version) +
      "; expires=" + expires + "; path=/; SameSite=Lax" + secure;
  }

  function initCookieNotice() {
    const notice = document.getElementById("cookieNotice");
    if (!notice) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function answer(choice) {
      storeCookieChoice(choice);
      notice.classList.remove("is-shown");
      window.setTimeout(function () {
        notice.hidden = true;
      }, reduceMotion ? 0 : 300);
    }

    const accept = document.getElementById("cookieAccept");
    const decline = document.getElementById("cookieDecline");
    if (accept) accept.addEventListener("click", function () { answer(COOKIE.accepted); });
    if (decline) decline.addEventListener("click", function () { answer(COOKIE.declined); });

    // No stored answer yet: show it, and fade it in once it has been laid out.
    if (readCookieChoice()) return;
    notice.hidden = false;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { notice.classList.add("is-shown"); });
    });
  }

  /* 7) Boot -------------------------------------------------------------- */
  function init() {
    renderToday();
    describeRelease();
    renderCountdown();

    // Keep the header date fresh (a minute is plenty).
    window.setInterval(renderToday, 60000);

    initMusicPlayer();
    initReveal();
    initCookieNotice();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    countdownTimer = window.setInterval(renderCountdown, 1000);
  });
})();
