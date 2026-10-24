/**
 * The last part of the page script (see client.ts): the header totals and NOW strip, the Terminal and Timeline tabs,
 * the keys, the clocks and the live connection. It closes the function client-start.ts opens.
 */
export const CLIENT_END = String.raw`  function renderTop(view) {
    document.title = "Night Shift · " + view.project;
    ui.title.textContent = "Night Shift · " + view.project;
    ui.where.textContent = [view.repo, view.folder, view.branch].filter(Boolean).join(" · ");
    var run = view.run, tot = run ? shiftTotals(run.columns) : null;
    ui.stats.done.value.textContent = tot ? tot.done + " / " + tot.total : "–";
    ui.stats.merged.value.textContent = tot ? String(tot.merged) : "–";
    ui.stats.skipped.value.textContent = tot ? String(tot.skipped) : "–";
    ui.stats.avg.value.textContent = tot ? durationText(tot.avgMs) : "–";
    var eta = tot ? finishEstimate(tot.avgMs, tot.left, Date.now()) : null;
    ui.stats.eta.value.textContent = eta ? hhmm(new Date(eta).toISOString()) : tot && tot.total && !tot.left ? "done" : "–";
    ui.stats.shift.value.dataset.since = run && run.startedAt ? run.startedAt : "";

    var alert = view.alerts && view.alerts[0], lead = run ? run.columns.working[0] || run.columns.checking[0] : null;
    var agents = view.agents || [], many = agentsWorking(agents), newest = agents.filter(function (a) { return a.active; })[0];
    ui.nowbar.className = "nowbar" + (alert ? " alert" : lead || view.now.length || many ? "" : " idle");
    ui.nowTag.textContent = alert ? "STOPPED" : !lead && !view.now.length && !many && tot && tot.total && !tot.left ? "DONE" : "NOW";
    ui.nowWhat.textContent = "";
    ui.nowStep.textContent = lead ? stepText(lead) : "";
    ui.nowClock.dataset.since = lead && lead.startedAt ? lead.startedAt : "";
    var also = many ? " · " + many : "";
    if (alert) {
      var waiting = alert.reason === "usage_limit" && alert.resetsAt && new Date(alert.resetsAt).getTime() > Date.now();
      ui.nowWhat.textContent = troubleLine(alert) + (waiting ? ". Nothing is lost; it can continue after the reset." : ".");
      if (lead) ui.nowStep.textContent = "#" + lead.number;
    } else if (lead) ui.nowWhat.append(el("span", "num", "#" + lead.number), " · " + lead.title + also);
    else if (view.now.length) ui.nowWhat.textContent = view.now[0].who + " · " + view.now[0].what + also;
    else if (newest) { ui.nowWhat.textContent = many + " · " + newest.name + ": " + (newest.step || "starting"); ui.nowClock.dataset.since = newest.startedAt || ""; }
    else if (tot && tot.total) ui.nowWhat.textContent = (tot.left ? "Waiting for an agent · " : "Run finished · ") + tot.done + " of " + tot.total + " done";
    else ui.nowWhat.textContent = "Nothing running in this project. Steps show here as soon as a session starts.";
  }

  // ---- Board tab: the background agents under the line ----
  function renderAgents(view) {
    var list = view.agents || [];
    ui.agents.hidden = !list.length;
    ui.agents.textContent = "";
    if (!list.length) return;
    var h = el("h2", null, "Background agents");
    h.append(el("span", "count", agentsWorking(list) || "all finished"));
    ui.agents.append(h);
    list.forEach(function (a) {
      var row = el("div", "agent" + (a.active ? " live" : "")), dot = el("span", "dot");
      var name = el("b", null, a.name + (a.worktree ? " (worktree)" : ""));
      row.append(dot, name, el("span", "step", a.active ? a.step || "Starting" : "finished " + hhmm(a.lastAt)), el("span", "when", hhmm(a.lastAt)));
      ui.agents.append(row);
    });
  }

  // ---- Terminal: one block per step, the running one marked ----
  var SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏", spinAt = 0, termKey = "";
  function buildTerminal(panel) {
    var w = el("div", "window"), bar = el("div", "titlebar");
    ui.wtabs = el("div", "titlebar-tabs");
    ui.wtabs.style.display = "flex";
    ui.wtabs.style.gap = "2px";
    ui.winClock = el("span", "clock");
    bar.append(ui.wtabs, ui.winClock);
    ui.blocks = el("div", "blocks");
    ui.blocks.setAttribute("role", "log");
    ui.blocks.setAttribute("aria-label", "What the agents are doing");
    var input = el("div", "inputbar");
    ui.inputText = el("span", "text");
    ui.inputChip = el("span", "chip");
    input.append(el("span", null, "❯"), ui.inputText, el("span", "cursor"), ui.inputChip);
    w.append(bar, ui.blocks, input);
    panel.append(w);
  }
  function block(time, who, cmd, running, where) {
    var b = el("div", "blk" + (running ? " run" : "")), meta = el("div", "meta"), state = el("span");
    if (running) { state.append(el("span", "spin", SPIN[0]), " running"); state.firstChild.dataset.spin = "1"; }
    else state.append(el("span", "ok", "✓"));
    meta.append(el("span", null, [time, who].filter(Boolean).join(" · ")), state);
    var prompt = el("div", "prompt");
    prompt.append(el("span", "cwd", where.folder || "~"), el("span", "br", where.branch || ""), el("span", "car", "❯"), el("span", "cmd", cmd));
    b.append(meta, prompt);
    return b;
  }
  function renderTerminal(view) {
    var run = view.run, live = run ? run.columns.working.concat(run.columns.checking) : [];
    var key = JSON.stringify([live.map(function (t) { return [t.number, t.recent, t.finishedAt]; }), view.now, (view.agents || []).map(function (a) { return [a.agentId, a.recent, a.active]; })]);
    ui.wtabs.textContent = "";
    var on = el("span", "wtab on");
    on.append(el("span", "dot"), live[0] ? "#" + live[0].number + " " + live[0].title.slice(0, 36) : view.project);
    ui.wtabs.append(on);
    (run ? run.columns.done.slice(-3).reverse() : []).forEach(function (t) { ui.wtabs.append(el("span", "wtab", "✓ #" + t.number)); });
    var latest = live[0] ? live[0].step : view.now[0] ? view.now[0].what : "";
    ui.inputText.textContent = latest || "waiting for the next step";
    ui.inputChip.textContent = live[0] ? "ticket #" + live[0].number + " · " + live[0].station : view.branch || "idle";
    if (key === termKey) return;
    termKey = key;
    var stick = ui.blocks.scrollHeight - ui.blocks.scrollTop - ui.blocks.clientHeight < 80;
    ui.blocks.textContent = "";
    var banner = el("div", "banner");
    banner.append(el("b", null, "Night Shift"), " · " + view.project + (view.branch ? " · " + view.branch : ""));
    ui.blocks.append(banner);
    live.forEach(function (t) {
      (t.recent || []).forEach(function (s, i, all) {
        var lastOne = i === all.length - 1;
        ui.blocks.append(block(lastOne ? hhmm(t.finishedAt) : "", "#" + t.number, s, lastOne && !t.trouble, view));
      });
    });
    view.now.forEach(function (r) { if (r.who.charAt(0) !== "#") ui.blocks.append(block(hhmm(r.at), r.who, r.what, true, view)); });
    (view.agents || []).forEach(function (a) {
      if (!a.active) return;
      (a.recent || []).forEach(function (st, i, all) {
        var lastOne = i === all.length - 1;
        ui.blocks.append(block(lastOne ? hhmm(a.lastAt) : "", a.name, st, lastOne, view));
      });
    });
    if (ui.blocks.children.length === 1) ui.blocks.append(el("div", "banner", "No steps yet. They show here as the agents work."));
    if (stick || !ui.blocks.dataset.seen) { ui.blocks.scrollTop = ui.blocks.scrollHeight; ui.blocks.dataset.seen = "1"; }
  }

  // ---- Timeline: one row per hour, a bar per ticket ----
  function buildTimeline(panel) {
    var box = el("div", "timeline"), head = el("div", "tl-head");
    head.append(el("h3", null, "Timeline"), el("span", "eyebrow", "one row per hour · tickets in the order they ran"));
    ui.tlSum = el("div", "tl-sum");
    ui.hours = el("div", "hours");
    var legend = el("div", "legend");
    [["var(--live)", "working"], ["var(--done)", "done"], ["var(--line-strong)", "skipped"]].forEach(function (k) {
      var s = el("span"), i = el("i");
      i.style.background = k[0];
      s.append(i, k[1]);
      legend.append(s);
    });
    box.append(head, ui.tlSum, ui.hours, legend);
    panel.append(box);
  }
  function renderTimeline(view) {
    var run = view.run, nowMs = Date.now();
    ui.hours.textContent = "";
    ui.tlSum.textContent = "";
    var agentSegs = agentSegments(view.agents || [], nowMs);
    if ((!run || !run.startedAt) && !agentSegs.length) { ui.hours.append(el("p", "empty", "No pipeline or background agent has run in this project yet.")); return; }
    var tot = run && run.startedAt ? shiftTotals(run.columns) : null, parts = [];
    var begin = Math.min.apply(null, agentSegs.map(function (g) { return g.from; }).concat(run && run.startedAt ? [new Date(run.startedAt).getTime()] : []));
    parts.push(["On shift", durationText(nowMs - begin)]);
    if (tot) parts.push(["Done", tot.done + " of " + tot.total], ["Average", durationText(tot.avgMs)]);
    if (agentSegs.length) parts.push(["Agents", agentsWorking(view.agents) || agentSegs.length + " finished"]);
    if (tot && tot.longest) parts.push(["Longest", "#" + tot.longest.number + " · " + durationText(tot.longest.ms)]);
    parts.forEach(function (p) { var s = el("span"); s.append(p[0] + " ", el("b", null, p[1])); ui.tlSum.append(s); });
    var headRow = el("div", "hr head"), marks = el("div");
    [":00", ":15", ":30", ":45"].forEach(function (m) { marks.append(el("span", null, m)); });
    headRow.append(el("span"), marks);
    ui.hours.append(headRow);
    hourRows(begin, nowMs, (run && run.startedAt ? segmentsOf(run.columns, nowMs) : []).concat(agentSegs)).forEach(function (r) {
      var row = el("div", "hr"), lane = el("div", "row");
      r.bars.forEach(function (b) {
        var bar = el("span", "bar " + b.kind, b.first && b.width > 5 ? b.label : "");
        bar.style.left = b.left + "%";
        bar.style.width = b.width + "%";
        bar.title = b.label;
        bar.addEventListener("click", function () { openTicket(b.num); });
        lane.append(bar);
      });
      if (r.nowAt !== null) { var line = el("span", "nowline"); line.style.left = r.nowAt + "%"; lane.append(line); }
      row.append(el("span", null, hhmm(new Date(r.at).toISOString())), lane);
      ui.hours.append(row);
    });
  }

  function render(view, instant) {
    if (!built) build();
    last = view;
    renderTop(view);
    renderBoard(view, instant);
    renderAgents(view);
    renderTerminal(view);
    if (!ui.panels.timeline.hidden) renderTimeline(view);
    tick();
  }

  // ---- the clocks: every second, from the start times the board already holds ----
  function tick() {
    if (!built) return;
    root.querySelectorAll("[data-since]").forEach(function (n) { n.textContent = n.dataset.since ? since(n.dataset.since) : n.closest(".stat") ? "–" : ""; });
    ui.winClock.textContent = new Date().toLocaleTimeString([], { hour12: false });
  }

  // ---- keys: arrows move between tickets, Enter opens (on the card), Esc closes the dialog ----
  document.addEventListener("keydown", function (e) {
    var arrows = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (arrows.indexOf(e.key) < 0 || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (ui.dialog && ui.dialog.open)) return;
    var c = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".card") : null;
    var first = root.querySelector(".card");
    // With nothing focused, the first arrow focuses the first ticket; anywhere else (a tab, a link) arrows stay normal.
    if (!c) { if (first && document.activeElement === document.body && !ui.panels.board.hidden) { e.preventDefault(); first.focus(); } return; }
    var list = c.parentElement, i = Array.prototype.indexOf.call(list.children, c);
    var all = Array.prototype.slice.call(root.querySelectorAll(".list")), ci = all.indexOf(list), target = null;
    if (e.key === "ArrowDown") target = list.children[i + 1];
    else if (e.key === "ArrowUp") target = list.children[i - 1];
    else {
      var dir = e.key === "ArrowRight" ? 1 : -1;
      for (var k = ci + dir; k >= 0 && k < all.length && !target; k += dir) {
        if (all[k].children.length) target = all[k].children[Math.min(i, all[k].children.length - 1)];
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
    if (!ui.conn) return;
    ui.connText.textContent = live ? "LIVE" : "RECONNECTING…";
    ui.conn.classList.toggle("off", !live);
    root.querySelector(".top").classList.toggle("off", !live);
  }
  source.onopen = function () { connection(true); };
  source.onerror = function () { connection(false); };
  setInterval(tick, 1000);
  setInterval(function () { spinAt = (spinAt + 1) % SPIN.length; root.querySelectorAll("[data-spin]").forEach(function (n) { n.textContent = SPIN[spinAt]; }); }, 120);
  setInterval(function () { if (last && built) { renderTop(last); if (!ui.panels.timeline.hidden) renderTimeline(last); } }, 15000);
})();
`;
