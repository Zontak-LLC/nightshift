import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext, Script } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "../src/server/index.js";
import { loadPinned, projectTiles, watchSiteOf } from "../src/store/index.js";
import { localWatchUrl, readState, watchOnBoard, watchOnTile } from "../src/watch/index.js";
import { boardPage } from "../src/web/index.js";
import { ageText, WATCH_VIEW, watchStrip } from "../src/web/watch-view.js";
import { OLD_NAMES } from "./old-names.js";
import { incident, state } from "./watch-fixtures.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

describe("a shape Sentinel changed never crashes Lens", () => {
  it.each([
    null,
    undefined,
    42,
    "text",
    [],
    {},
    { sites: "x" },
    { sites: [null, 3, { id: 5 }] },
    { sites: [{ id: "loader" }], boxes: "x", incidents: [null, { id: 7 }, { title: "no id" }] },
  ])("reads %j", (data) => {
    const snap = readState(data);
    expect(typeof snap.sites).toBe("object");
  });

  it("keeps the usable parts of a half-wrong incident", () => {
    const snap = readState({
      sites: [{ id: "loader" }],
      incidents: [{ id: "x", site: "loader", status: "open", count: "many", triage: { steps: [7] }, heal: "no" }],
    });
    expect(snap.sites.loader?.open_tickets[0]).toMatchObject({ id: "x", count: 1, severity: "unknown", advice: null });
    expect(snap.sites.loader?.light).toBe("idle");
  });
});

describe("a Sentinel site maps to a Lens project", () => {
  const home = "/srv/dev";
  it("has no built-in site: a project without a watchSite line has no link", () => {
    expect(watchSiteOf([], "my-app", home)).toBeNull();
    expect(watchSiteOf([], "demo-app", home)).toBeNull();
    expect(watchSiteOf([{ path: "~/Projects/my-app", name: "My App" }], "my-app", home)).toBeNull();
    expect(watchSiteOf([{ path: "~/Projects/my-app", name: "My App", watchSite: "my-site" }], "my-app", home)).toBe(
      "my-site",
    );
  });

  it("follows projects.json: a watchSite field wins, an empty one turns the link off", () => {
    const pinned = [
      { path: "~/Projects/shop", name: "Shop", watchSite: "store" },
      { path: "~/Projects/my-app", name: "My App", watchSite: "" },
    ];
    expect(watchSiteOf(pinned, "shop", home)).toBe("store");
    expect(watchSiteOf(pinned, "my-app", home)).toBeNull();
  });

  it("puts the site on the start page tile and on the board payload", () => {
    const pinned = [
      { path: "~/Projects/my-app", name: "My App", watchSite: "loader" },
      { path: "~/Projects/tools", name: "Tools" },
    ];
    const tiles = projectTiles([], pinned, { home, nowMs: Date.now() });
    expect(tiles.find((t) => t.project === "my-app")?.watchSite).toBe("loader");
    expect(tiles.find((t) => t.project === "tools")?.watchSite).toBeNull();
    const snap = readState(state([incident({})]));
    const tile = watchOnTile("loader", "up", snap);
    expect(tile).toMatchObject({ siteId: "loader", status: "up", light: "bad", open: 1 });
    // The page draws the tile's light with the same function as the board's: red, not grey.
    expect(watchStrip(JSON.parse(JSON.stringify(tile)))).toMatchObject({ light: "bad", open: "1 open incident" });
    expect(watchStrip(JSON.parse(JSON.stringify(watchOnTile("usehourly", "up", snap))))?.light).toBe("ok");
    expect(watchStrip(JSON.parse(JSON.stringify(watchOnTile("loader", "down", snap))))?.light).toBe("off");
    expect(readState(state([])).sites.usehourly?.light).toBe("ok");
    expect(watchOnTile(null, "up", snap)).toBeNull();
    expect(watchOnBoard("loader", "down", snap)?.site).toBeNull();
    expect(watchOnBoard("ghost", "up", snap)).toEqual({ siteId: "ghost", status: "up", site: null });
  });

  it("reads watchSite from a real projects.json, and an old file without it keeps working", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightshift-pinned-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "projects.json");
    const warnings: string[] = [];
    writeFileSync(
      file,
      JSON.stringify([
        { path: "~/Projects/my-app", name: "My App" },
        { path: "~/Projects/shop", name: "Shop", watchSite: " store " },
        { path: "~/Projects/demo-app", name: "Demo App", watchSite: "" },
      ]),
    );
    const pinned = loadPinned(file, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
    expect(watchSiteOf(pinned, "my-app", "/h")).toBeNull(); // old line without watchSite: no default site, no link
    expect(watchSiteOf(pinned, "shop", "/h")).toBe("store");
    expect(watchSiteOf(pinned, "demo-app", "/h")).toBeNull(); // switched off on purpose
  });
});

describe("the page", () => {
  it("hides the Live site strip with the hidden attribute (its flex display must not win)", () => {
    expect(boardPage()).toContain(".livesite[hidden] { display: none; }");
  });

  it("has a page script that parses, with the Sentinel parts in it", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(boardPage())?.[1] ?? "";
    expect(() => new Script(script)).not.toThrow();
    for (const word of [
      "renderLive",
      "renderWatch",
      "watchLink",
      "siteLight",
      "From Sentinel",
      "→ Sentinel",
      "Live site",
    ]) {
      expect(script).toContain(word);
    }
    for (const old of OLD_NAMES) expect(boardPage()).not.toContain(old);
  });

  it("is told where Sentinel is, and only the address, nothing that could break the tag", () => {
    expect(boardPage("http://localhost:4500")).toContain(
      '<meta name="nightwatch-url" content="http://localhost:4500">',
    );
    expect(boardPage('http://x"><script>')).not.toContain("<script>alert");
    expect(boardPage('http://x"><b>')).not.toContain('"><b>');
    expect(boardPage()).toContain('content=""');
    expect(boardPage()).toContain("renderWatch");
  });

  it("draws the strip words in the page with the same code as here", () => {
    const board = watchOnBoard("loader", "up", readState(state([incident({})])));
    const inPage = runInNewContext(`${WATCH_VIEW}; JSON.stringify(watchStrip(${JSON.stringify(board)}))`);
    expect(JSON.parse(inPage)).toEqual(watchStrip(board));
    expect(watchStrip(board)).toEqual({
      light: "bad",
      headline: "Loader: Problem",
      open: "1 open incident",
      release: "Last release 9b06e7c · 1h 28m ago · Release looks healthy after 15 min",
    });
    expect(watchStrip(null)).toBeNull();
    expect(watchStrip({ siteId: "x", status: "up", site: null })?.headline).toContain("does not list");
    expect(ageText("2026-10-24T05:00:00Z", Date.parse("2026-10-24T07:30:00Z"))).toBe("2 h ago");
    expect(ageText(null, 0)).toBe("");
  });

  it("serves the watch payload on the project board and the tile light on the start page", async () => {
    const snap = readState(state([incident({})]));
    const server = await startServer(0, {
      watchUrl: "http://localhost:4500",
      view: (p) => ({ project: p, watch: watchOnBoard("loader", "up", snap) }),
      projects: () => [{ project: "my-app", watch: watchOnTile("loader", "up", snap) }],
    });
    cleanup.push(() => server.close());
    const read = async (path: string, kind: string) => {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
      const reader = res.body?.getReader();
      let text = "";
      while (!text.includes(`event: ${kind}`)) text += new TextDecoder().decode((await reader?.read())?.value);
      await reader?.cancel();
      return JSON.parse(text.split("data: ")[1] ?? "null");
    };
    const board = await read("/events?project=my-app", "board");
    expect(board.watch.site.open_tickets[0].title).toContain("ECONNREFUSED");
    expect((await read("/events?project=", "projects"))[0].watch).toMatchObject({ light: "bad", open: 1 });
    const html = await (await fetch(`http://127.0.0.1:${server.port}/my-app`)).text();
    expect(html).toContain('nightwatch-url" content="http://localhost:4500"');
  });
});

describe("the Sentinel address", () => {
  it("defaults to port 4500 and only accepts this computer", () => {
    const said: string[] = [];
    expect(localWatchUrl(undefined)).toBe("http://localhost:4500");
    expect(localWatchUrl("http://127.0.0.1:4600/some/path")).toBe("http://127.0.0.1:4600");
    expect(localWatchUrl("http://evil.example:4500", (m) => said.push(m))).toBe("http://localhost:4500");
    expect(localWatchUrl("nonsense", (m) => said.push(m))).toBe("http://localhost:4500");
    expect(said).toHaveLength(2);
  });
});
