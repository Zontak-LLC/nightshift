/**
 * The page script's Night Watch part (see client.ts): the "→ Night Watch" link, a project tile's site light, the
 * "Live site" strip and the "From Night Watch" lane. Read only: it only draws and links; nothing here acts on Night Watch.
 * The words come from watch-view.ts (tested). Everything from Night Watch is set with textContent.
 */
export const CLIENT_WATCH = String.raw`  // ---- Night Watch: the link, the site light, the Live site strip and the From Night Watch lane ----
  var NW_META = document.querySelector('meta[name="nightwatch-url"]');
  var NW_URL = NW_META ? NW_META.getAttribute("content") || "" : "";
  function nwHref(siteId) { return NW_URL ? NW_URL + "/" + (siteId ? "?site=" + encodeURIComponent(siteId) : "") : ""; }
  function watchLink() {
    var a = el("a", "nwlink", "→ Night Watch");
    if (NW_URL) a.href = nwHref("");
    a.hidden = !NW_URL;
    a.title = "Open Night Watch, the guard that watches the live sites";
    return a;
  }
  function siteLight(w) {
    var s = watchStrip(w), dot = el("span", "sitelight " + (s ? s.light : "off"));
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", s ? s.headline + (s.open ? ", " + s.open : "") : "");
    dot.title = s ? s.headline + (s.open ? " · " + s.open : "") : "";
    return dot;
  }

  function renderLive(w) {
    var s = watchStrip(w);
    ui.live.hidden = !s;
    ui.live.textContent = "";
    if (!s) return;
    ui.live.className = "livesite " + s.light;
    ui.live.append(el("span", "eyebrow", "Live site"), siteLight(w), el("b", null, s.headline));
    if (s.open) ui.live.append(el("span", "open", s.open));
    if (s.release) ui.live.append(el("span", "rel", s.release));
    var link = el("a", "nwlink", "→ Night Watch");
    if (NW_URL) link.href = nwHref(w.siteId);
    link.hidden = !NW_URL;
    ui.live.append(link);
  }

  function watchCard(t, done) {
    var c = el("article", "wcard " + (done ? "healed" : "sev-" + t.severity)), top = el("div", "top");
    top.append(el("span", "sev", t.severity), el("span", "count", "×" + t.count));
    var age = ageText(done ? t.resolvedAt : t.lastAt, Date.now());
    if (age) top.append(el("span", "age", (done ? "resolved " : "last seen ") + age));
    c.append(top, el("div", "name", t.title));
    if (done && t.healedBy) c.append(el("div", "fix ok", t.healedBy));
    if (!done && t.advice) c.append(el("div", "fix", "Fix: " + t.advice));
    if (t.issueTitle) c.append(el("div", "issue", "Issue draft: " + t.issueTitle));
    return c;
  }

  function renderWatch(view) {
    var site = view.watch && view.watch.site, open = site ? site.open_tickets : [], done = site ? site.done_tickets : [];
    renderLive(view.watch);
    ui.fromwatch.hidden = !open.length && !done.length;
    ui.fromwatch.textContent = "";
    if (ui.fromwatch.hidden) return;
    var h = el("h2", null, "From Night Watch");
    h.append(el("span", "count", String(open.length)));
    ui.fromwatch.append(h);
    var grid = el("div", "wgrid");
    open.forEach(function (t) { grid.append(watchCard(t, false)); });
    ui.fromwatch.append(grid);
    if (done.length) {
      ui.fromwatch.append(el("h3", null, "Done · healed"));
      var dgrid = el("div", "wgrid");
      done.forEach(function (t) { dgrid.append(watchCard(t, true)); });
      ui.fromwatch.append(dgrid);
    }
  }

`;
