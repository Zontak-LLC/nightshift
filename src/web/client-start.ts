/**
 * The first half of the page script (see client.ts): helpers, the start page, building the board, the ticket cards.
 * It opens the function that client-end.ts closes; the two are joined in client.ts.
 */
export const CLIENT_START = String.raw`
(function () {
  "use strict";
  var STATIONS = [["queued", "Queued"], ["working", "Working"], ["checking", "Checking"], ["done", "Done"], ["skipped", "Skipped"]];
  var STATUS = { merged: "merged", "partial-merged": "partly merged", "plan-posted": "plan posted", "draft-posted": "draft posted" };
  var project = "";
  try { project = decodeURIComponent(location.pathname.slice(1)); } catch (e) { project = location.pathname.slice(1); }
  var root = document.getElementById("app");
  var cards = new Map(), lists = {}, counts = {}, openId = null, last = null, built = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function hhmm(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function restart(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  // ---- the start page: projects with something going on ----
  function renderProjects(rows) {
    root.textContent = "";
    var head = el("header", "head");
    head.append(el("h1", null, "Night Shift"));
    root.append(head);
    if (!rows.length) { root.append(el("p", "empty", "No Claude Code sessions found yet. Start one and it shows here.")); return; }
    var grid = el("div", "projects");
    rows.forEach(function (r) {
      var a = el("a", "project");
      a.href = "/" + encodeURIComponent(r.project);
      a.append(el("b", null, r.project), el("span", null, r.folder));
      a.append(el("span", null, (r.running ? r.running + " working · " : "") + "last active " + hhmm(r.lastAt)));
      grid.append(a);
    });
    root.append(grid);
  }

  // ---- one project's board ----
  function build() {
    root.textContent = "";
    // One status line, like a 3270 screen: the tool, the project and where it lives; the light and the time on the right.
    var head = el("header", "head status");
    var left = el("div", "status-left");
    left.append(el("h1", "brand", "NIGHT SHIFT"), el("span", "proj", project));
    var conn = el("span", "conn");
    conn.setAttribute("role", "status");
    conn.append(el("span", "led"), el("span", "conn-text", "LIVE"));
    var right = el("div", "status-right");
    right.append(conn, el("span", "date"), el("span", "clock"));
    head.append(left, right, el("div", "where"));
    var night = el("section", "night frame");
    night.append(el("span", "frame-title", "RUN"));
    night.setAttribute("aria-label", "The run so far");
    var facts = el("div", "facts");
    facts.append(el("span", "meter"), el("span", "so-far"));
    var track = el("div", "track");
    track.append(el("span", "rail"), el("span", "fill"));
    night.append(facts, track, el("div", "hours"));
    var now = el("div", "now frame");
    now.setAttribute("aria-live", "polite");
    var board = el("div", "board");
    STATIONS.forEach(function (s) {
      var col = el("section", "col");
      col.setAttribute("aria-label", s[1]);
      var h2 = el("h2", null, s[1] + " ");
      counts[s[0]] = el("span", "count", "0");
      h2.append(counts[s[0]]);
      lists[s[0]] = el("div", "list");
      var more = el("span", "more-tag");
      more.hidden = true;
      lists[s[0]].addEventListener("scroll", function () { fade(col); }, { passive: true });
      col.append(h2, lists[s[0]], more);
      board.append(col);
    });
    // The foot of a CICS screen: a message line in plain words, then the keys as Key=Action.
    var message = el("div", "message");
    message.setAttribute("role", "status");
    var keys = el("footer", "keys");
    [["↑↓", "Move"], ["←→", "Column"], ["Enter", "Open"], ["Esc", "Close"]].forEach(function (k) {
      var key = el("span");
      key.append(el("b", null, k[0]), "=" + k[1]);
      keys.append(key);
    });
    keys.append(el("span", "keys-note", "read only · nothing leaves this computer"));
    root.append(head, night, now, board, message, keys);
    built = true;
  }

  function fade(col) {
    var list = col.querySelector(".list"), tag = col.querySelector(".more-tag");
    var bottom = list.scrollTop + list.clientHeight, hidden = 0;
    for (var i = 0; i < list.children.length; i++) {
      var c = list.children[i];
      if (c.offsetTop - list.offsetTop + c.offsetHeight / 2 > bottom) hidden++;
    }
    col.classList.toggle("more", hidden > 0);
    tag.hidden = hidden === 0;
    tag.textContent = "+" + hidden + " more";
  }

  function cardFor(t) {
    var c = cards.get(t.number);
    if (c) return c;
    c = el("article", "card");
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    var top = el("div", "top");
    top.append(el("span", "dot"), el("span", "num", "#" + t.number));
    c.append(top, el("div", "name"), el("div", "step"));
    var d = el("div", "detail");
    d.append(el("div", "detail-in"));
    c.append(d);
    function toggle() { openId = openId === t.number ? null : t.number; if (last) render(last, true); }
    c.addEventListener("click", function (e) { if (e.target.tagName !== "A") toggle(); });
    c.addEventListener("keydown", function (e) {
      if (e.target.tagName === "A") return; // Enter on the PR link follows the link
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    c.addEventListener("animationend", function (e) { ["in", "draw"].forEach(function (k) { e.target.classList.remove(k); }); });
    c.dataset.num = String(t.number);
    cards.set(t.number, c);
    return c;
  }

  function detailFor(t, place) {
    var box = el("div");
    if (t.station === "queued") box.append(el("span", null, "Number " + place + " in line. It starts when an agent is free."));
    else if (t.station === "skipped") box.append(el("span", null, "Skipped" + (t.summary ? ": " + t.summary : ".")));
    else {
      var line = el("span");
      line.append(el("b", null, t.station === "done" ? "Finished " + hhmm(t.finishedAt) : t.steps + " steps so far"));
      if (t.status) line.append(" · " + (STATUS[t.status] || t.status));
      if (t.pr) {
        line.append(" · ");
        var a = el("a", null, t.pr.indexOf("/pull/") > 0 ? "PR #" + t.pr.split("/").pop() : t.pr);
        if (t.pr.indexOf("https://") === 0) { a.href = t.pr; a.target = "_blank"; a.rel = "noreferrer"; }
        line.append(a);
      }
      box.append(line);
      if (t.summary && t.station === "done") box.append(el("span", null, t.summary));
      if (t.recent.length) {
        var ol = el("ol");
        t.recent.forEach(function (s) { ol.append(el("li", null, s)); });
        box.append(ol);
      }
    }
    return box;
  }

`;
