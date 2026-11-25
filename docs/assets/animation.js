/* PR Sage — deterministic canvas renderer.
 *
 * The whole walkthrough is a pure function of time: render(t) draws the state
 * of the simulation at t seconds. That makes it possible to (a) play it live in
 * the browser with requestAnimationFrame and (b) record it frame-by-frame with
 * an in-page MediaRecorder or a headless browser, and get identical output.
 *
 * Exposes: window.PRSage = { W, H, DURATION, STAGES, createRenderer }
 */
(function (global) {
  "use strict";

  var W = 1280;
  var H = 720;
  var DURATION = 20.0;

  var FONT_UI =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var FONT_MONO =
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

  var C = {
    bg: "#07070a",
    frame: "#0e0e14",
    frameStroke: "#232332",
    panel: "#121219",
    panelStroke: "#262636",
    header: "#0b0b11",
    text: "#e8e8f0",
    soft: "#b6b6c6",
    dim: "#8a8a9c",
    dimmer: "#5d5d6e",
    line: "#22222e",
    accent: "#a78bfa",
    accent2: "#c4b5fd",
    crit: "#ff6b6b",
    warn: "#ffb454",
    sugg: "#5eb0ff",
    praise: "#4ade80",
    ok: "#4ade80",
    add: "#12291d",
    del: "#2a1216",
    ctx: "#101017",
  };

  // ---------------------------------------------------------------- geometry
  var P = 22;
  var TB = 46;
  var G = 14;
  var FR = { x: P, y: P, w: W - 2 * P, h: H - 2 * P };
  var BODY = { x: FR.x + 14, y: FR.y + TB + 8, w: FR.w - 28, h: FR.h - TB - 8 - 14 };
  var LP = { x: BODY.x, y: BODY.y, w: 470, h: BODY.h };
  var RP = { x: LP.x + LP.w + G, y: BODY.y, w: BODY.w - LP.w - G, h: BODY.h };

  // ------------------------------------------------------------------ helpers
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, p) {
    return a + (b - a) * p;
  }
  function easeOut(p) {
    p = clamp(p, 0, 1);
    return 1 - Math.pow(1 - p, 3);
  }
  function appear(t, t0, d) {
    return easeOut((t - t0) / (d || 0.34));
  }
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fillRR(ctx, x, y, w, h, r, fill) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function strokeRR(ctx, x, y, w, h, r, stroke, lw) {
    rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw || 1;
    ctx.stroke();
  }
  function panel(ctx, x, y, w, h, fill) {
    fillRR(ctx, x, y, w, h, 14, fill || C.panel);
    strokeRR(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14, C.panelStroke, 1);
  }
  function setFont(ctx, font, size, weight) {
    ctx.font = (weight || 400) + " " + size + "px " + font;
  }
  function txt(ctx, s, x, y, o) {
    o = o || {};
    setFont(ctx, o.font || FONT_UI, o.size || 13, o.weight || 400);
    ctx.fillStyle = o.fill || C.text;
    ctx.textAlign = o.align || "left";
    ctx.textBaseline = o.baseline || "alphabetic";
    if (o.alpha != null) {
      var prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * o.alpha;
      ctx.fillText(s, x, y);
      ctx.globalAlpha = prev;
    } else {
      ctx.fillText(s, x, y);
    }
  }
  function measure(ctx, s, font, size, weight) {
    setFont(ctx, font, size, weight);
    return ctx.measureText(s).width;
  }
  function chip(ctx, s, x, y, o) {
    o = o || {};
    var size = o.size || 10.5;
    var pad = o.pad == null ? 7 : o.pad;
    var h = o.h || 18;
    var w = measure(ctx, s, o.font || FONT_MONO, size, o.weight || 600) + pad * 2;
    fillRR(ctx, x, y, w, h, h / 2, o.fill || "rgba(167,139,250,0.14)");
    if (o.stroke) strokeRR(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2, o.stroke, 1);
    txt(ctx, s, x + w / 2, y + h / 2 + 0.5, {
      font: o.font || FONT_MONO,
      size: size,
      weight: o.weight || 600,
      fill: o.color || C.accent2,
      align: "center",
      baseline: "middle",
    });
    return w;
  }
  function wrapLines(ctx, s, font, size, weight, maxW) {
    setFont(ctx, font, size, weight);
    var words = s.split(" ");
    var lines = [];
    var cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function clipText(ctx, s, x, y, maxW, o) {
    o = o || {};
    var out = s;
    setFont(ctx, o.font || FONT_UI, o.size || 13, o.weight || 400);
    if (ctx.measureText(out).width > maxW) {
      while (out.length > 1 && ctx.measureText(out + "…").width > maxW) {
        out = out.slice(0, -1);
      }
      out = out + "…";
    }
    txt(ctx, out, x, y, o);
  }
  function dot(ctx, x, y, r, color, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function spinner(ctx, cx, cy, r, t, color) {
    var a0 = t * 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + 1.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0 + Math.PI, a0 + Math.PI + 1.6);
    ctx.stroke();
  }

  // -------------------------------------------------------------------- data
  var PR = {
    owner: "acme",
    repo: "api",
    number: 4821,
    title: "feat: add user search endpoint",
    head: "feat/user-search",
    base: "main",
    files: 3,
    add: 84,
    del: 12,
  };

  var DIFF = {
    file: "src/db/query.ts",
    hunk: "@@ -37,6 +37,9 @@ export async function searchUsers(q: string)",
    lines: [
      { n: 38, k: "ctx", code: "export async function searchUsers(q: string) {" },
      { n: 39, k: "ctx", code: "  const db = await getDb();" },
      { n: 40, k: "add", code: "  const sql = `SELECT * FROM users WHERE name LIKE '%${q}%'`;" },
      { n: 41, k: "add", code: "  const rows = await db.raw(sql);" },
      { n: 42, k: "add", code: "  return rows.map(toUser);" },
      { n: 43, k: "ctx", code: "}" },
    ],
  };

  var SEV = {
    critical: { c: C.crit, label: "critical", bg: "rgba(255,107,107,0.10)" },
    warning: { c: C.warn, label: "warning", bg: "rgba(255,180,84,0.10)" },
    suggestion: { c: C.sugg, label: "suggestion", bg: "rgba(94,176,255,0.10)" },
    praise: { c: C.praise, label: "praise", bg: "rgba(74,222,128,0.10)" },
  };

  var COMMENTS = [
    {
      t: 9.4,
      severity: "critical",
      path: DIFF.file,
      line: 40,
      title: "SQL injection via string interpolation",
      body: "`q` is interpolated straight into SQL. Use a parameterized query.",
      inline: true,
    },
    {
      t: 11.2,
      severity: "warning",
      path: "src/api/users.ts",
      line: 18,
      title: "Public endpoint has no rate limiting",
    },
    {
      t: 12.8,
      severity: "suggestion",
      path: "src/lib/auth.ts",
      line: 7,
      title: "Compare tokens with timingSafeEqual",
    },
    {
      t: 13.9,
      severity: "praise",
      path: "src/api/users.ts",
      line: 31,
      title: "Nice zod validation on the query params",
    },
  ];

  var LOGS = [
    {
      t: 0.3,
      k: "http",
      method: "POST",
      path: "/api/webhook/github",
      note: "x-github-event: pull_request · action=opened",
      status: "",
      h: 44,
    },
    { t: 1.25, k: "check", label: "HMAC-SHA256 signature", h: 28 },
    {
      t: 1.8,
      k: "http",
      method: "POST",
      path: "/api/webhook/github",
      note: "review fired (fire-and-forget)",
      status: "202 Accepted",
      h: 44,
    },
    { t: 2.65, k: "agent", label: "pull_request #" + PR.number, h: 28 },
    {
      t: 3.05,
      k: "model",
      label: "anthropic/claude-sonnet-4-5",
      note: "ToolLoopAgent · AI Gateway",
      h: 28,
    },
    {
      t: 3.75,
      k: "tool",
      name: "fetch_pr_files",
      arg: "{ pr: 4821 }",
      res: "3 files · +84 −12",
      tr: 5.05,
      h: 48,
    },
    {
      t: 5.6,
      k: "tool",
      name: "read_file_context",
      arg: '{ path: "src/db/query.ts" }',
      res: "142 lines of context",
      tr: 6.85,
      h: 48,
    },
    {
      t: 7.3,
      k: "stream",
      text:
        "Scanning the diff for correctness, security, performance and error handling — a SQL injection risk stands out.",
      dur: 2.6,
      h: 50,
    },
    {
      t: 14.6,
      k: "tool",
      name: "post_review",
      arg: '{ comments: 4, verdict: "request changes" }',
      res: "review #4821 posted to GitHub",
      tr: 16.2,
      h: 48,
    },
    {
      t: 16.6,
      k: "metrics",
      items: ["tool.fetch_pr_files", "tool.read_file_context", "review.posted"],
      h: 28,
    },
    { t: 18.4, k: "done", h: 26 },
  ];

  var T = {
    prHeader: 2.65,
    prBody: 2.95,
    diff: 3.35,
    posted: 16.2,
    summary: 16.4,
    done: 18.4,
  };

  var STAGES = [
    { t: 0.0, label: "Webhook" },
    { t: 2.6, label: "Agent starts" },
    { t: 3.7, label: "Tool calls" },
    { t: 9.4, label: "Findings" },
    { t: 14.6, label: "Post review" },
    { t: 16.4, label: "Summary" },
  ];

  // ------------------------------------------------------------ title / frame
  function drawFrame(ctx, t) {
    fillRR(ctx, 0, 0, W, H, 0, C.bg);
    // ambient glow
    var g = ctx.createRadialGradient(W / 2, -80, 40, W / 2, -80, 620);
    g.addColorStop(0, "rgba(124,92,245,0.20)");
    g.addColorStop(1, "rgba(124,92,245,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    fillRR(ctx, FR.x, FR.y, FR.w, FR.h, 18, C.frame);
    strokeRR(ctx, FR.x + 0.5, FR.y + 0.5, FR.w - 1, FR.h - 1, 18, C.frameStroke, 1);

    // title bar
    ctx.save();
    rr(ctx, FR.x, FR.y, FR.w, TB, 18);
    ctx.clip();
    ctx.fillStyle = C.header;
    ctx.fillRect(FR.x, FR.y, FR.w, TB);
    ctx.restore();
    var ly = FR.y + TB / 2;
    var lights = ["#ff5f57", "#febc2e", "#28c840"];
    for (var i = 0; i < 3; i++) dot(ctx, FR.x + 22 + i * 20, ly, 6, lights[i]);
    txt(ctx, "PR Sage", FR.x + 96, ly + 4.5, {
      size: 13.5,
      weight: 700,
      fill: C.text,
    });
    var pw = measure(ctx, "PR Sage", FONT_UI, 13.5, 700);
    txt(ctx, "— live review", FR.x + 96 + pw + 8, ly + 4.5, {
      size: 13.5,
      weight: 400,
      fill: C.dimmer,
    });

    // right side of title bar: model + gateway
    var rx = FR.x + FR.w - 22;
    var badge = "AI Gateway";
    var bw = measure(ctx, badge, FONT_MONO, 10.5, 600) + 16;
    rx -= bw;
    chip(ctx, badge, rx, ly - 9, {
      fill: "rgba(74,222,128,0.12)",
      color: "#86efac",
      size: 10.5,
      pad: 8,
      h: 18,
    });
    rx -= 10;
    var m = "anthropic/claude-sonnet-4-5";
    var mw = measure(ctx, m, FONT_MONO, 11, 500);
    txt(ctx, m, rx - mw, ly + 4, {
      font: FONT_MONO,
      size: 11,
      weight: 500,
      fill: C.soft,
    });

    // progress bar
    var pbX = BODY.x;
    var pbW = BODY.w;
    var pbY = FR.y + FR.h - 9;
    fillRR(ctx, pbX, pbY, pbW, 3, 2, "rgba(255,255,255,0.06)");
    var fillW = Math.max(0, pbW * clamp(t / DURATION, 0, 1));
    if (fillW > 1) {
      var grd = ctx.createLinearGradient(pbX, 0, pbX + pbW, 0);
      grd.addColorStop(0, "#7c5cf5");
      grd.addColorStop(1, "#c4b5fd");
      fillRR(ctx, pbX, pbY, fillW, 3, 2, grd);
    }
  }

  // ------------------------------------------------------------- left: agent
  function drawHeaderRow(ctx, x, y, w, title, right, rightColor, t) {
    // pulsing halo, driven by the clock so playback and recording match
    var pulse = 0.35 + 0.35 * Math.sin(t * 2.4);
    ctx.beginPath();
    ctx.arc(x + 5, y + 6, 7, 0, Math.PI * 2);
    ctx.fillStyle = hexA(C.accent, 0.18 * (0.6 + pulse));
    ctx.fill();
    dot(ctx, x + 5, y + 6, 4, C.accent);
    txt(ctx, title, x + 16, y + 9.5, {
      size: 11,
      weight: 700,
      fill: C.dim,
    });
    if (right) {
      txt(ctx, right, x + w, y + 9.5, {
        font: FONT_MONO,
        size: 11,
        weight: 500,
        fill: rightColor || C.dimmer,
        align: "right",
      });
    }
  }

  function drawAgentPanel(ctx, t) {
    panel(ctx, LP.x, LP.y, LP.w, LP.h, "rgba(18,18,25,0.85)");
    ctx.save();
    rr(ctx, LP.x, LP.y, LP.w, LP.h, 14);
    ctx.clip();

    var x = LP.x + 14;
    var w = LP.w - 28;
    var done = t >= T.done;
    drawHeaderRow(
      ctx,
      x,
      LP.y + 12,
      w,
      "AGENT STREAM",
      done ? "complete" : "streaming",
      done ? C.ok : C.accent2,
      t
    );
    ctx.beginPath();
    ctx.moveTo(x, LP.y + 34);
    ctx.lineTo(x + w, LP.y + 34);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    var cy = LP.y + 48;
    var maxY = LP.y + LP.h - 12;
    for (var i = 0; i < LOGS.length; i++) {
      var e = LOGS[i];
      if (e.t > t) break;
      var a = appear(t, e.t, 0.32);
      if (cy + e.h > maxY) break;
      ctx.globalAlpha = a;
      var oy = (1 - easeOut(clamp((t - e.t) / 0.32, 0, 1))) * 8;
      ctx.save();
      ctx.translate(0, oy);
      drawLogEntry(ctx, t, e, x, cy, w);
      ctx.restore();
      ctx.globalAlpha = 1;
      cy += e.h;
    }
    ctx.restore();
  }

  function drawLogEntry(ctx, t, e, x, y, w) {
    if (e.k === "http") {
      var cy = y + 15;
      var mw = chip(ctx, e.method, x, cy - 9, {
        fill: "rgba(167,139,250,0.16)",
        color: C.accent2,
        size: 10,
        pad: 7,
        h: 18,
      });
      txt(ctx, e.path, x + mw + 8, cy + 3.5, {
        font: FONT_MONO,
        size: 11.5,
        weight: 500,
        fill: C.soft,
      });
      if (e.status) {
        var ok = e.status.indexOf("202") === 0;
        chip(ctx, e.status, x + w - measure(ctx, e.status, FONT_MONO, 10, 700) - 16, cy - 9, {
          fill: ok ? "rgba(74,222,128,0.14)" : "rgba(255,255,255,0.06)",
          color: ok ? "#86efac" : C.dim,
          size: 10,
          pad: 8,
          h: 18,
        });
      }
      txt(ctx, e.note, x + 4, cy + 20, {
        font: FONT_MONO,
        size: 10.5,
        weight: 400,
        fill: C.dimmer,
      });
      return;
    }
    if (e.k === "check") {
      var c = y + 16;
      ctx.beginPath();
      ctx.arc(x + 5, c - 4, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(74,222,128,0.14)";
      ctx.fill();
      txt(ctx, "✓", x + 5, c - 0.5, {
        size: 10,
        weight: 700,
        fill: C.ok,
        align: "center",
      });
      txt(ctx, e.label, x + 20, c, {
        font: FONT_MONO,
        size: 11.5,
        fill: C.soft,
      });
      txt(ctx, "verified", x + w, c, {
        font: FONT_MONO,
        size: 11,
        weight: 600,
        fill: C.ok,
        align: "right",
      });
      return;
    }
    if (e.k === "agent") {
      var ay = y + 16;
      dot(ctx, x + 5, ay - 4, 4, C.accent2);
      clipText(ctx, e.label, x + 18, ay, w - 18, {
        font: FONT_MONO,
        size: 11.5,
        weight: 600,
        fill: C.text,
      });
      return;
    }
    if (e.k === "model") {
      var my = y + 16;
      txt(ctx, "◆", x + 3, my, { size: 10, fill: C.accent });
      txt(ctx, e.label, x + 18, my, {
        font: FONT_MONO,
        size: 11.5,
        weight: 500,
        fill: C.accent2,
      });
      var lw2 = measure(ctx, e.label, FONT_MONO, 11.5, 500);
      txt(ctx, e.note, x + 26 + lw2, my, {
        size: 11,
        fill: C.dimmer,
      });
      return;
    }
    if (e.k === "tool") {
      var ty = y + 15;
      var running = t < e.tr;
      if (running) {
        spinner(ctx, x + 6, ty - 4, 6, t, C.accent);
      } else {
        txt(ctx, "✓", x + 6, ty - 0.5, {
          size: 11,
          weight: 700,
          fill: C.ok,
          align: "center",
        });
      }
      var nw = measure(ctx, e.name, FONT_MONO, 12, 600);
      txt(ctx, e.name, x + 18, ty, {
        font: FONT_MONO,
        size: 12,
        weight: 600,
        fill: running ? C.accent2 : C.text,
      });
      txt(ctx, "(" + "", x + 18 + nw, ty, { font: FONT_MONO, size: 12, fill: C.dimmer });
      clipText(ctx, e.arg + ")", x + 18 + nw + measure(ctx, "(", FONT_MONO, 12, 400), ty, w - 24 - nw, {
        font: FONT_MONO,
        size: 11.5,
        fill: C.dim,
      });
      // result row
      var ry = ty + 20;
      if (running) {
        var dotsN = 1 + (Math.floor(t * 3) % 3);
        txt(ctx, "running" + ".".repeat(dotsN), x + 22, ry, {
          font: FONT_MONO,
          size: 11,
          fill: C.dimmer,
        });
      } else {
        var ra = appear(t, e.tr, 0.28);
        ctx.globalAlpha = ctx.globalAlpha * ra;
        txt(ctx, "↳", x + 18, ry, { font: FONT_MONO, size: 11.5, fill: C.ok });
        txt(ctx, e.res, x + 32, ry, {
          font: FONT_MONO,
          size: 11.5,
          fill: C.soft,
        });
        ctx.globalAlpha = 1;
      }
      return;
    }
    if (e.k === "stream") {
      var p = clamp((t - e.t) / (e.dur || 2), 0, 1);
      var full = e.text;
      var shown = full.slice(0, Math.round(full.length * p));
      var lines = wrapLines(ctx, full, FONT_UI, 12.5, 400, w - 44);
      var shownLines = wrapLines(ctx, shown, FONT_UI, 12.5, 400, w - 44);
      var sy = y + 15;
      txt(ctx, "›", x + 3, sy, { size: 12, fill: C.accent });
      for (var li = 0; li < lines.length; li++) {
        var s = shownLines[li] != null ? shownLines[li] : "";
        txt(ctx, s, x + 18, sy + li * 17, {
          size: 12.5,
          fill: li === 0 ? C.soft : C.soft,
        });
        if (li === shownLines.length - 1 && p < 1) {
          var cw = measure(ctx, s, FONT_UI, 12.5, 400);
          var blink = Math.sin(t * 8) > 0 ? 1 : 0.15;
          ctx.globalAlpha = blink;
          ctx.fillStyle = C.accent;
          ctx.fillRect(x + 18 + cw + 2, sy + li * 17 - 10, 6, 13);
          ctx.globalAlpha = 1;
        }
      }
      return;
    }
    if (e.k === "metrics") {
      var gy = y + 16;
      txt(ctx, "metric()", x + 3, gy, {
        font: FONT_MONO,
        size: 10.5,
        weight: 600,
        fill: C.accent,
      });
      var mx = x + measure(ctx, "metric()", FONT_MONO, 10.5, 600) + 10;
      for (var mi = 0; mi < e.items.length; mi++) {
        var label = e.items[mi];
        var cw2 = chip(ctx, label, mx, gy - 13, {
          fill: "rgba(255,255,255,0.05)",
          color: C.dim,
          size: 10,
          pad: 7,
          h: 17,
        });
        mx += cw2 + 6;
        if (mx > x + w - 20) break;
      }
      return;
    }
    if (e.k === "done") {
      var dy = y + 14;
      var label2 = "Review complete · posted to GitHub";
      fillRR(ctx, x, dy - 12, w, 22, 11, "rgba(74,222,128,0.10)");
      dot(ctx, x + 12, dy - 1, 4, C.ok);
      txt(ctx, label2, x + 24, dy + 3.5, {
        size: 11.5,
        weight: 600,
        fill: "#86efac",
      });
      return;
    }
  }

  // -------------------------------------------------------- right: github PR
  function drawPrPanel(ctx, t) {
    panel(ctx, RP.x, RP.y, RP.w, RP.h, "rgba(18,18,25,0.85)");
    ctx.save();
    rr(ctx, RP.x, RP.y, RP.w, RP.h, 14);
    ctx.clip();

    var x = RP.x + 16;
    var w = RP.w - 32;

    // header
    var ha = appear(t, T.prHeader, 0.4);
    if (ha > 0) {
      ctx.globalAlpha = ha;
      // repo line
      txt(ctx, PR.owner + " / " + PR.repo, x, RP.y + 26, {
        font: FONT_MONO,
        size: 11,
        fill: C.dimmer,
      });
      txt(ctx, "#" + PR.number, x + w, RP.y + 26, {
        font: FONT_MONO,
        size: 11,
        weight: 600,
        fill: C.dim,
        align: "right",
      });
      txt(ctx, PR.title, x, RP.y + 48, {
        size: 16.5,
        weight: 700,
        fill: C.text,
      });
      // chips
      var cxp = x;
      cxp += chip(ctx, PR.head + " → " + PR.base, cxp, RP.y + 58, {
        fill: "rgba(167,139,250,0.12)",
        color: C.accent2,
        size: 10.5,
        pad: 9,
        h: 19,
      }) + 8;
      cxp += chip(ctx, "+" + PR.add + "  −" + PR.del, cxp, RP.y + 58, {
        fill: "rgba(74,222,128,0.10)",
        color: "#86efac",
        size: 10.5,
        pad: 9,
        h: 19,
      }) + 8;
      var posted = t >= T.posted;
      chip(ctx, posted ? "review posted" : "reviewing…", cxp, RP.y + 58, {
        fill: posted ? "rgba(74,222,128,0.12)" : "rgba(167,139,250,0.12)",
        color: posted ? "#86efac" : C.accent2,
        size: 10.5,
        pad: 9,
        h: 19,
      });
      ctx.globalAlpha = 1;
    }

    var top = RP.y + 92;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, top);
    ctx.strokeStyle = C.line;
    ctx.stroke();

    // diff
    var dy = top + 12;
    var diffBottom = dy + 20;
    var diffA = appear(t, T.diff, 0.4);
    if (diffA > 0) {
      ctx.globalAlpha = diffA;
      txt(ctx, DIFF.file, x, dy + 10, {
        font: FONT_MONO,
        size: 11.5,
        weight: 600,
        fill: C.soft,
      });
      var addC = DIFF.lines.filter(function (l) {
        return l.k === "add";
      }).length;
      txt(ctx, "+" + addC, x + w, dy + 10, {
        font: FONT_MONO,
        size: 11,
        weight: 600,
        fill: "#86efac",
        align: "right",
      });
      var bx = x;
      var by = dy + 20;
      var bw2 = w;
      var lineH = 19;
      var hunkH = 18;
      var inline = COMMENTS[0];
      var rowIdx = 0;
      for (var rj = 0; rj < DIFF.lines.length; rj++) {
        if (DIFF.lines[rj].n === inline.line) rowIdx = rj;
      }
      var insertH = 72; // reserved space for the inline comment thread
      var diffH = hunkH + DIFF.lines.length * lineH + insertH + 14;
      fillRR(ctx, bx, by, bw2, diffH, 10, "#0a0a11");
      strokeRR(ctx, bx + 0.5, by + 0.5, bw2 - 1, diffH - 1, 10, C.panelStroke, 1);
      // hunk header
      txt(ctx, DIFF.hunk, bx + 12, by + 13, {
        font: FONT_MONO,
        size: 10.5,
        fill: C.dimmer,
      });
      var ly = by + hunkH + 4;
      for (var i = 0; i < DIFF.lines.length; i++) {
        var ln = DIFF.lines[i];
        var yRow = ly + i * lineH + (i > rowIdx ? insertH : 0);
        if (ln.k === "add") {
          fillRR(ctx, bx + 1, yRow - 1, bw2 - 2, lineH, 0, "rgba(74,222,128,0.06)");
        }
        txt(ctx, String(ln.n), bx + 12, yRow + 12, {
          font: FONT_MONO,
          size: 10.5,
          fill: C.dimmer,
        });
        txt(ctx, (ln.k === "add" ? "+" : " ") + ln.code, bx + 40, yRow + 12, {
          font: FONT_MONO,
          size: 11.5,
          fill: ln.k === "add" ? "#c7f0d6" : C.soft,
        });
      }
      ctx.globalAlpha = 1;

      // inline critical comment, inserted right after its line
      var cA = appear(t, inline.t, 0.4);
      if (cA > 0) {
        var cyt =
          ly + rowIdx * lineH + lineH + 4 +
          (1 - easeOut(clamp((t - inline.t) / 0.4, 0, 1))) * 10;
        var cardX = bx + 56;
        var cardW = bw2 - 68;
        var cardH = 60;
        ctx.globalAlpha = cA;
        fillRR(ctx, cardX, cyt, cardW, cardH, 10, "rgba(255,107,107,0.08)");
        strokeRR(ctx, cardX + 0.5, cyt + 0.5, cardW - 1, cardH - 1, 10, "rgba(255,107,107,0.45)", 1);
        drawCommentBody(ctx, inline, cardX + 12, cyt + 8, cardW - 24, cardH - 16, true);
        ctx.globalAlpha = 1;
      }
      diffBottom = by + diffH;
    }

    // other findings list
    var listY = diffBottom + 16;
    for (var ci = 1; ci < COMMENTS.length; ci++) {
      var cm = COMMENTS[ci];
      var ca = appear(t, cm.t, 0.4);
      if (ca <= 0) continue;
      ctx.globalAlpha = ca;
      var ry = listY + (ci - 1) * 34 + (1 - easeOut(clamp((t - cm.t) / 0.4, 0, 1))) * 8;
      var sc = SEV[cm.severity];
      dot(ctx, x + 7, ry + 9, 4, sc.c);
      txt(ctx, cm.path + ":" + cm.line, x + 20, ry + 12, {
        font: FONT_MONO,
        size: 10.5,
        fill: C.dimmer,
      });
      clipText(ctx, cm.title, x + 20, ry + 28, w - 20, {
        size: 12.5,
        weight: 500,
        fill: C.soft,
      });
      ctx.globalAlpha = 1;
    }

    // summary card (anchored to bottom)
    var summaryH = 104;
    var sy2 = RP.y + RP.h - 16 - summaryH;
    var sa = appear(t, T.summary, 0.5);
    if (sa > 0) {
      ctx.globalAlpha = sa;
      var oy2 = (1 - easeOut(clamp((t - T.summary) / 0.5, 0, 1))) * 10;
      fillRR(ctx, x, sy2 + oy2, w, summaryH, 12, "rgba(124,92,245,0.08)");
      strokeRR(ctx, x + 0.5, sy2 + oy2 + 0.5, w - 1, summaryH - 1, 12, "rgba(167,139,250,0.35)", 1);
      txt(ctx, "🧙", x + 14, sy2 + oy2 + 26, { size: 15 });
      txt(ctx, "PR Sage Review", x + 40, sy2 + oy2 + 26, {
        size: 13.5,
        weight: 700,
        fill: C.text,
      });
      txt(ctx, "Request changes", x + w - 14, sy2 + oy2 + 26, {
        size: 11.5,
        weight: 700,
        fill: "#fda4af",
        align: "right",
      });
      clipText(
        ctx,
        "Solid feature overall, but the raw SQL built from user input must be parameterized before merge.",
        x + 14,
        sy2 + oy2 + 48,
        w - 28,
        { size: 12.5, fill: C.soft }
      );
      // counts
      var countX = x + 14;
      var counts = [
        { s: "critical", n: 1 },
        { s: "warning", n: 1 },
        { s: "suggestion", n: 1 },
        { s: "praise", n: 1 },
      ];
      for (var ki = 0; ki < counts.length; ki++) {
        var sc2 = SEV[counts[ki].s];
        countX +=
          chip(ctx, counts[ki].n + " " + counts[ki].s, countX, sy2 + oy2 + 60, {
            fill: sc2.bg,
            color: sc2.c,
            size: 10,
            pad: 8,
            h: 18,
          }) + 6;
      }
      txt(ctx, "Reviewed by PR Sage · powered by Vercel AI Gateway", x + 14, sy2 + oy2 + 94, {
        size: 10.5,
        fill: C.dimmer,
      });
      var link = "View on GitHub →";
      txt(ctx, link, x + w - 14, sy2 + oy2 + 94, {
        size: 10.5,
        weight: 600,
        fill: C.accent2,
        align: "right",
      });
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawCommentBody(ctx, cm, x, y, w, h, inline) {
    var sc = SEV[cm.severity];
    var cx = chip(ctx, sc.label, x, y, {
      fill: sc.bg,
      color: sc.c,
      size: 9.5,
      pad: 7,
      h: 16,
    });
    clipText(ctx, cm.title, x + cx + 8, y + 12, w - cx - 8, {
      size: 12,
      weight: 600,
      fill: C.text,
    });
    // body snippet
    var bodyLines = wrapLines(ctx, cm.body, FONT_UI, 11.5, 400, w);
    for (var i = 0; i < Math.min(bodyLines.length, inline ? 2 : 1); i++) {
      txt(ctx, bodyLines[i], x, y + 30 + i * 15, {
        size: 11.5,
        fill: C.dim,
      });
    }
  }

  // --------------------------------------------------------------- top level
  function draw(ctx, t) {
    ctx.clearRect(0, 0, W, H);
    drawFrame(ctx, t);
    drawAgentPanel(ctx, t);
    drawPrPanel(ctx, t);
  }

  function createRenderer(ctx) {
    return {
      render: function (t) {
        draw(ctx, t);
      },
    };
  }

  global.PRSage = {
    W: W,
    H: H,
    DURATION: DURATION,
    STAGES: STAGES,
    PR: PR,
    COMMENTS: COMMENTS,
    createRenderer: createRenderer,
  };
})(typeof window !== "undefined" ? window : this);
