/**
 * The second half of the page script (see client.ts): painting tickets, the message line, Now, the run line, the keys
 * and the live connection. It closes the function client-start.ts opens.
 */
export const CLIENT_END = String.raw`  function paint(t, place, instant) {
    var c = cardFor(t), open = openId === t.number;
    var was = c.dataset.station;
    c.className = "card " + t.station + (open ? " open" : "");
    c.dataset.station = t.station;
    c.setAttribute("aria-expanded", String(open));
    c.querySelector(".name").textContent = t.title;
    // No step for 30 minutes (a stopped or crashed agent): say so instead of looking busy.
    var quiet = (t.station === "working" || t.station === "checking") && t.finishedAt && Date.now() - new Date(t.finishedAt).getTime() > 30 * 60000;
    var paused = t.trouble && (t.station === "working" || t.station === "checking");
    var step = c.querySelector(".step"), text = paused ? troubleLine(t.trouble) : quiet ? "Quiet since " + hhmm(t.finishedAt) : t.station === "checking" ? "Checking: " + (t.step || "") : t.step || "Starting";
    c.classList.toggle("quiet", Boolean(quiet || paused));
    if (step.textContent !== text) { step.textContent = text; if (!instant) restart(step, "in"); }
    var code = c.querySelector(".code"), want = t.station === "done" || t.station === "skipped" ? codeOf(t) : "";
    if (want && !code) { code = el("span", "code"); c.append(code); }
    if (code) { code.textContent = want; code.hidden = !want; }
    var top = c.querySelector(".top"), check = top.querySelector(".check");
    if (t.station === "done" && !check) {
      top.insertAdjacentHTML("afterbegin", '<svg class="check" viewBox="0 0 16 16" aria-label="done"><path d="M3 8.5l3.2 3L13 4.5"/></svg>');
      if (!instant && was && was !== "done") top.querySelector(".check").classList.add("draw");
    } else if (t.station !== "done" && check) check.remove();
    var inner = c.querySelector(".detail-in");
    inner.textContent = "";
    if (open) inner.append(detailFor(t, place));
  }

  /** The message line: the state of the run in one plain sentence. */
  /** Trouble in plain words, with the reset time and how long until it for a usage limit. */
  var WHY = { usage_limit: "Paused: usage limit", connection: "Waiting on Claude: connection trouble", login: "Logged out: run /login in Claude Code", api: "Stopped: an API error" };
  function troubleLine(tr) {
    var line = (WHY[tr.reason] || WHY.api) + " since " + hhmm(tr.since);
    if (tr.resetsAt) {
      var mins = Math.round((new Date(tr.resetsAt).getTime() - Date.now()) / 60000);
      // Once the reset has passed, an interactive session waits for the person: say so instead of promising.
      line += mins > 0
        ? " · resets " + hhmm(tr.resetsAt) + " (in " + (mins >= 60 ? Math.floor(mins / 60) + " h " : "") + (mins % 60) + " min)"
        : " · reset passed at " + hhmm(tr.resetsAt) + ": send a message to continue";
    }
    return line;
  }

  function messageFor(view) {
    var alert = view.alerts && view.alerts[0];
    if (alert) {
      var waiting = alert.reason === "usage_limit" && alert.resetsAt && new Date(alert.resetsAt).getTime() > Date.now();
      return troubleLine(alert) + (waiting ? ". Nothing is lost; it can continue after the reset." : ".");
    }
    var run = view.run;
    if (!run) return "No pipeline in this project. Sessions show under Now.";
    var c = run.columns, busy = c.working.concat(c.checking).map(function (t) { return "#" + t.number; });
    var total = c.done.length + c.queued.length + busy.length;
    var parts = [busy.length ? busy.join(", ") + " in progress" : c.queued.length ? "Waiting for an agent" : "Run finished"];
    parts.push(c.done.length + " of " + total + " done");
    if (c.skipped.length) parts.push(c.skipped.length + " skipped");
    if (run.lastAt) parts.push("last change " + hhmm(run.lastAt));
    return parts.join(" · ");
  }

  /** A short result code, like a job status on a mainframe console. */
  function codeOf(t) {
    var map = { merged: "MRG", "partial-merged": "PART", "plan-posted": "PLAN", "draft-posted": "DRFT" };
    if (t.station === "skipped") return "[SKIP]";
    return "[" + (map[t.status] || (t.status || "done").slice(0, 4).toUpperCase()) + "]";
  }

  function render(view, instant) {
    if (!built) build();
    last = view;
    document.title = "Night Shift · " + view.project;
    var where = root.querySelector(".where");
    where.textContent = "";
    [["REPO", view.repo], ["FOLDER", view.folder], ["BRANCH", view.branch]].forEach(function (f) {
      if (!f[1]) return;
      var field = el("span", "field");
      field.append(el("b", null, f[0]), " " + f[1]);
      where.append(field);
    });
    var message = root.querySelector(".message");
    message.textContent = messageFor(view);
    message.classList.toggle("alert", Boolean(view.alerts && view.alerts.length));
    var active = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".card") : null;
    var keep = active ? Number(active.dataset.num) : null;
    var before = new Map();
    cards.forEach(function (c, n) { before.set(n, c.getBoundingClientRect()); });
    var seen = new Set(), cols = view.run ? view.run.columns : null;
    STATIONS.forEach(function (s) {
      var list = cols ? cols[s[0]] : [];
      list.forEach(function (t, i) {
        seen.add(t.number);
        paint(t, i + 1, instant);
        var c = cardFor(t);
        if (lists[s[0]].children[i] !== c) lists[s[0]].insertBefore(c, lists[s[0]].children[i] || null);
      });
      var n = String(list.length);
      if (counts[s[0]].textContent !== n) { counts[s[0]].textContent = n; if (!instant) restart(counts[s[0]], "roll"); }
    });
    cards.forEach(function (c, n) { if (!seen.has(n)) { c.remove(); cards.delete(n); } });
    if (!instant) cards.forEach(function (c, n) {
      var a = before.get(n);
      if (!a || !a.width) return;
      var b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: Math.abs(dx) > 20 ? 700 : 450, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    if (keep !== null && cards.get(keep) && document.activeElement !== cards.get(keep)) cards.get(keep).focus({ preventScroll: true });
    root.querySelectorAll(".col").forEach(fade);
    renderNow(view.now);
    renderNight(view);
  }

  function renderNow(rows) {
    var now = root.querySelector(".now");
    now.textContent = "";
    now.append(el("span", "frame-title", "NOW"));
    if (!rows.length) { now.append(el("div", "agent", "Nothing running right now.")); return; }
    rows.forEach(function (r, i) {
      var a = el("div", "agent");
      var what = el("div", "what", "> " + r.what);
      a.append(el("div", "who", r.who + (r.at ? " · " + hhmm(r.at) : "")), what);
      now.append(a);
    });
  }

  function renderNight(view) {
    var run = view.run, start = run && run.startedAt ? new Date(run.startedAt).getTime() : null;
    var nowMs = Date.now(), end = start ? Math.max(nowMs, start + 3600e3) : nowMs;
    root.querySelector(".clock").textContent = hhmm(new Date(nowMs).toISOString());
    root.querySelector(".date").textContent = new Date(nowMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    var done = run ? run.columns.done.length : 0, total = run ? done + run.columns.queued.length + run.columns.working.length + run.columns.checking.length : 0;
    var mins = start ? Math.round((nowMs - start) / 60000) : 0;
    var cells = 32, filled = total ? Math.round((done / total) * cells) : 0;
    root.querySelector(".meter").textContent = start ? "[" + "█".repeat(filled) + "░".repeat(cells - filled) + "] " + done + "/" + total + " done" : "";
    root.querySelector(".so-far").textContent = start
      ? "started " + hhmm(run.startedAt) + " · " + Math.floor(mins / 60) + "h " + String(mins % 60).padStart(2, "0") + "m so far"
      : "No pipeline running in this project";
    var pct = function (ms) { return start ? Math.min(100, Math.max(0, ((ms - start) / (end - start)) * 100)) + "%" : "0%"; };
    root.querySelector(".fill").style.width = pct(nowMs);
    var track = root.querySelector(".track"), hours = root.querySelector(".hours");
    track.querySelectorAll(".tick").forEach(function (t) { t.remove(); });
    hours.textContent = "";
    if (start) {
      var h = new Date(start); h.setMinutes(0, 0, 0);
      for (var t = h.getTime() + 3600e3; t < end; t += 3600e3) {
        var k = el("span", "tick"); k.style.left = pct(t); track.append(k);
        var l = el("span", null, hhmm(new Date(t).toISOString())); l.style.left = pct(t); hours.append(l);
      }
    }
    var keep = new Set();
    (run ? run.columns.done : []).forEach(function (t) {
      if (!t.finishedAt) return;
      keep.add(String(t.number));
      var dot = track.querySelector('[data-t="' + t.number + '"]');
      if (!dot) { dot = el("span", "landed pop"); dot.dataset.t = String(t.number); track.append(dot); }
      dot.style.left = pct(new Date(t.finishedAt).getTime());
      dot.title = "#" + t.number + " done at " + hhmm(t.finishedAt);
    });
    track.querySelectorAll(".landed").forEach(function (d) { if (!keep.has(d.dataset.t)) d.remove(); });
  }

  // ---- the keys in the bar at the foot: arrows move between tickets, Enter opens (on the card), Esc closes ----
  document.addEventListener("keydown", function (e) {
    var arrows = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (e.key === "Escape" && openId !== null) { openId = null; if (last) render(last, true); return; }
    if (arrows.indexOf(e.key) < 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return; // leave Back, Cmd+arrow alone
    var c = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".card") : null;
    var first = root.querySelector(".card");
    // With nothing focused, the first arrow focuses the first ticket; anywhere else (a link, a field) arrows stay normal.
    if (!c) { if (first && document.activeElement === document.body) { e.preventDefault(); first.focus(); } return; }
    var list = c.parentElement, i = Array.prototype.indexOf.call(list.children, c);
    var cols = Array.prototype.slice.call(root.querySelectorAll(".list")), ci = cols.indexOf(list), target = null;
    if (e.key === "ArrowDown") target = list.children[i + 1];
    else if (e.key === "ArrowUp") target = list.children[i - 1];
    else {
      var dir = e.key === "ArrowRight" ? 1 : -1;
      for (var k = ci + dir; k >= 0 && k < cols.length && !target; k += dir) {
        if (cols[k].children.length) target = cols[k].children[Math.min(i, cols[k].children.length - 1)];
      }
    }
    e.preventDefault();
    if (target) { target.focus(); target.scrollIntoView({ block: "nearest" }); }
  });

  // ---- the live connection ----
  var source = new EventSource("/events?project=" + encodeURIComponent(project));
  source.addEventListener("projects", function (e) { renderProjects(JSON.parse(e.data)); });
  source.addEventListener("board", function (e) { render(JSON.parse(e.data), !last); });
  function connection(live) {
    var c = root.querySelector(".conn");
    if (!c) return;
    c.querySelector(".conn-text").textContent = live ? "LIVE" : "RECONNECTING…";
    c.classList.toggle("off", !live);
  }
  source.onopen = function () { connection(true); };
  source.onerror = function () { connection(false); };
  setInterval(function () { if (last) renderNight(last); }, 15000);
})();
`;
