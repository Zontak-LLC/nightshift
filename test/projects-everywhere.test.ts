import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseLine } from "../src/parser/index.js";
import { Board, loadPinned, projectTiles } from "../src/store/index.js";
import { DEFAULT_PINNED } from "../src/store/pinned.js";

// Scenarios for "projects everywhere": a session started in one folder works in another, and the start page shows a
// fixed list of projects. Every name, path and text below is invented; log lines have the real shape.
const NOW = Date.parse("2026-10-24T02:50:00.000Z");
const SESSION = "s-main-1";
let home = "";
let line = 0;

const repo = (name: string) => mkdirSync(join(home, "Projects", name, ".git"), { recursive: true });
const at = (minute: number) => `2026-10-24T02:${String(minute).padStart(2, "0")}:00.000Z`;
const use = (cwd: string, minute: number, name: string, input: Record<string, unknown>) =>
  JSON.stringify({
    type: "assistant",
    uuid: `u-${++line}`,
    timestamp: at(minute),
    cwd,
    sessionId: SESSION,
    gitBranch: "main",
    message: {
      role: "assistant",
      stop_reason: null,
      content: [{ type: "tool_use", id: `tu-${line}`, name, input }],
    },
  });

function feed(board: Board, lines: string[]) {
  for (const l of lines) for (const e of parseLine(l).events) board.apply(e);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ns-projects-"));
  line = 0;
  for (const name of ["usehourly", "magsmith", "nightwatch", "nightshift", "sideproject"]) repo(name);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("a session that works in another repository", () => {
  const real = () => new Board(); // the default: walks up to the folder holding .git

  function night(b: Board) {
    const own = join(home, "Projects", "usehourly");
    const other = join(home, "Projects", "magsmith");
    feed(b, [
      use(own, 10, "Bash", { command: "git status" }), // no path: stays with the session's own project
      use(own, 20, "Bash", { command: `cd ${other} && npm test` }),
      use(own, 30, "Edit", { file_path: join(other, "src", "board.ts"), old_string: "a", new_string: "b" }),
      use(own, 40, "Bash", { command: `git -C ${other} status && ls ${join(own, "src")}` }), // two repos in one step
    ]);
  }

  it("shows its steps on the board of the repository where they happened", () => {
    const b = real();
    night(b);
    const loader = b.view("magsmith");
    expect(loader.now).toHaveLength(1);
    expect(loader.now[0]?.at).toBe(at(40));
    expect(loader.now[0]?.what).toBe("Running git");
    expect(loader.folder).toBe(join(home, "Projects", "magsmith"));
    expect(loader.branch).toBeNull(); // the session did not start here
  });

  it("keeps the session on its own project too, with only the steps that worked there", () => {
    const b = real();
    night(b);
    const own = b.view("usehourly");
    expect(own.now).toHaveLength(1);
    expect(own.now[0]?.at).toBe(at(40)); // the last step touched both repositories
    expect(own.branch).toBe("main");
  });

  it("splits the steps: a step with no path stays at home, a step in two repositories counts in both", () => {
    const b = real();
    feed(b, [
      use(join(home, "Projects", "usehourly"), 10, "Bash", { command: "git status" }),
      use(join(home, "Projects", "usehourly"), 11, "Edit", { file_path: join(home, "Projects", "magsmith", "a.ts") }),
    ]);
    expect(b.view("usehourly").now.map((r) => r.at)).toEqual([at(10)]);
    expect(b.view("magsmith").now.map((r) => r.at)).toEqual([at(11)]);
  });

  it("lists the other repository on the start page and a worktree counts as its main repository", () => {
    const b = real();
    night(b);
    const wt = join(home, "Projects", "magsmith", ".claude", "worktrees", "x", "a.ts");
    feed(b, [use(join(home, "Projects", "usehourly"), 45, "Edit", { file_path: wt })]);
    const rows = b.projects(NOW);
    expect(rows.map((r) => r.project).sort()).toEqual(["magsmith", "usehourly"]);
    expect(rows.find((r) => r.project === "magsmith")?.lastAt).toBe(at(45));
  });

  it("does not move a project's pipeline to another board", () => {
    const b = real();
    night(b);
    expect(b.view("magsmith").run).toBeNull();
  });
});

describe("the fixed project list on the start page", () => {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  beforeEach(() => {
    warnings.length = 0;
  });

  it("creates the file with the four defaults when it is missing", () => {
    const file = join(home, ".nightshift", "projects.json");
    expect(loadPinned(file, warn)).toEqual(DEFAULT_PINNED);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(DEFAULT_PINNED);
    expect(DEFAULT_PINNED.map((p) => p.name)).toEqual(["Loader", "UseHourly", "Night Watch", "Night Shift"]);
  });

  it("shows pinned projects even when idle, with the display name, dimmer and after the busy ones", () => {
    const b = new Board();
    feed(b, [
      use(join(home, "Projects", "usehourly"), 48, "Edit", { file_path: join(home, "Projects", "usehourly", "a.ts") }),
    ]);
    const tiles = projectTiles(b.projects(NOW), DEFAULT_PINNED, { home, nowMs: NOW });
    expect(tiles.map((t) => t.name)).toEqual(["UseHourly", "Loader", "Night Watch", "Night Shift"]);
    expect(tiles[0]?.active).toBe(true);
    const loader = tiles.find((t) => t.name === "Loader");
    expect(loader).toMatchObject({
      project: "magsmith",
      active: false,
      lastAt: "",
      folder: join(home, "Projects", "magsmith"),
    });
  });

  it("shows Loader as active, with last active time, once a session works there from another folder", () => {
    const b = new Board();
    feed(b, [
      use(join(home, "Projects", "usehourly"), 44, "Edit", { file_path: join(home, "Projects", "magsmith", "x.ts") }),
    ]);
    const loader = projectTiles(b.projects(NOW), DEFAULT_PINNED, { home, nowMs: NOW }).find((t) => t.name === "Loader");
    expect(loader).toMatchObject({ active: true, lastAt: at(44) });
  });

  it("adds a repo under ~/Projects with activity in the last 30 days, and leaves a hidden or old one out", () => {
    const b = new Board();
    const old = JSON.stringify({
      ...JSON.parse(use(join(home, "Projects", "nightwatch"), 1, "Bash", { command: "ls" })),
      timestamp: "2026-08-01T00:00:00.000Z",
    });
    feed(b, [
      use(join(home, "Projects", "sideproject"), 30, "Edit", {
        file_path: join(home, "Projects", "sideproject", "a.ts"),
      }),
      old,
    ]);
    const rows = b.projects(NOW + 3600_000 * 2);
    const names = (pinned = DEFAULT_PINNED) =>
      projectTiles(rows, pinned, { home, nowMs: NOW + 3600_000 * 2 }).map((t) => t.name);
    expect(names()).toContain("sideproject");
    const hide = [...DEFAULT_PINNED, { path: "~/Projects/sideproject", name: "x", hide: true }];
    expect(names(hide)).not.toContain("sideproject");
    expect(names(hide)).not.toContain("x");
    // A repo outside ~/Projects is not added by itself unless it is busy right now.
    const elsewhere = mkdtempSync(join(tmpdir(), "ns-else-"));
    mkdirSync(join(elsewhere, ".git"));
    const c = new Board();
    feed(c, [use(elsewhere, 30, "Edit", { file_path: join(elsewhere, "a.ts") })]);
    expect(
      projectTiles(c.projects(NOW + 3600_000 * 2), DEFAULT_PINNED, { home, nowMs: NOW + 3600_000 * 2 }).map(
        (t) => t.project,
      ),
    ).not.toContain(elsewhere.split("/").pop());
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("counts the open tickets of the project's newest pipeline run", () => {
    const b = new Board();
    feed(b, [use(join(home, "Projects", "usehourly"), 40, "Bash", { command: "ls" })]);
    b.apply({
      kind: "run.queue",
      runId: "wf1",
      sessionId: SESSION,
      tickets: [
        { number: 1, title: "One" },
        { number: 2, title: "Two" },
      ],
    });
    const tile = projectTiles(b.projects(NOW), DEFAULT_PINNED, { home, nowMs: NOW }).find(
      (t) => t.name === "UseHourly",
    );
    expect(tile?.open).toBe(2);
  });

  it("falls back to the defaults and says so when the file is damaged", () => {
    const file = join(home, "projects.json");
    for (const bad of ["{not json", '{"a":1}', '[{"name":"no path"}]']) {
      writeFileSync(file, bad);
      expect(loadPinned(file, warn)).toEqual(DEFAULT_PINNED);
    }
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("using the defaults");
    expect(readFileSync(file, "utf8")).toBe('[{"name":"no path"}]'); // never overwritten
  });

  it("reads a good file: the name falls back to the folder name", () => {
    const file = join(home, "projects.json");
    writeFileSync(
      file,
      JSON.stringify([{ path: "~/Projects/sideproject" }, { path: "~/Projects/magsmith", name: "Loader" }]),
    );
    expect(loadPinned(file, warn).map((p) => p.name)).toEqual(["sideproject", "Loader"]);
    expect(warnings).toHaveLength(0);
  });
});

describe("a session that starts in a worktree or a subfolder", () => {
  it("belongs to the main repository, not to a project named after the worktree", () => {
    const b = new Board();
    const wt = join(home, "Projects", "usehourly", ".claude", "worktrees", "feature-y");
    mkdirSync(wt, { recursive: true });
    feed(b, [use(wt, 12, "Edit", { file_path: join(wt, "a.ts") })]);
    expect(b.projects(NOW).map((r) => r.project)).toEqual(["usehourly"]);
    expect(b.view("usehourly").now).toHaveLength(1);
  });
});
