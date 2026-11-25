/* PR Sage — interactive review app.
 *
 * This is the real app's /review surface (ReviewChat + CommentCard +
 * StatusBadge) rebuilt for the static site: you pick a pull request, hit
 * "Start AI Review", and the webhook → tool loop → inline review flow plays
 * out in the browser. The agent's replies are scripted rather than model
 * generated, because GitHub Pages has no server to run streamText on — but
 * everything else (the inputs, the streaming log, the collapsible comment
 * cards, the verdict) is real and driven by your clicks.
 */
(function () {
  "use strict";

  var root = document.getElementById("prSageApp");
  if (!root) return;

  // ------------------------------------------------------------- icons
  var I = {
    alertCircle:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>',
    alertTriangle:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14c.6-1 1-2.2 1-3.5a4.1 4.1 0 1 0-8.2 0c0 1.3 .4 2.5 1 3.5"/></svg>',
    thumbsUp:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M7 10l4.2-7.4A1.6 1.6 0 0 1 14 3.4V9h5.3a2 2 0 0 1 2 2.4l-1.3 7A2 2 0 0 1 18 20H7"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    sparkles:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z"/><path d="M18.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
    pr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M6 8.6v6.8"/><path d="M18 15.4V9.5a3.5 3.5 0 0 0-3.5-3.5H10"/><path d="m12.5 3.5-2.5 2.5 2.5 2.5"/></svg>',
    spinner:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
    upload:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></svg>',
    loader:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>'
  };

  var SEV = {
    critical: { color: "#ff6b6b", bg: "rgba(255,107,107,.10)", bd: "rgba(255,107,107,.34)", icon: I.alertCircle },
    warning: { color: "#ffb454", bg: "rgba(255,180,84,.10)", bd: "rgba(255,180,84,.32)", icon: I.alertTriangle },
    suggestion: { color: "#5eb0ff", bg: "rgba(94,176,255,.10)", bd: "rgba(94,176,255,.30)", icon: I.bulb },
    praise: { color: "#4ade80", bg: "rgba(74,222,128,.10)", bd: "rgba(74,222,128,.30)", icon: I.thumbsUp }
  };

  var STATUS = {
    analyzing: { label: "Analyzing", cls: "st-analyzing", icon: I.search },
    reviewing: { label: "Reviewing", cls: "st-reviewing", icon: I.loader },
    posting: { label: "Posting", cls: "st-posting", icon: I.upload },
    done: { label: "Done", cls: "st-done", icon: I.check }
  };

  var VERDICT = {
    "request changes": "v-req",
    comment: "v-cmt",
    approve: "v-ok"
  };

  // ------------------------------------------------------------ scenarios
  var SAMPLES = [
    {
      id: "acme/api#4821",
      owner: "acme",
      repo: "api",
      pr: 4821,
      title: "feat: add user search endpoint",
      head: "feat/user-search",
      base: "main",
      files: 3,
      add: 84,
      del: 12,
      verdict: "request changes",
      diff: {
        file: "src/db/query.ts",
        hunk: "@@ -37,6 +37,9 @@ export async function searchUsers(q: string)",
        lines: [
          { n: 38, k: "ctx", code: "export async function searchUsers(q: string) {" },
          { n: 39, k: "ctx", code: "  const db = await getDb();" },
          { n: 40, k: "add", code: "  const sql = `SELECT * FROM users WHERE name LIKE '%${q}%'`;" },
          { n: 41, k: "add", code: "  const rows = await db.raw(sql);" },
          { n: 42, k: "add", code: "  return rows.map(toUser);" },
          { n: 43, k: "ctx", code: "}" }
        ]
      },
      comments: [
        {
          severity: "critical",
          path: "src/db/query.ts",
          line: 40,
          inline: true,
          title: "SQL injection via string interpolation",
          body:
            "`q` is interpolated straight into the SQL string, so `%' OR 1=1 --` returns every row in the table.\n\n" +
            "Use a parameterized query:\n\n" +
            '  db.raw("SELECT * FROM users WHERE name LIKE ?", [`%${q}%`])'
        },
        {
          severity: "warning",
          path: "src/api/users.ts",
          line: 18,
          title: "Public endpoint has no rate limiting",
          body:
            "`GET /users/search` is unauthenticated and unbounded, so a single client can walk the table.\n\n" +
            "Add a per-IP limit (30 req/min is plenty) and cap the length of `q` before it reaches the database."
        },
        {
          severity: "suggestion",
          path: "src/lib/auth.ts",
          line: 7,
          title: "Compare tokens with timingSafeEqual",
          body:
            "`a === b` short-circuits on the first differing byte, which leaks the token prefix over time.\n\n" +
            "  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))"
        },
        {
          severity: "praise",
          path: "src/api/users.ts",
          line: 31,
          title: "Nice zod validation on the query params",
          body:
            "Parsing `q` and `limit` through zod at the edge keeps the handler honest and gives you typed input for free. Clean."
        }
      ],
      scan:
        "Reading the diff: a new public search handler. The query is built by string interpolation — I need to check whether `q` is ever escaped upstream before it reaches the database.",
      summary:
        "One critical issue: the new search endpoint interpolates user input directly into SQL. That is an injection vector on a public route — parameterize it before this merges.\n\n" +
        "Also worth a pass: rate limiting on the endpoint, a constant-time token compare in auth, and the zod parsing on line 31 is a pattern worth keeping."
    },
    {
      id: "acme/web#1289",
      owner: "acme",
      repo: "web",
      pr: 1289,
      title: "perf: memoize the pricing table",
      head: "perf/pricing-memo",
      base: "main",
      files: 2,
      add: 41,
      del: 9,
      verdict: "comment",
      diff: {
        file: "src/components/PricingTable.tsx",
        hunk: "@@ -14,7 +14,12 @@ export function PricingTable({ plans }: Props) {",
        lines: [
          { n: 14, k: "ctx", code: '  const [sort, setSort] = useState<SortKey>("price");' },
          { n: 15, k: "del", code: "  const rows = plans.map(toRow).sort(byKey(sort));" },
          { n: 16, k: "add", code: "  const rows = useMemo(() => {" },
          { n: 17, k: "add", code: "    const next = plans.map(toRow);" },
          { n: 18, k: "add", code: "    next.sort(byKey(sort));" },
          { n: 19, k: "add", code: "    return next;" },
          { n: 20, k: "add", code: "  }, [plans]);" },
          { n: 21, k: "ctx", code: "" },
          { n: 22, k: "ctx", code: "  return <Table rows={rows} sort={sort} />;" }
        ]
      },
      comments: [
        {
          severity: "warning",
          path: "src/components/PricingTable.tsx",
          line: 20,
          inline: true,
          title: "Memo is keyed on `plans` identity",
          body:
            "If the parent rebuilds `plans` on every render — an inline literal, or a `.map()` in JSX — this memo never hits and you have added work instead of removing it.\n\n" +
            "Check the caller in `src/app/pricing/page.tsx`; it currently does exactly that. Memoize the array upstream, or key on stable data."
        },
        {
          severity: "suggestion",
          path: "src/components/PricingTable.tsx",
          line: 18,
          title: "Sort indices instead of rows",
          body:
            "`next.sort()` mutates `next`, which is safe because it is a fresh array. But `toRow` allocations dominate on large tables — for more than ~1k plans, sort an index array and map once."
        },
        {
          severity: "praise",
          path: "src/lib/format.ts",
          line: 12,
          title: "Extracting `byKey` keeps the comparator testable",
          body:
            "Pulling the comparator out of the component makes it unit-testable and reusable by the sort dropdown. Good call."
        }
      ],
      scan:
        "A memoization change. The hook is placed correctly, so the question is whether its dependency array actually stays referentially stable between renders — checking the caller next.",
      summary:
        "The memo is in the right place, but it only pays off when `plans` is referentially stable. The caller passes a freshly mapped array, so this render is currently a net loss.\n\n" +
        "Sorting is fine as written; for very large tables sort indices rather than allocating row objects on every comparison."
    },
    {
      id: "acme/jobs#204",
      owner: "acme",
      repo: "jobs",
      pr: 204,
      title: "fix: retry failed webhook deliveries",
      head: "fix/webhook-retry",
      base: "main",
      files: 4,
      add: 33,
      del: 6,
      verdict: "request changes",
      diff: {
        file: "src/queue/dispatch.ts",
        hunk: "@@ -52,6 +52,11 @@ export async function dispatch(job: Job, attempt = 1)",
        lines: [
          { n: 52, k: "ctx", code: "  const res = await fetch(job.url, { method: job.method, body: job.body });" },
          { n: 53, k: "del", code: "  await res.json();" },
          { n: 54, k: "add", code: "  if (!res.ok) {" },
          { n: 55, k: "add", code: "    throw new Error(`upstream responded ${res.status}`);" },
          { n: 56, k: "add", code: "  }" },
          { n: 57, k: "add", code: "  return res.json();" },
          { n: 58, k: "ctx", code: "}" }
        ]
      },
      comments: [
        {
          severity: "warning",
          path: "src/queue/dispatch.ts",
          line: 55,
          inline: true,
          title: "Throwing here will hammer the upstream",
          body:
            "A bare throw means the retry loop re-fires immediately. A ten second upstream outage becomes a self-inflicted retry storm.\n\n" +
            "Add exponential backoff with jitter and cap the attempts:\n\n" +
            "  const delay = Math.min(30_000, 2 ** attempt * 250) * (0.5 + Math.random());\n" +
            "  await sleep(delay);"
        },
        {
          severity: "warning",
          path: "src/queue/dispatch.ts",
          line: 57,
          title: "Guard the body read for 204 responses",
          body:
            "`res.json()` is right for a normal response, but a 204 or a redirect gives you an empty body and `JSON.parse` throws a SyntaxError that looks exactly like a delivery failure.\n\n" +
            "  return res.status === 204 ? null : res.json();"
        },
        {
          severity: "suggestion",
          path: "src/queue/dispatch.ts",
          line: 52,
          title: "fetch has no timeout",
          body:
            "Node's `fetch` will wait indefinitely without an AbortSignal, holding the worker slot until the function is killed.\n\n" +
            "  signal: AbortSignal.timeout(10_000)"
        },
        {
          severity: "praise",
          path: "src/queue/worker.ts",
          line: 44,
          title: "Attempts are now logged with the job id",
          body:
            "Threading `attempt` through makes retries observable in the logs — exactly what was missing when this incident started."
        }
      ],
      scan:
        "The ok-check is the right direction, but it changes the failure mode rather than fixing it. Checking what happens to the error after it is thrown — that determines whether this retry loop is safe.",
      summary:
        "The `res.ok` check is correct, but a bare throw re-fires with no backoff, so a short outage now amplifies into a retry storm.\n\n" +
        "Add exponential backoff with jitter, cap the attempts, give `fetch` a timeout, and guard the body read for 204s."
    }
  ];

  // --------------------------------------------------------------- utils
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function hunkStat(diff) {
    var a = 0;
    var d = 0;
    diff.lines.forEach(function (l) {
      if (l.k === "add") a++;
      else if (l.k === "del") d++;
    });
    return "+" + a + " −" + d;
  }

  // ------------------------------------------------------------- skeleton
  root.innerHTML =
    '<form class="app-form" id="appForm" autocomplete="off">' +
      '<div class="fld"><label for="appOwner">owner</label>' +
        '<input id="appOwner" spellcheck="false" /></div>' +
      '<span class="slash">/</span>' +
      '<div class="fld"><label for="appRepo">repo</label>' +
        '<input id="appRepo" spellcheck="false" /></div>' +
      '<div class="fld fld-pr"><label for="appPr">PR</label>' +
        '<input id="appPr" spellcheck="false" inputmode="numeric" /></div>' +
      '<button class="btn primary app-run" id="appRun" type="submit">' +
        I.sparkles + '<span id="appRunLabel">Start AI Review</span>' +
      '</button>' +
    '</form>' +
    '<div class="app-samples" id="appSamples"></div>' +
    '<div class="app-body">' +
      '<div class="pane pane-log">' +
        '<div class="pane-head"><span class="dot" id="logDot"></span>Agent activity' +
          '<span class="pane-meta" id="logMeta">idle</span></div>' +
        '<div class="log" id="appLog"></div>' +
      '</div>' +
      '<div class="pane pane-pr">' +
        '<div class="pr-scroll">' +
          '<div id="prHead"></div>' +
          '<div class="pr-empty" id="prEmpty">No review yet — start one to watch the agent work.</div>' +
          '<div class="diff" id="appDiff" hidden></div>' +
          '<div class="findings" id="appFindings" hidden></div>' +
          '<div id="appSummary"></div>' +
        '</div>' +
        '<div class="app-foot">' +
          '<button class="btn" id="appSkip" type="button" hidden>Skip to end</button>' +
          '<button class="btn" id="appAgain" type="button" hidden>Run another review</button>' +
          '<span class="app-foot-note" id="appFootNote"></span>' +
        '</div>' +
      '</div>' +
    '</div>';

  var el = {
    form: document.getElementById("appForm"),
    owner: document.getElementById("appOwner"),
    repo: document.getElementById("appRepo"),
    pr: document.getElementById("appPr"),
    run: document.getElementById("appRun"),
    runLabel: document.getElementById("appRunLabel"),
    samples: document.getElementById("appSamples"),
    log: document.getElementById("appLog"),
    logDot: document.getElementById("logDot"),
    logMeta: document.getElementById("logMeta"),
    head: document.getElementById("prHead"),
    empty: document.getElementById("prEmpty"),
    diff: document.getElementById("appDiff"),
    findings: document.getElementById("appFindings"),
    summary: document.getElementById("appSummary"),
    skip: document.getElementById("appSkip"),
    again: document.getElementById("appAgain"),
    note: document.getElementById("appFootNote")
  };

  var sample = 0;
  var s = SAMPLES[0];
  var run = null;
  var slots = {};
  var toolRows = {};

  // ---------------------------------------------------------- sample chips
  SAMPLES.forEach(function (sc, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "app-sample";
    b.textContent = sc.id;
    b.addEventListener("click", function () {
      load(i);
      start();
    });
    el.samples.appendChild(b);
  });

  function syncChips() {
    Array.prototype.forEach.call(el.samples.children, function (c, i) {
      var sc = SAMPLES[i];
      var matches =
        el.owner.value.trim() === sc.owner &&
        el.repo.value.trim() === sc.repo &&
        String(parseInt(el.pr.value, 10) || "") === String(sc.pr);
      c.classList.toggle("active", matches);
    });
  }

  function load(i) {
    sample = i;
    s = SAMPLES[i];
    stop();
    el.owner.value = s.owner;
    el.repo.value = s.repo;
    el.pr.value = String(s.pr);
    syncChips();
    renderHead();
  }

  [el.owner, el.repo, el.pr].forEach(function (input) {
    input.addEventListener("input", function () {
      syncChips();
      renderHead();
    });
  });

  // ------------------------------------------------------------ pr header
  function currentPR() {
    return {
      owner: el.owner.value.trim() || s.owner,
      repo: el.repo.value.trim() || s.repo,
      pr: parseInt(el.pr.value, 10) || s.pr
    };
  }

  var curStatus = null;
  var curProgress = "";

  function renderHead() {
    var p = currentPR();
    el.head.innerHTML =
      '<div class="pr-head-card">' +
        '<span class="pr-ic">' + I.pr + "</span>" +
        '<div class="pr-meta">' +
          '<p class="pr-title">' + esc(s.title) + "</p>" +
          '<p class="pr-sub">' + esc(p.owner + "/" + p.repo) + " <b>#" + p.pr + "</b>" +
            ' <span class="pr-branch">' + esc(s.head) + " → " + esc(s.base) + "</span></p>" +
        "</div>" +
        '<div class="pr-status">' + statusBadge(curStatus) + "</div>" +
      "</div>" +
      '<div class="pr-stats">' +
        '<span class="pr-files">' + s.files + " files changed</span>" +
        '<span class="pr-diffstat"><i class="add">+' + s.add + '</i><i class="del">−' + s.del + "</i></span>" +
        '<span class="pr-stat-chips" id="prStatChips"></span>' +
      "</div>";
    if (curProgress) {
      var pg = document.createElement("p");
      pg.className = "pr-progress" + (curStatus && curStatus !== "done" ? " live" : "");
      pg.innerHTML = '<span class="ptxt">' + esc(curProgress) + "</span>";
      el.head.appendChild(pg);
    }
    bumpStats();
  }

  function statusBadge(status) {
    if (!status) return '<span class="stbadge st-idle">Idle</span>';
    var st = STATUS[status];
    return '<span class="stbadge ' + st.cls + '">' + st.icon + st.label + "</span>";
  }

  function bumpStats() {
    var host = document.getElementById("prStatChips");
    if (!host) return;
    var counts = { critical: 0, warning: 0, total: 0 };
    s.comments.forEach(function (c) {
      if (visible[c.path + ":" + c.line] || c.shown) {
        counts.total++;
        counts[c.severity] = (counts[c.severity] || 0) + 1;
      }
    });
    var out = "";
    if (counts.critical) out += '<i class="c-crit">' + counts.critical + " critical</i>";
    if (counts.warning) out += '<i class="c-warn">' + counts.warning + " warning</i>";
    if (counts.total) out += '<i class="c-total">' + counts.total + " total</i>";
    host.innerHTML = out;
  }

  var visible = {};

  // ------------------------------------------------------------ comment UI
  function commentCard(c) {
    var v = SEV[c.severity];
    var open = c.severity === "critical" ? " open" : "";
    return (
      '<div class="cmt' + open + '" style="--c:' + v.color + ";--bg:" + v.bg + ";--bd:" + v.bd + '">' +
        '<button class="cmt-head" type="button">' +
          '<span class="cmt-ic">' + v.icon + "</span>" +
          '<span class="cmt-txt">' +
            '<span class="cmt-title">' + esc(c.title) + "</span>" +
            '<span class="cmt-loc">' + esc(c.path) + ":" + c.line + "</span>" +
          "</span>" +
          '<span class="cmt-chev">' + I.chevron + "</span>" +
        "</button>" +
        '<div class="cmt-body">' + esc(c.body) + "</div>" +
      "</div>"
    );
  }

  function wireCards(host) {
    Array.prototype.forEach.call(host.querySelectorAll(".cmt-head"), function (b) {
      if (b.dataset.wired) return;
      b.dataset.wired = "1";
      b.addEventListener("click", function () {
        b.parentNode.classList.toggle("open");
      });
    });
  }

  function placeComment(c) {
    c.shown = true;
    var key = c.path + ":" + c.line;
    visible[key] = true;
    var inline = c.inline && slots[c.line];
    var host = document.createElement("div");
    host.className = "cmt-slot";
    host.innerHTML = commentCard(c);
    wireCards(host);
    if (inline) {
      slots[c.line].appendChild(host);
    } else {
      el.findings.appendChild(host);
      el.findings.hidden = false;
    }
    bumpStats();
    scrollPR();
  }

  // ------------------------------------------------------------- diff pane
  function renderDiff() {
    var d = s.diff;
    var rows = "";
    d.lines.forEach(function (l) {
      rows +=
        '<div class="dl dl-' + l.k + '">' +
          '<span class="dl-n">' + (l.k === "add" ? "" : l.n) + "</span>" +
          '<span class="dl-s">' + (l.k === "add" ? "+" : l.k === "del" ? "−" : " ") + "</span>" +
          '<span class="dl-c">' + esc(l.code || " ") + "</span>" +
        "</div>";
      slots[l.n] = null;
    });
    el.diff.innerHTML =
      '<div class="diff-head"><span class="diff-path">' + esc(d.file) + "</span>" +
        '<span class="diff-stat">' + hunkStat(d) + "</span></div>" +
      '<div class="diff-hunk">' + esc(d.hunk) + "</div>" +
      '<div class="diff-rows">' + rows + "</div>";

    // one insertion slot after each row, so inline comments land in place
    var rowEls = el.diff.querySelectorAll(".dl");
    d.lines.forEach(function (l, i) {
      var slot = document.createElement("div");
      slot.className = "dl-ins";
      rowEls[i].parentNode.insertBefore(slot, rowEls[i].nextSibling);
      slots[l.n] = slot;
    });
    el.diff.hidden = false;
  }

  function renderSummary() {
    var p = currentPR();
    el.summary.innerHTML =
      '<div class="sum-card">' +
        '<div class="sum-head">' +
          '<span class="sum-ic">' + I.check + "</span>" +
          "<span>Review summary</span>" +
          '<span class="verdict ' + VERDICT[s.verdict] + '">' + s.verdict + "</span>" +
        "</div>" +
        '<p class="sum-body">' + esc(s.summary) + "</p>" +
        '<a class="sum-link" href="https://github.com/martinuhor/pr-sage" target="_blank" rel="noopener">' +
          "PR Sage reviews pull requests like this one automatically →</a>" +
      "</div>";
  }

  // ------------------------------------------------------------------ log
  function logRow(kind, label, html) {
    var row = document.createElement("div");
    row.className = "lg lg-" + kind;
    row.innerHTML = '<span class="tag">' + label + '</span><span class="body">' + html + "</span>";
    el.log.appendChild(row);
    scrollLog();
    return row;
  }

  function scrollLog() {
    el.log.scrollTop = el.log.scrollHeight;
  }
  function scrollPR() {
    var sc = root.querySelector(".pr-scroll");
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  function setStatus(status, progress) {
    curStatus = status;
    curProgress = progress || "";
    renderHead();
    var st = el.head.querySelector(".stbadge");
    if (st) st.classList.add("pop");
  }

  // --------------------------------------------------------------- engine
  function tool(name, arg, res, t0, t1) {
    return [
      { at: t0, k: "tool", phase: "call", name: name, arg: arg },
      { at: t1, k: "tool", phase: "result", name: name, res: res }
    ];
  }

  function buildTimeline(sc) {
    var p = currentPR();
    var ev = [];
    ev.push({
      at: 0.2,
      k: "http",
      method: "POST",
      path: "/api/webhook/github",
      note: "x-github-event: pull_request · action=opened"
    });
    ev.push({ at: 1.1, k: "auth", note: "HMAC-SHA256 signature verified" });
    ev.push({
      at: 1.6,
      k: "http",
      method: "POST",
      path: "/api/webhook/github",
      note: "review fired (fire-and-forget)",
      status: "202 Accepted"
    });
    ev.push({
      at: 2.4,
      k: "agent",
      label: "pull_request #" + p.pr,
      note: p.owner + "/" + p.repo,
      setStatus: "analyzing",
      progress: "Reading pull request #" + p.pr + "…"
    });
    ev.push({
      at: 2.75,
      k: "model",
      label: "anthropic/claude-sonnet-4-5",
      note: "ToolLoopAgent · AI Gateway"
    });
    ev = ev.concat(
      tool("fetch_pr_files", "{ pr: " + p.pr + " }",
        sc.files + " files · +" + sc.add + " −" + sc.del, 3.25, 4.45)
    );
    ev.push({ at: 4.45, k: "expand" });
    ev = ev.concat(
      tool("read_file_context", '{ path: "' + sc.diff.file + '" }', "142 lines of context", 4.9, 6.05)
    );
    ev.push({
      at: 6.2,
      k: "stream",
      text: sc.scan,
      setStatus: "reviewing",
      progress: "Scanning " + sc.files + " files for correctness, security, performance…"
    });

    var t = 8.8;
    sc.comments.forEach(function (c) {
      ev.push({ at: t, k: "comment", comment: c });
      t += 1.15;
    });

    ev = ev.concat(
      tool("post_review",
        '{ comments: ' + sc.comments.length + ', verdict: "' + sc.verdict + '" }',
        "review #" + p.pr + " posted to GitHub", t + 0.35, t + 1.35)
    );
    ev.push({
      at: t + 0.35,
      k: "status",
      setStatus: "posting",
      progress: "Posting " + sc.comments.length + " inline comments…"
    });
    ev.push({ at: t + 1.35, k: "summary" });
    ev.push({
      at: t + 1.75,
      k: "metrics",
      items: ["webhook.verified", "tool.fetch_pr_files", "tool.read_file_context", "review.posted"]
    });
    ev.push({ at: t + 2.55, k: "done", setStatus: "done", progress: "Review posted" });
    return ev.sort(function (a, b) {
      return a.at - b.at;
    });
  }

  function fire(e) {
    switch (e.k) {
      case "http":
        logRow("http", "HTTP",
          '<b class="m">' + e.method + "</b> " + esc(e.path) +
          '<span class="lgn">' + esc(e.note) + "</span>" +
          (e.status ? '<em class="ok">' + e.status + "</em>" : ""));
        break;
      case "auth":
        logRow("auth", "AUTH", '<span class="lgn">' + esc(e.note) + "</span>");
        break;
      case "agent":
        logRow("agent", "AGENT", "<b>" + esc(e.label) + "</b>" +
          '<span class="lgn">' + esc(e.note) + "</span>");
        break;
      case "model":
        logRow("model", "MODEL", '<b class="m">' + esc(e.label) + "</b>" +
          '<span class="lgn">' + esc(e.note) + "</span>");
        break;
      case "tool":
        if (e.phase === "call") {
          var r = logRow("tool", "TOOL",
            '<b class="m">' + esc(e.name) + "</b>" +
            '<span class="lgn">' + esc(e.arg) + "</span>" +
            '<span class="spin">' + I.spinner + "</span>");
          toolRows[e.name] = r;
        } else {
          var tr = toolRows[e.name];
          if (tr) {
            var spin = tr.querySelector(".spin");
            if (spin) spin.outerHTML = '<span class="res">' + I.check + "</span>";
            tr.querySelector(".body").insertAdjacentHTML("beforeend",
              '<span class="lgn res-txt">' + esc(e.res) + "</span>");
          }
        }
        break;
      case "stream": {
        var sr = logRow("stream", "STREAM", '<span class="stext s-cursor"></span>');
        typewrite(sr.querySelector(".stext"), e.text);
        break;
      }
      case "metrics":
        logRow("metrics", "METRIC",
          e.items.map(function (i) {
            return '<em class="mchip">' + esc(i) + "</em>";
          }).join(""));
        break;
      case "expand":
        renderDiff();
        el.empty.hidden = true;
        break;
      case "comment":
        placeComment(e.comment);
        break;
      case "summary":
        renderSummary();
        break;
      case "done":
        logRow("done", "DONE",
          '<b class="done-txt">' + I.check + " review complete</b>" +
          '<span class="lgn">' + s.comments.length + " comments · verdict: " + esc(s.verdict) + "</span>");
        break;
      case "status":
        break;
    }
    if (e.setStatus) setStatus(e.setStatus, e.progress);
  }

  var typer = null;
  function typewrite(node, text) {
    if (!node) return;
    var i = 0;
    typer = {
      node: node,
      text: text,
      iv: setInterval(function () {
        i += 2;
        node.textContent = text.slice(0, i);
        scrollLog();
        if (i >= text.length) finishTyper();
      }, 14)
    };
  }

  function finishTyper() {
    if (!typer) return;
    clearInterval(typer.iv);
    typer.node.textContent = typer.text;
    typer.node.classList.remove("s-cursor");
    typer = null;
  }

  function start() {
    if (!el.owner.value.trim()) el.owner.value = s.owner;
    if (!el.repo.value.trim()) el.repo.value = s.repo;
    if (!el.pr.value.trim()) el.pr.value = String(s.pr);
    reset();

    var events = buildTimeline(s);
    run = { events: events, idx: 0, t0: Date.now(), timer: null };

    el.run.disabled = true;
    el.runLabel.textContent = "Reviewing…";
    el.logDot.classList.add("live");
    el.logMeta.textContent = "running";
    el.skip.hidden = false;
    el.again.hidden = true;
    el.note.textContent = "streaming from the agent";

    setStatus("analyzing", "Connecting to the agent…");
    run.timer = setInterval(tick, 20);
  }

  function tick() {
    if (!run) return;
    var elapsed = (Date.now() - run.t0) / 1000;
    while (run.idx < run.events.length && run.events[run.idx].at <= elapsed) {
      fire(run.events[run.idx]);
      run.idx++;
    }
    if (run.idx >= run.events.length) endRun();
  }

  function flush() {
    if (!run) return;
    finishTyper();
    while (run.idx < run.events.length) {
      fire(run.events[run.idx]);
      run.idx++;
    }
    finishTyper();
    endRun();
  }

  function endRun() {
    if (!run) return;
    clearInterval(run.timer);
    run = null;
    el.run.disabled = false;
    el.runLabel.textContent = "Start AI Review";
    el.logDot.classList.remove("live");
    el.logMeta.textContent = "done";
    el.skip.hidden = true;
    el.again.hidden = false;
    el.note.textContent = "finished";
  }

  function stop() {
    if (run) {
      clearInterval(run.timer);
      run = null;
    }
    finishTyper();
  }

  function reset() {
    stop();
    el.log.innerHTML = "";
    el.diff.innerHTML = "";
    el.diff.hidden = true;
    el.findings.innerHTML = "";
    el.findings.hidden = true;
    el.summary.innerHTML = "";
    el.empty.hidden = false;
    slots = {};
    toolRows = {};
    visible = {};
    s.comments.forEach(function (c) {
      c.shown = false;
    });
    curStatus = null;
    curProgress = "";
    renderHead();
  }

  // -------------------------------------------------------------- events
  el.form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    start();
  });
  el.skip.addEventListener("click", flush);
  el.again.addEventListener("click", function () {
    reset();
    el.note.textContent = "ready";
  });

  // ---------------------------------------------------------------- init
  load(0);
})();
