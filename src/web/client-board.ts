/**
 * The second part of the page script (see client.ts): ticket cards, the assembly line, trouble in plain words and the
 * ticket dialog.
 */
export const CLIENT_BOARD = String.raw`  function cardFor(t) {
    var c = cards.get(t.number);
    if (c) return c;
    c = el("article", "card");
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.setAttribute("aria-haspopup", "dialog");
    var top = el("div", "top");
    top.append(el("span", "num", "#" + t.number), el("span", "code"));
    c.append(top, el("span", "clock"), el("div", "name"), el("div", "step"));
    c.addEventListener("click", function () { openTicket(t.number); });
    c.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTicket(t.number); }
    });
    c.addEventListener("animationend", function (e) { e.target.classList.remove("in"); });
    c.dataset.num = String(t.number);
    cards.set(t.number, c);
    return c;
  }

  function busy(t) { return t.station === "working" || t.station === "checking"; }
  // No step for 30 minutes (a stopped or crashed agent): say so instead of looking busy.
  function quietSince(t) { return busy(t) && t.finishedAt && Date.now() - new Date(t.finishedAt).getTime() > 30 * 60000; }
  function stepText(t) {
    if (t.trouble && busy(t)) return troubleLine(t.trouble);
    if (quietSince(t)) return "Quiet since " + hhmm(t.finishedAt);
    return (t.station === "checking" ? "Checking: " : "") + (t.step || "Starting");
  }

  function paint(t, instant) {
    var c = cardFor(t);
    c.className = "card " + t.station + (busy(t) && (t.trouble || quietSince(t)) ? " quiet" : "");
    c.dataset.station = t.station;
    c.querySelector(".name").textContent = t.title;
    c.querySelector(".code").textContent = busy(t) ? "" : codeOf(t);
    c.querySelector(".clock").dataset.since = busy(t) ? t.startedAt || "" : "";
    var step = c.querySelector(".step"), text = busy(t) ? stepText(t) : "";
    if (step.textContent !== text) { step.textContent = text; if (!instant && text) restart(step, "in"); }
    c.setAttribute("aria-label", "Ticket " + t.number + ": " + t.title + ", " + (busy(t) ? stepText(t) : t.station));
  }

  /** A short result code on a finished card, like a job status on a mainframe console. */
  function codeOf(t) {
    var map = { merged: "MRG", "partial-merged": "PART", "plan-posted": "PLAN", "draft-posted": "DRFT" };
    if (t.station === "queued") return "";
    if (t.station === "skipped") return "SKIP";
    var took = t.startedAt && t.finishedAt ? durationText(new Date(t.finishedAt) - new Date(t.startedAt)) : "";
    return (map[t.status] || (t.status || "done").slice(0, 4).toUpperCase()) + (took && took !== "–" ? " · " + took : "");
  }

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

  /** The assembly line: cards go to their station and slide there (FLIP); the station at work runs its belt. */
  function renderBoard(view, instant) {
    var active = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".card") : null;
    var keep = active ? Number(active.dataset.num) : null;
    var before = new Map();
    cards.forEach(function (c, n) { before.set(n, c.getBoundingClientRect()); });
    var seen = new Set(), columns = view.run ? view.run.columns : null;
    var lead = columns ? columns.working[0] || columns.checking[0] : null;
    var here = lead ? lead.station : null, hereAt = STATIONS.findIndex(function (s) { return s[0] === here; });
    STATIONS.forEach(function (s, si) {
      var list = columns ? columns[s[0]] : [];
      list.forEach(function (t, i) {
        seen.add(t.number);
        paint(t, instant);
        var c = cardFor(t);
        if (lists[s[0]].children[i] !== c) lists[s[0]].insertBefore(c, lists[s[0]].children[i] || null);
      });
      var n = String(list.length);
      if (counts[s[0]].textContent !== n) { counts[s[0]].textContent = n; if (!instant) restart(counts[s[0]], "roll"); }
      cols[s[0]].classList.toggle("here", s[0] === here);
      cols[s[0]].classList.toggle("paused", s[0] === here && Boolean(lead.trouble || quietSince(lead)));
      cols[s[0]].classList.toggle("passed", hereAt > 0 && si > 0 && si < hereAt);
    });
    cards.forEach(function (c, n) { if (!seen.has(n)) { c.remove(); cards.delete(n); } });
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!instant && !still) cards.forEach(function (c, n) {
      var a = before.get(n);
      if (!a || !a.width) return;
      var b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: Math.abs(dx) > 20 ? 800 : 450, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    if (keep !== null && cards.get(keep) && document.activeElement !== cards.get(keep)) cards.get(keep).focus({ preventScroll: true });
    if (!ui.panels.board.hidden) STATIONS.forEach(function (s) { fade(cols[s[0]]); });
  }

  function findTicket(n) {
    if (!last || !last.run) return null;
    var found = null;
    STATIONS.forEach(function (s) { last.run.columns[s[0]].forEach(function (t) { if (t.number === n) found = t; }); });
    return found;
  }

  /** A ticket opened in a dialog. Only an http(s) pull request address becomes a link. */
  function openTicket(n) {
    var t = findTicket(n);
    if (!t) return;
    var box = el("div", "dlg"), close = el("button", "close", "Close");
    close.type = "button";
    close.addEventListener("click", function () { ui.dialog.close(); });
    var title = el("h3", null, t.title);
    title.id = "dlg-title";
    var kind = busy(t) ? (t.trouble ? "warn" : "live") : t.station === "done" ? "done" : "";
    var pills = el("p");
    pills.append(el("span", "pill " + kind, t.status ? STATUS[t.status] || t.status : t.station));
    box.append(close, el("span", "eyebrow", "Ticket #" + t.number), title, pills);
    if (busy(t)) box.append(el("p", null, stepText(t)));
    if (t.summary) box.append(el("p", null, t.summary));
    var when = t.startedAt ? "Started " + hhmm(t.startedAt) : "Not started yet";
    if (t.startedAt && !busy(t) && t.finishedAt) when += " · finished " + hhmm(t.finishedAt) + " · " + durationText(new Date(t.finishedAt) - new Date(t.startedAt));
    if (t.steps) when += " · " + t.steps + " steps";
    box.append(el("p", "where", when));
    if (t.pr) {
      var p = el("p"), a = el(/^https?:\/\//.test(t.pr) ? "a" : "span", null, t.pr.indexOf("/pull/") > 0 ? "Pull request #" + t.pr.split("/").pop() : t.pr);
      if (a.tagName === "A") { a.href = t.pr; a.target = "_blank"; a.rel = "noreferrer"; }
      p.append(a);
      box.append(p);
    }
    if (t.recent && t.recent.length) {
      var ol = el("ol");
      t.recent.forEach(function (s) { ol.append(el("li", null, s)); });
      box.append(el("span", "eyebrow", "Latest steps"), ol);
    }
    ui.dialog.textContent = "";
    ui.dialog.append(box);
    if (!ui.dialog.open) ui.dialog.showModal();
    close.focus();
  }

`;
