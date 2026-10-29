import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { type Engine, startEngine } from "../src/engine.js";
import { type NightServer, startServer } from "../src/server/index.js";
import type { Desk, DesksView } from "../src/store/index.js";

// Motherboard's Desks (issue 15): every live agent on this computer at GET /agents. The fixtures in
// test/fixtures/desks/ have the shape of real Claude Code logs (a main session, one background agent, one pipeline
// run); all names, ids and texts are invented. "/work" in them stands for a folder made per test.
const FIXTURES = join(import.meta.dirname, "fixtures", "desks");
const SESSION = "s-desk-1";
const NOW = Date.parse("2026-10-29T09:05:00.000Z");
const RESET = 1_893_456_000; // a fixed future reset time, in Unix seconds
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};

let base = "";
let engine: Engine | null = null;
let server: NightServer | null = null;
const paths = () => {
  const project = join(base, "logs", "-work-shop-app");
  const subagents = join(project, SESSION, "subagents");
  return { root: join(base, "logs"), session: join(project, `${SESSION}.jsonl`), subagents, db: join(base, "ns.db") };
};
/** A fixture with "/work" pointed at this test's folder. */
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8").replaceAll('"/work/', `"${base}/`);
const line = (o: Record<string, unknown>) =>
  `${JSON.stringify({ sessionId: SESSION, cwd: `${base}/shop-app`, gitBranch: "coupon", userType: "external", ...o })}\n`;

function writeLogs() {
  const p = paths();
  const run = join(p.subagents, "workflows", "run-1");
  mkdirSync(run, { recursive: true });
  for (const repo of ["shop-app", "docs-site"]) mkdirSync(join(base, repo, ".git"), { recursive: true });
  writeFileSync(p.session, fixture("session.jsonl"));
  writeFileSync(join(p.subagents, "agent-bg1.jsonl"), fixture("agent-bg1.jsonl"));
  writeFileSync(join(p.subagents, "agent-bg1.meta.json"), fixture("agent-bg1.meta.json"));
  writeFileSync(join(run, "journal.jsonl"), fixture("journal.jsonl"));
  writeFileSync(join(run, "agent-pipe7.jsonl"), fixture("agent-pipe7.jsonl"));
}

async function open(): Promise<Engine> {
  engine = startEngine({ root: paths().root, dbPath: paths().db, everyMs: 40 });
  const board = engine.board;
  // The watcher reads the meta file just after the agent's log: wait for every desk and the agent's name.
  await until(() => {
    const d = board.desks(NOW).agents;
    return (
      d.length === 3 &&
      d.some((x) => x.ticket.title === "Docs: coupon field") &&
      d.every((x) => x.steps === 3 || x.steps === 4)
    );
  });
  return engine;
}
const deskOf = (view: DesksView, role: Desk["role"]) => view.agents.find((d) => d.role === role);
const DESK_KEYS = [
  "cost",
  "folder",
  "id",
  "lastAt",
  "model",
  "project",
  "recent",
  "role",
  "runMs",
  "startedAt",
  "state",
  "step",
  "steps",
  "ticket",
  "tokens",
  "wait",
  "waitsForYou",
] as const satisfies readonly (keyof Desk)[];

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-desks-")));
  writeLogs();
});
afterEach(async () => {
  engine?.stop();
  engine = null;
  await server?.close();
  server = null;
  rmSync(base, { recursive: true, force: true });
});

describe("Motherboard pulls this computer's live agents", () => {
  it("serves one desk per agent: role, ticket, repo, model, steps, tokens and run time from the logs", async () => {
    const { board } = await open();
    // As the CLI wires it: the home folder (here the test's folder) shows as `~`.
    server = await startServer(0, { view: () => ({}), projects: () => [], agents: () => board.desks(NOW, base) });
    const res = await fetch(`http://127.0.0.1:${server.port}/agents`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const view = (await res.json()) as DesksView;
    expect(view.generatedAt).toBe("2026-10-29T09:05:00.000Z");
    // The background agent asks a question: it waits for the owner, so it comes first; then the newest active one.
    expect(view.agents.map((d) => d.role)).toEqual(["background", "pipeline", "main"]);

    expect(deskOf(view, "main")).toMatchObject({
      id: `main:${SESSION}`,
      ticket: { number: null, title: "Add a coupon field to the cart" },
      project: "shop-app",
      folder: "~/shop-app",
      model: "claude-opus-5-5",
      step: "Run the tests",
      recent: ["Searching for coupon", "Editing src/cart.ts", "Run the tests"],
      steps: 4,
      // msg_m1 is written on 3 lines (text, Read, Grep): counted once, from its last line (output 80, not 5 + 5 + 80).
      tokens: { input: 18, output: 140, cacheRead: 3700, cacheWrite: 250, total: 4108 },
      cost: null,
      startedAt: "2026-10-29T09:00:00.000Z",
      lastAt: "2026-10-29T09:04:00.000Z",
      runMs: 5 * 60_000, // still active: until now
      state: "active",
      waitsForYou: false,
      wait: null,
    });
    expect(deskOf(view, "background")).toMatchObject({
      id: "agent:bg1",
      ticket: { number: null, title: "Docs: coupon field" },
      project: "docs-site", // where it works, not where its session started
      model: "claude-sonnet-5-5",
      recent: ["Reading guide.md", "Editing guide.md", "AskUserQuestion"],
      steps: 3,
      tokens: { total: 334 + 386 + 360 },
      runMs: NOW - Date.parse("2026-10-29T09:01:10.000Z"),
      waitsForYou: true,
      wait: { reason: "question", resetsAt: null },
    });
    expect(deskOf(view, "pipeline")).toMatchObject({
      id: "agent:pipe7",
      ticket: { number: 7, title: "Add a coupon field" },
      project: "shop-app",
      model: "claude-opus-5-5",
      step: "Running npm run ci",
      recent: ["Reading src/coupon.ts", "Writing src/coupon.ts", "Running npm run ci"],
      steps: 3,
      tokens: { total: 541 + 842 + 891 },
      runMs: NOW - Date.parse("2026-10-29T09:02:10.000Z"),
      state: "active",
    });
    // Tokens only: no desk has a cost, and nothing in the payload looks like money.
    expect(view.agents.every((d) => d.cost === null)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/\$|usd|price|dollar/i);
    // The pipeline agent is one pipeline desk, never also a background agent.
    expect(view.agents.filter((d) => d.id === "agent:pipe7")).toHaveLength(1);
    // Only the desk's own fields go out: no extra keys, no personal paths.
    for (const d of view.agents) expect(Object.keys(d).sort()).toEqual(DESK_KEYS);
    expect(JSON.stringify(view)).not.toContain(base);
  });

  it("keeps each pipeline agent's own time: a stalled ticket goes idle while its neighbour works", async () => {
    const { board } = await open();
    const run = join(paths().subagents, "workflows", "run-1");
    writeFileSync(
      join(run, "agent-pipe8.jsonl"),
      line({
        isSidechain: true,
        agentId: "pipe8",
        type: "user",
        timestamp: "2026-10-29T09:02:30.000Z",
        message: { role: "user", content: "Build ticket #8: Coupon docs" },
      }) +
        line({
          isSidechain: true,
          agentId: "pipe8",
          type: "assistant",
          timestamp: "2026-10-29T09:03:00.000Z",
          message: { id: "msg_q1", model: "claude-opus-5-5", content: [{ type: "text", text: "Looking around." }] },
        }),
    );
    appendFileSync(
      join(run, "journal.jsonl"),
      `${JSON.stringify({ type: "started", key: "v2:b", agentId: "pipe8", label: "#8 Coupon docs", phase: "Build" })}\n`,
    );
    const at = Date.parse("2026-10-29T09:14:00.000Z"); // 9.5 min after pipe7's last step, 11 min after pipe8's
    const desk = (id: string) => board.desks(at).agents.find((d) => d.id === id);
    expect(await until(() => desk("agent:pipe8")?.lastAt === "2026-10-29T09:03:00.000Z")).toBe(true);
    expect(desk("agent:pipe8")).toMatchObject({
      role: "pipeline",
      ticket: { number: 8 },
      state: "idle",
      runMs: 30_000,
    });
    expect(desk("agent:pipe7")).toMatchObject({ lastAt: "2026-10-29T09:04:30.000Z", state: "active" });
  });

  it("refuses other hosts and anything but GET, and sends no CORS header", async () => {
    server = await startServer(0, { view: () => ({}), projects: () => [], agents: () => ({ agents: [] }) });
    const port = server.port;
    const call = (method: string, host: string) =>
      new Promise<{ status: number; cors: unknown }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/agents", method, headers: { host } }, (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, cors: res.headers["access-control-allow-origin"] });
        });
        req.on("error", reject);
        req.end();
      });
    expect(await call("GET", `evil.example:${port}`)).toEqual({ status: 403, cors: undefined });
    expect(await call("POST", `127.0.0.1:${port}`)).toEqual({ status: 405, cors: undefined });
    expect(await call("GET", `localhost:${port}`)).toEqual({ status: 200, cors: undefined });
  });

  it("counts the same tokens after a restart (the history replays them once, not twice)", async () => {
    const first = (await open()).board.desks(NOW).agents.map((d) => [d.id, d.tokens?.total]);
    engine?.stop();
    const again = (await open()).board.desks(NOW).agents.map((d) => [d.id, d.tokens?.total]);
    expect(again).toEqual(first);
    expect(first).toContainEqual([`main:${SESSION}`, 4108]);
  });

  it("says a session waits for the owner at a usage limit, with its reset time, until its next real step", async () => {
    const { board } = await open();
    appendFileSync(
      paths().session,
      line({
        type: "assistant",
        timestamp: "2026-10-29T09:04:30.000Z",
        isApiErrorMessage: true,
        error: "rate_limit",
        quotaLimits: { status: "rejected", resetsAt: RESET, rateLimitType: "five_hour" },
        message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit" }] },
      }),
    );
    const main = () => deskOf(board.desks(NOW), "main");
    expect(await until(() => main()?.waitsForYou === true)).toBe(true);
    expect(main()?.wait).toEqual({ reason: "usage_limit", resetsAt: new Date(RESET * 1000).toISOString() });
    expect(board.desks(NOW).agents[0]?.waitsForYou).toBe(true); // waiting desks come first
    appendFileSync(
      paths().session,
      line({
        type: "assistant",
        timestamp: "2026-10-29T09:06:00.000Z",
        message: {
          id: "msg_m4",
          model: "claude-opus-5-5",
          content: [{ type: "tool_use", id: "tu_m5", name: "Read", input: { file_path: `${base}/shop-app/a.ts` } }],
        },
      }),
    );
    expect(await until(() => main()?.waitsForYou === false)).toBe(true);
    expect(main()?.wait).toBeNull();
  });

  it("stops waiting once the agent's question is answered", async () => {
    const { board } = await open();
    expect(deskOf(board.desks(NOW), "background")?.waitsForYou).toBe(true);
    appendFileSync(
      join(paths().subagents, "agent-bg1.jsonl"),
      line({
        isSidechain: true,
        agentId: "bg1",
        type: "user",
        timestamp: "2026-10-29T09:04:50.000Z",
        message: { role: "user", content: [{ tool_use_id: "tu_b3", type: "tool_result", content: "Before" }] },
      }),
    );
    expect(await until(() => deskOf(board.desks(NOW), "background")?.waitsForYou === false)).toBe(true);
  });

  it("shows a desk quiet for 10 minutes as idle, and drops one quiet for 6 hours", async () => {
    const { board } = await open();
    const later = board.desks(Date.parse("2026-10-29T09:20:00.000Z")).agents;
    expect(later.map((d) => d.state)).toEqual(["idle", "idle", "idle"]);
    // Idle: the run time stops at the last step.
    expect(later.find((d) => d.role === "main")?.runMs).toBe(4 * 60_000);
    // 6 h after the background agent's last step (09:03:30), but not yet after the session's (09:04:00).
    const next = board.desks(Date.parse("2026-10-29T15:03:45.000Z")).agents;
    expect(next.map((d) => d.role).sort()).toEqual(["main", "pipeline"]);
    expect(board.desks(Date.parse("2026-10-29T15:10:00.000Z")).agents).toEqual([]);
  });
});

// Not yet a check against board-kit: its `Agents` type could not be read from the build sandbox (issue 15). This only
// pins the keys sent to the keys of `Desk`, so nothing outside the one mapping file (store/desks.ts) adds fields.
describe("the payload sends exactly the Desk fields", () => {
  it("lists every Desk key, and only those", () => {
    expectTypeOf<(typeof DESK_KEYS)[number]>().toEqualTypeOf<keyof Desk>();
  });
});
