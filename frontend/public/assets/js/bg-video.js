// Background video for login/reset/2FA. Skipped on data saver, 2G, or a slow start (the photo stays); two copies crossfade for a seamless loop.
(function () {
  var FADE = 0.9;            // seconds of overlap between the two copies
  var LEAD = FADE + 0.3;     // start early: timeupdate only fires every ~250ms
  var LOAD_TIMEOUT = 4000;   // ms the video gets to become playable

  var first = document.querySelector(".page-bg-video");
  if (!first) return;
  var src = first.getAttribute("data-src");
  if (!src) return;

  // Why the video is or isn't showing, readable from DevTools:
  // document.body.dataset.bgVideo
  function setState(state) { document.body.setAttribute("data-bg-video", state); }

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setState("skipped: reduced motion");
    return;
  }

  // Only data saver/2G skip up front; Chrome often labels normal connections "3g".
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.saveData) { setState("skipped: data saver"); return; }
  if (conn && /(^|-)2g$/.test(conn.effectiveType || "")) { setState("skipped: " + conn.effectiveType); return; }
  setState("loading");

  function giveUp() {
    setState("skipped: not playable within " + LOAD_TIMEOUT / 1000 + "s");
    var videos = document.querySelectorAll(".page-bg-video");
    for (var i = 0; i < videos.length; i++) {
      videos[i].pause();
      videos[i].removeAttribute("src");
      videos[i].load(); // cancels the in-flight download
      videos[i].style.display = "none";
    }
  }

  var ready = false;
  var timer = setTimeout(function () { if (!ready) giveUp(); }, LOAD_TIMEOUT);

  first.muted = true;
  first.preload = "auto";
  first.src = src;
  first.addEventListener("canplay", function onReady() {
    first.removeEventListener("canplay", onReady);
    ready = true;
    clearTimeout(timer);
    setState("ready");
    startLoop();
  });
  first.addEventListener("error", function () {
    clearTimeout(timer);
    giveUp();
    setState("skipped: video failed to load");
  });
  first.load();

  function safePlay(v) {
    if (document.hidden) return;
    var attempt = v.play();
    if (attempt && attempt.then) {
      attempt.then(function () { setState("playing"); }, function (err) {
        setState("waiting for tap/click (autoplay blocked: " + (err && err.name) + ")");
      });
    }
  }

  function startLoop() {
    // Same URL, so the copy is served from the cache the first one filled.
    var second = first.cloneNode(false);
    second.removeAttribute("poster");
    second.muted = true;
    second.preload = "auto";
    second.src = src;
    first.parentNode.insertBefore(second, first.nextSibling);

    var active = first;
    var idle = second;
    var fading = false;

    function showUnder(v) { v.style.transition = "none"; v.style.opacity = "1"; v.style.zIndex = "0"; }
    function hide(v) { v.style.transition = "none"; v.style.opacity = "0"; v.style.zIndex = "0"; }
    showUnder(active);
    hide(idle);

    function crossfade() {
      fading = true;
      var outgoing = active;
      var incoming = idle;

      incoming.currentTime = 0;
      showUnder(incoming);            // fully visible, underneath
      safePlay(incoming);

      outgoing.style.zIndex = "1";    // on top, fading away
      void outgoing.offsetWidth;      // commit before starting the transition
      outgoing.style.transition = "opacity " + FADE + "s linear";
      outgoing.style.opacity = "0";

      active = incoming;
      idle = outgoing;

      setTimeout(function () {
        outgoing.pause();
        hide(outgoing);
        fading = false;
      }, FADE * 1000 + 50);
    }

    function checkEnd() {
      var d = active.duration;
      if (!fading && d && isFinite(d) && d > LEAD * 2 && active.currentTime >= d - LEAD) {
        crossfade();
      }
    }

    function tick() {
      checkEnd();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    [first, second].forEach(function (v) {
      v.addEventListener("timeupdate", checkEnd);
      // Too short to crossfade, or the check missed the end: restart cleanly.
      v.addEventListener("ended", function () {
        if (v !== active || fading) return;
        v.currentTime = 0;
        safePlay(v);
      });
      // The browser paused it on its own (tab hidden, power saving): resume.
      v.addEventListener("pause", function () {
        if (v === active && !fading && !v.ended) setTimeout(function () { safePlay(active); }, 300);
      });
    });

    function resume() { safePlay(active); }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);

    // Autoplay refused: start on the visitor's first tap, click or key press.
    ["pointerdown", "touchstart", "keydown"].forEach(function (type) {
      document.addEventListener(type, resume, { once: true, passive: true });
    });

    resume();
  }
})();
