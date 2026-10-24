import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NightEvent } from "../src/parser/index.js";
import { parseLine } from "../src/parser/index.js";
import { Board } from "../src/store/index.js";
import { terminalPrinter } from "../src/terminal.js";
import { watchLogs } from "../src/watcher/index.js";

// Scenarios for ticket 7: background agents (subagents) on the board. Every line below has the shape of a real
// Claude Code subagent log line; all names, paths and texts are invented.
const SESSION = "s-parent-1";
const NOW = Date.parse("2026-10-24T02:10:00.000Z");
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};

let dir = "";
let stop: () => void = () => {};
let repos = { usehourly: "", nightwatch: "", worktree: "" };
let sessionDir = "";

function makeRepos(base: string) {
  const usehourly = join(base, "work", "usehourly");
  const nightwatch = join(base, "work", "nightwatch");
  const worktree = join(usehourly, ".claude", "worktrees", "feature-x");
  mkdirSync(join(usehourly, ".git", "worktrees", "feature-x"), { recursive: true });
  mkdirSync(join(nightwatch, ".git"), { recursive: true });
  mkdirSync(join(worktree, "src"), { recursive: true });
  // A linked worktree has a .git FILE that points back into the main repository.
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(usehourly, ".git", "worktrees", "feature-x")}\n`);
  return { usehourly, nightwatch, worktree };
}

type Opts = { agentId?: string; at: string; cwd: string };
const base = (o: Opts) => ({
  parentUuid: "11111111-0000-4000-8000-000000000000",
  isSidechain: o.agentId !== undefined,
  ...(o.agentId ? { agentId: o.agentId } : {}),
  uuid: "22222222-0000-4000-8000-000000000000",
  timestamp: o.at,
  userType: "external",
  cwd: o.cwd,
  sessionId: SESSION,
  version: "0.0.0-fixture",
  gitBranch: "main",
});
const task = (o: Opts, text: string) =>
  `${JSON.stringify({ ...base(o), type: "user", message: { role: "user", content: text } })}\n`;
const use = (o: Opts, id: string, name: string, input: Record<string, unknown>, stop_reason: string | null = null) =>
  `${JSON.stringify({ ...base(o), type: "assistant", message: { role: "assistant", stop_reason, content: [{ type: "tool_use", id, name, input }] } })}\n`;
const answer = (o: Opts, text: string) =>
  `${JSON.stringify({ ...base(o), type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }] } })}\n`;

function writeSession(root: string) {
  const o = { cwd: repos.usehourly, at: "2026-10-24T02:00:00.000Z" };
  mkdirSync(join(root, "-work-usehourly"), { recursive: true });
  writeFileSync(
    join(root, "-work-usehourly", `${SESSION}.jsonl`),
    task(o, "Build three things in parallel") + use(o, "tu_main", "Bash", { command: "git status" }),
  );
  sessionDir = join(root, "-work-usehourly", SESSION, "subagents");
  mkdirSync(sessionDir, { recursive: true });
}

function writeAgent(id: string, description: string, lines: string) {
  writeFileSync(
    join(sessionDir, `agent-${id}.meta.json`),
    JSON.stringify({ agentType: "general-purpose", description }),
  );
  writeFileSync(join(sessionDir, `agent-${id}.jsonl`), lines);
}

/** Three agents started from the usehourly session: one in nightwatch, one in a usehourly worktree, one nowhere. */
function writeAgents() {
  const wd = { agentId: "aaa111", cwd: repos.usehourly };
  writeAgent(
    "aaa111",
    "Night Watch: build the dashboard",
    task({ ...wd, at: "2026-10-24T02:01:00.000Z" }, "Please build the dashboard FAKE-TOKEN-sk-test-0000\nMore text") +
      use({ ...wd, at: "2026-10-24T02:02:00.000Z" }, "tu_a1", "Bash", {
        command: `cd ${repos.nightwatch} && ls`,
        description: "Listing files",
      }) +
      use({ ...wd, at: "2026-10-24T02:03:00.000Z" }, "tu_a2", "Edit", {
        file_path: join(repos.nightwatch, "src", "app.ts"),
      }) +
      use({ ...wd, at: "2026-10-24T02:04:00.000Z" }, "tu_a3", "Read", { file_path: "/tmp/not-a-repo/notes.txt" }),
  );
  const wt = { agentId: "bbb222", cwd: repos.usehourly };
  writeAgent(
    "bbb222",
    "Fix the week page",
    task({ ...wt, at: "2026-10-24T02:01:30.000Z" }, "Fix the week page in the worktree") +
      use({ ...wt, at: "2026-10-24T02:05:00.000Z" }, "tu_b1", "Edit", {
        file_path: join(repos.worktree, "src", "week.ts"),
      }) +
      use({ ...wt, at: "2026-10-24T02:06:00.000Z" }, "tu_b2", "Bash", { command: `git -C ${repos.worktree} status` }),
  );
  const none = { agentId: "ccc333", cwd: repos.usehourly };
  writeAgent(
    "ccc333",
    "Research only",
    task({ ...none, at: "2026-10-24T02:02:00.000Z" }, "Look something up") +
      use({ ...none, at: "2026-10-24T02:07:00.000Z" }, "tu_c1", "WebSearch", { query: "invented question" }),
  );
}

function follow(board: Board, events: NightEvent[] = []) {
  stop = watchLogs({
    root: dir,
    everyMs: 40,
    onEvent: (e) => {
      events.push(e);
      board.apply(e);
    },
  });
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-agents-")));
  repos = makeRepos(dir);
  writeSession(join(dir, "logs"));
  dir = join(dir, "logs");
});
afterEach(() => {
  stop();
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("background agents are filed under the project they really work in", () => {
  it("shows nightwatch work under nightwatch, a worktree under its main repo, and a lost agent under its parent", async () => {
    writeAgents();
    const board = new Board();
    follow(board);
    expect(await until(() => board.view("nightwatch", NOW).agents.length === 1)).toBe(true);

    const night = board.view("nightwatch", NOW);
    expect(night.agents[0]).toMatchObject({
      agentId: "aaa111",
      name: "Night Watch: build the dashboard",
      worktree: false,
      step: "Reading notes.txt",
      parent: SESSION,
      steps: 3,
    });
    expect(night.folder).toBe(repos.nightwatch);

    const hourly = board.view("usehourly", NOW);
    const byId = Object.fromEntries(hourly.agents.map((a) => [a.agentId, a]));
    expect(Object.keys(byId).sort()).toEqual(["bbb222", "ccc333"]);
    expect(byId.bbb222).toMatchObject({ name: "Fix the week page", worktree: true, parent: SESSION });
    expect(byId.ccc333).toMatchObject({ worktree: false, step: "Searching the web: invented question" });
    expect(hourly.agents.map((a) => a.agentId)).not.toContain("aaa111");
    // The main session's own steps are still there, and the agent steps are not mixed into them.
    expect(hourly.now.map((r) => r.what)).toEqual(["Running git status"]);
  });

  it("lists every project that only background agents touched on the start page", async () => {
    writeAgents();
    const board = new Board();
    follow(board);
    expect(await until(() => board.projects(NOW).some((p) => p.project === "nightwatch"))).toBe(true);
    const rows = Object.fromEntries(board.projects(NOW).map((p) => [p.project, p]));
    expect(rows.nightwatch).toMatchObject({ folder: repos.nightwatch, agents: 1, running: 0 });
    expect(rows.usehourly).toMatchObject({ agents: 2 });
    expect(rows.nightwatch?.lastAt).toBe("2026-10-24T02:04:00.000Z");
  });

  it("counts an agent as finished when its turn ends, and as quiet after ten minutes", async () => {
    writeAgents();
    const board = new Board();
    follow(board);
    expect(await until(() => board.view("nightwatch", NOW).agents.length === 1)).toBe(true);
    expect(board.view("nightwatch", NOW).agents[0]?.active).toBe(true);
    expect(board.view("nightwatch", NOW + 11 * 60_000).agents[0]?.active).toBe(false);
    appendFileSync(
      join(sessionDir, "agent-aaa111.jsonl"),
      answer({ agentId: "aaa111", cwd: repos.usehourly, at: "2026-10-24T02:08:00.000Z" }, "All done."),
    );
    expect(await until(() => board.view("nightwatch", NOW).agents[0]?.active === false)).toBe(true);
  });
});

describe("background agents stream in live", () => {
  it("picks up a new agent file, follows its appends, and survives a half-written last line", async () => {
    const board = new Board();
    follow(board);
    await new Promise((r) => setTimeout(r, 150));
    expect(board.view("nightwatch", NOW).agents).toEqual([]);

    const o = { agentId: "ddd444", cwd: repos.usehourly };
    const first = use({ ...o, at: "2026-10-24T02:08:00.000Z" }, "tu_d1", "Edit", {
      file_path: join(repos.nightwatch, "a.ts"),
    });
    const second = use({ ...o, at: "2026-10-24T02:09:00.000Z" }, "tu_d2", "Edit", {
      file_path: join(repos.nightwatch, "b.ts"),
    });
    const file = join(sessionDir, "agent-ddd444.jsonl");
    writeFileSync(file, first + second.slice(0, 60)); // the last line is cut in the middle
    expect(await until(() => board.view("nightwatch", NOW).agents[0]?.steps === 1)).toBe(true);
    expect(board.view("nightwatch", NOW).agents[0]?.name).toMatch(/^agent ddd444/); // no meta file, no task yet

    appendFileSync(file, second.slice(60));
    expect(await until(() => board.view("nightwatch", NOW).agents[0]?.steps === 2)).toBe(true);
    expect(board.view("nightwatch", NOW).agents[0]?.recent).toEqual(["Editing a.ts", "Editing b.ts"]);

    // The description file arrives later and names the agent.
    writeFileSync(join(sessionDir, "agent-ddd444.meta.json"), '{"description":"Late name"}');
    expect(await until(() => board.view("nightwatch", NOW).agents[0]?.name === "Late name")).toBe(true);
  });

  it("does not crash on a broken meta file, an empty agent file or garbage lines", async () => {
    writeFileSync(join(sessionDir, "agent-eee555.meta.json"), "{not json");
    writeFileSync(join(sessionDir, "agent-eee555.jsonl"), "");
    writeFileSync(join(sessionDir, "agent-fff666.jsonl"), 'garbage\n{"type":"assistant"}\n{"isSidechain":tru');
    const board = new Board();
    const errors: unknown[] = [];
    stop = watchLogs({ root: dir, everyMs: 40, onEvent: (e) => board.apply(e), onError: (e) => errors.push(e) });
    await new Promise((r) => setTimeout(r, 250));
    expect(errors).toEqual([]);
    expect(board.view("usehourly", NOW).agents).toEqual([]);
  });

  it("names an agent from its task when it has no description, without leaking token-like text", () => {
    const board = new Board();
    const o = { agentId: "ggg777", cwd: repos.usehourly, at: "2026-10-24T02:08:00.000Z" };
    for (const line of [
      task(o, "Tidy the docs FAKE-sk-ant-0000000000000000000000 now\nsecond line"),
      use(o, "tu_g1", "Read", { file_path: join(repos.usehourly, "README.md") }),
    ])
      for (const e of parseLine(line).events) board.apply(e);
    const agent = board.view("usehourly", NOW).agents[0];
    expect(agent?.name.startsWith("Tidy the docs")).toBe(true);
    expect(agent?.name).not.toContain("second line");
  });
});

describe("the terminal tags background agents", () => {
  it("prints an agent step under its real project with its short name", async () => {
    writeAgents();
    const board = new Board();
    const events: NightEvent[] = [];
    follow(board, events);
    expect(await until(() => board.view("nightwatch", NOW).agents[0]?.steps === 3)).toBe(true);
    const print = terminalPrinter((id) => board.agentLabel(id));
    const lines = events.map(print).filter((l): l is string => l !== null);
    const mine = lines.filter((l) => l.includes("[Night Watch: build"));
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.every((l) => /\d\d:\d\d:\d\d {2}nightwatch\s+\[/.test(l))).toBe(true);
    expect(mine.some((l) => l.endsWith("Editing src/app.ts") || l.endsWith("Editing app.ts"))).toBe(true);
    // The worktree agent's step is filed under usehourly, the nightwatch agent's never is.
    expect(lines.filter((l) => /usehourly\s+\[Night Watch/.test(l))).toEqual([]);
    expect(lines.some((l) => /usehourly\s+\[Fix the week page\]/.test(l))).toBe(true);
  });
});

describe("finding the project from tool calls", () => {
  it("reads paths from file tools and from cd and git -C in a command, and keeps relative ones inside the cwd", async () => {
    const { pathsOf } = await import("../src/parser/paths.js");
    expect(pathsOf("Edit", { file_path: "/a/b/c.ts" }, "/a")).toEqual(["/a/b/c.ts"]);
    expect(pathsOf("Bash", { command: "cd ~/Projects/x && git -C '/p/qr' status; cd ../up" }, "/w/here")).toEqual([
      "~/Projects/x",
      "/p/qr",
      "/w/up",
    ]);
    expect(pathsOf("Read", { file_path: "relative/only.ts" }, "/w")).toEqual([]);
    expect(pathsOf("Bash", { command: "cd ~root/x" }, "/w")).toEqual([]);
    expect(pathsOf("Bash", { command: 1 }, "/w")).toEqual([]);
  });

  it("never lets the home folder or a folder without git decide, and treats a removed worktree path as its repo", async () => {
    const { repoRootOf } = await import("../src/store/index.js");
    const home = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-home-")));
    try {
      mkdirSync(join(home, ".git"), { recursive: true }); // a dotfiles repo in the home folder
      mkdirSync(join(home, "plain", "deep"), { recursive: true });
      expect(repoRootOf(join(home, "plain", "deep", "f.txt"), home)).toBeNull();
      expect(repoRootOf("relative/path", home)).toBeNull();
      expect(repoRootOf(join(home, "Projects", "gone", ".claude", "worktrees", "w1", "x.ts"), home)).toEqual({
        root: join(home, "Projects", "gone"),
        worktree: true,
      });
      mkdirSync(join(home, "Projects", "app", ".git"), { recursive: true });
      expect(repoRootOf("~/Projects/app/src/new.ts", home)).toEqual({
        root: join(home, "Projects", "app"),
        worktree: false,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("a command that starts with cd names the program after it", () => {
  it("says what runs in the folder, not 'cd'", async () => {
    const { toolSummary } = await import("../src/parser/index.js");
    expect(toolSummary("Bash", { command: "cd ~/Projects/x && npm run ci" }, "/w")).toBe("Running npm run ci");
    expect(toolSummary("Bash", { command: "cd '/a b'; cd c && git status" }, "/w")).toBe("Running git status");
    expect(toolSummary("Bash", { command: "ls" }, "/w")).toBe("Running ls");
  });
});
