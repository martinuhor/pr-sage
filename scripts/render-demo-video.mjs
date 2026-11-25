#!/usr/bin/env node
/**
 * Renders docs/index.html frame-by-frame and encodes docs/demo.mp4.
 *
 * Why not puppeteer? This repo deploys to Vercel, and a Chromium/ffmpeg
 * download would slow (and can break) the build. So the script talks to the
 * Chrome you already have over the DevTools Protocol using Node's built-in
 * WebSocket, and shells out to a system ffmpeg.
 *
 * Requirements:
 *   - Google Chrome (or Chromium / Edge / Brave) installed
 *   - ffmpeg on PATH, or FFMPEG_PATH=/path/to/ffmpeg
 *
 * Usage:
 *   node scripts/render-demo-video.mjs
 *   node scripts/render-demo-video.mjs --fps 30 --hold 1 --out docs/demo.mp4
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");

// ------------------------------------------------------------------- args
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FPS = Number(arg("fps", 30));
const HOLD = Number(arg("hold", 1.0)); // extra seconds on the final frame
const OUT = path.resolve(ROOT, arg("out", "docs/demo.mp4"));
const POSTER_AT = Number(arg("poster-at", 17.6));
const VIEW = { width: 1400, height: 860 }; // makes room for the 1280x720 stage
const DEBUG_PORT = Number(arg("port", 9222));

// ------------------------------------------------------------ find chrome
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Chrome not found. Set CHROME_PATH=/path/to/chrome");
}

// ------------------------------------------------------------ find ffmpeg
function findFfmpeg() {
  const probes = [];
  if (process.env.FFMPEG_PATH) probes.push(process.env.FFMPEG_PATH);
  try {
    // optional: only used if the user happens to have it installed
    const p = require("ffmpeg-static");
    if (typeof p === "string" && fs.existsSync(p)) probes.push(p);
  } catch {
    /* not installed — fall through to PATH */
  }
  const which = spawnSync("which", ["ffmpeg"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) probes.push(which.stdout.trim());

  for (const bin of probes) {
    const v = spawnSync(bin, ["-version"], { encoding: "utf8" });
    if (v.status === 0) return bin;
  }
  throw new Error(
    "ffmpeg not found. Install it (macOS: `brew install ffmpeg`) or set FFMPEG_PATH=/path/to/ffmpeg"
  );
}

// ---------------------------------------------------------------- cdp peer
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((resolve) => {
      const fn = (p) => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((f) => f !== fn));
        resolve(p);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error("page error: " + (r.exceptionDetails.exception?.description || "unknown"));
    }
    return r.result?.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

/** CSS that strips the page down to just the 1280x720 stage at the origin. */
const STAGE_ONLY_CSS = `
  canvas#stage{width:1280px !important;height:720px !important;border-radius:0 !important}
  .wrap{max-width:none!important;padding:0!important}
  nav.top,.hero,.sec-head,.controls,.stages,section#app,section#how,section#video,footer{display:none!important}
  body{background:#07070a!important}
  .demo-card{border:0!important;border-radius:0!important;box-shadow:none!important;background:#07070a!important}
  .stage-wrap{padding:0!important;background:#07070a!important}
  section{padding:0!important}
`;

async function main() {
  const chromePath = findChrome();
  const ffmpeg = findFfmpeg();
  const pageUrl =
    "file://" + encodeURI(path.join(DOCS, "index.html")) + "?t=0&embed=1";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prsage-video-"));
  const frames = path.join(tmp, "frames");
  const profile = path.join(tmp, "chrome-profile");
  fs.mkdirSync(frames, { recursive: true });

  console.log("chrome :", chromePath);
  console.log("ffmpeg :", ffmpeg);

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--force-device-scale-factor=1",
      `--window-size=${VIEW.width},${VIEW.height}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let cdp;
  try {
    await waitForDevTools(DEBUG_PORT);

    const tab = await (
      await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" })
    ).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    cdp = new CDP(ws);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: VIEW.width,
      height: VIEW.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: pageUrl });
    await loaded;

    // strip the page down to the bare stage
    await cdp.eval(`(() => {
      const s = document.createElement('style');
      s.textContent = ${JSON.stringify(STAGE_ONLY_CSS)};
      document.head.appendChild(s);
      return true;
    })()`);

    const ready = await cdp.eval("typeof window.__seek === 'function' && !!window.PRSage");
    if (!ready) throw new Error("stage scripts didn't initialise (window.__seek missing)");

    const DURATION = await cdp.eval("window.PRSage.DURATION");
    const box = await cdp.eval(
      "JSON.stringify(document.getElementById('stage').getBoundingClientRect())"
    );
    const rect = JSON.parse(box);
    console.log("stage  :", `${rect.width}x${rect.height} @ ${rect.x},${rect.y}`);

    const clip = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    const total = Math.round((DURATION + HOLD) * FPS);
    console.log(`frames : ${total} @ ${FPS}fps (${DURATION}s + ${HOLD}s hold)`);

    for (let i = 0; i < total; i++) {
      const t = Math.min(i / FPS, DURATION);
      await cdp.eval(
        `new Promise(r => {
           window.__seek(${t});
           requestAnimationFrame(() => requestAnimationFrame(() => r(true)));
         })`,
        true
      );
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        clip,
      });
      fs.writeFileSync(
        path.join(frames, "f_" + String(i + 1).padStart(4, "0") + ".png"),
        Buffer.from(shot.data, "base64")
      );
      if (i % 60 === 0) process.stdout.write(` ${i}`);
    }
    process.stdout.write("\n");

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    spawnSync(
      ffmpeg,
      [
        "-y",
        "-framerate", String(FPS),
        "-i", path.join(frames, "f_%04d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "18",
        "-movflags", "+faststart",
        OUT,
      ],
      { stdio: "inherit" }
    );

    spawnSync(
      ffmpeg,
      [
        "-y",
        "-i", OUT,
        "-ss", String(POSTER_AT),
        "-frames:v", "1",
        "-update", "1",
        path.join(DOCS, "assets", "poster.png"),
      ],
      { stdio: "inherit" }
    );

    console.log("done   :", path.relative(ROOT, OUT));
  } finally {
    try {
      if (cdp) await cdp.send("Browser.close");
    } catch {
      /* already gone */
    }
    chrome.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("render failed:", err.message);
  process.exit(1);
});
