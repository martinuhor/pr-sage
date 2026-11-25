/* PR Sage — interactive demo driver.
 * Drives window.PRSage.createRenderer() with requestAnimationFrame, wires up
 * the player controls, and can record the canvas to a .webm with MediaRecorder.
 */
(function () {
  "use strict";

  var PS = window.PRSage;
  var canvas = document.getElementById("stage");
  if (!PS || !canvas) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = PS.W * DPR;
  canvas.height = PS.H * DPR;
  var ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);

  var renderer = PS.createRenderer(ctx);

  var params = new URLSearchParams(location.search);
  var staticMode = params.has("t");

  var state = { t: 0, playing: !staticMode, speed: 1, recording: false, last: 0 };

  // ------------------------------------------------------------- ui refs
  var el = {
    play: document.getElementById("playPause"),
    playIcon: document.getElementById("playIcon"),
    playLabel: document.getElementById("playLabel"),
    replay: document.getElementById("replay"),
    scrub: document.getElementById("scrub"),
    time: document.getElementById("time"),
    speed: document.getElementById("speed"),
    record: document.getElementById("record"),
    recLabel: document.getElementById("recLabel"),
    stages: document.getElementById("stages"),
  };

  var ICON = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  };

  // ---------------------------------------------------------- stage chips
  if (el.stages) {
    PS.STAGES.forEach(function (s, i) {
      var b = document.createElement("button");
      b.className = "stage-chip";
      b.textContent = s.label;
      b.dataset.t = String(s.t);
      b.dataset.i = String(i);
      b.addEventListener("click", function () {
        seek(s.t);
        pause();
      });
      el.stages.appendChild(b);
    });
  }

  function fmt(t) {
    var a = Math.max(0, t);
    var s = Math.floor(a % 60);
    var ds = Math.floor((a % 1) * 10);
    return (a < 10 ? "0" : "") + Math.floor(a) + "." + ds + "s";
  }

  function syncUI() {
    if (el.playIcon) el.playIcon.innerHTML = state.playing ? ICON.pause : ICON.play;
    if (el.playLabel) el.playLabel.textContent = state.playing ? "Pause" : "Play";
    if (el.scrub) el.scrub.value = String(state.t);
    if (el.time) el.time.textContent = fmt(state.t) + " / " + fmt(PS.DURATION);
    if (el.stages) {
      var active = -1;
      PS.STAGES.forEach(function (s, i) {
        if (state.t >= s.t - 0.001) active = i;
      });
      Array.prototype.forEach.call(el.stages.children, function (c, i) {
        c.classList.toggle("active", i === active);
      });
    }
  }

  function render() {
    renderer.render(state.t);
    syncUI();
  }

  function play() {
    if (state.t >= PS.DURATION - 0.001) state.t = 0;
    state.playing = true;
    state.last = 0;
    syncUI();
  }
  function pause() {
    state.playing = false;
    syncUI();
  }
  function toggle() {
    state.playing ? pause() : play();
  }
  function seek(t) {
    state.t = Math.max(0, Math.min(PS.DURATION, t));
    render();
  }

  // ------------------------------------------------------------- controls
  if (el.play) el.play.addEventListener("click", toggle);
  if (el.replay)
    el.replay.addEventListener("click", function () {
      state.t = 0;
      play();
      render();
    });
  if (el.scrub)
    el.scrub.addEventListener("input", function () {
      pause();
      seek(parseFloat(el.scrub.value));
    });
  if (el.speed)
    el.speed.addEventListener("change", function () {
      state.speed = parseFloat(el.speed.value) || 1;
    });
  canvas.addEventListener("click", toggle);

  // -------------------------------------------------------------- recorder
  var rec = { mr: null, chunks: [], url: null };
  function pickMime() {
    var opts = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (var i = 0; i < opts.length; i++) {
      if (MediaRecorder.isTypeSupported(opts[i])) return opts[i];
    }
    return "";
  }

  function startRecording() {
    var stream = canvas.captureStream(30);
    var mime = pickMime();
    var mr;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
    } catch (e) {
      alert("Recording isn't supported in this browser.");
      return;
    }
    rec.mr = mr;
    rec.chunks = [];
    state.recording = true;
    if (el.record) {
      el.record.classList.add("on");
      if (el.recLabel) el.recLabel.textContent = "Recording…";
    }
    mr.ondataavailable = function (e) {
      if (e.data && e.data.size) rec.chunks.push(e.data);
    };
    mr.onstop = function () {
      var blob = new Blob(rec.chunks, { type: mime || "video/webm" });
      if (rec.url) URL.revokeObjectURL(rec.url);
      rec.url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = rec.url;
      a.download = "pr-sage-demo.webm";
      document.body.appendChild(a);
      a.click();
      a.remove();
      state.recording = false;
      if (el.record) {
        el.record.classList.remove("on");
        if (el.recLabel) el.recLabel.textContent = "Export video";
      }
    };
    state.t = 0;
    state.speed = 1;
    if (el.speed) el.speed.value = "1";
    state.playing = true;
    state.last = 0;
    mr.start();
  }

  function stopRecording() {
    if (rec.mr && rec.mr.state !== "inactive") rec.mr.stop();
  }

  if (el.record)
    el.record.addEventListener("click", function () {
      state.recording ? stopRecording() : startRecording();
    });

  // --------------------------------------------------------------- raf loop
  function frame(now) {
    var dt = state.last ? (now - state.last) / 1000 : 0;
    state.last = now;
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t >= PS.DURATION) {
        state.t = PS.DURATION;
        state.playing = false;
        if (state.recording) {
          // let the final frame land before stopping the recorder
          setTimeout(stopRecording, 350);
          renderer.render(state.t);
          syncUI();
          requestAnimationFrame(frame);
          return;
        }
      }
      renderer.render(state.t);
      syncUI();
    } else if (state.recording) {
      renderer.render(state.t);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------- headless/static mode
  window.__seek = function (t) {
    state.playing = false;
    state.t = t;
    renderer.render(t);
    return true;
  };
  window.__ready = function () {
    return true;
  };

  if (staticMode) {
    var t0 = parseFloat(params.get("t")) || 0;
    state.playing = false;
    state.t = t0;
    renderer.render(t0);
    syncUI();
    requestAnimationFrame(frame);
  } else {
    render();
    // brief hold on the first frame, then auto-play
    setTimeout(function () {
      play();
      requestAnimationFrame(frame);
    }, 600);
  }
})();
