import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { type NightServer, startServer } from "../src/server/index.js";
import { runningAgents } from "../src/store/day-shift.js";
import { type Seated, seatedOf } from "../src/store/desks.js";
import type { Board, DayShiftAgents, Desk, DeskState } from "../src/store/index.js";
import { NOW, until, useDeskLogs } from "./desks-logs.js";
import { AGENTS_SAMPLE, type Agents, LIMIT, MAX_AGENTS, MAX_TEXT } from "./fixtures/day-shift-agents.js";

// Day Shift's Agents tile (issue 14): the running agents on this computer at GET /api/agents, in Day Shift's shape.
const logs = useDeskLogs();
let server: NightServer | null = null;
const FIXTURES = join(import.meta.dirname, "fixtures");
const CONTRACT = readFileSync(join(FIXTURES, "day-shift-agents-contract.txt"), "utf8");
/** The JSON example in the issue, as Day Shift wrote it. */
const CONTRACT_SAMPLE = JSON.parse(CONTRACT.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "null") as Agents;
const CONTRACT_KEYS = Object.keys(CONTRACT_SAMPLE.agents[0] ?? {});
const at = (time: string) => Date.parse(`2026-10-29T${time}.000Z`);

afterEach(async () => {
  await server?.close();
  server = null;
});

const serve = async (board: Board, nowMs = NOW, home = "") => {
  server = await startServer(0, { view: () => ({}), projects: () => [], running: () => board.running(nowMs, home) });
  return fetch(`http://127.0.0.1:${server.port}/api/agents`);
};
const agentsOf = async (board: Board, nowMs = NOW, home = "") =>
  ((await (await serve(board, nowMs, home)).json()) as DayShiftAgents).agents;

/** One step of a pipeline or background agent: a shell command at a time. */
const stepLine = (agentId: string, timestamp: string, command: string, extra: Record<string, unknown> = {}) =>
  logs.line({
    ...extra,
    isSidechain: true,
    agentId,
    type: "assistant",
    timestamp,
    message: {
      id: `msg_${agentId}_${timestamp}`,
      model: "claude-opus-5-5",
      content: [{ type: "tool_use", id: `tu_${agentId}_${timestamp}`, name: "Bash", input: { command } }],
    },
  });
const journalLine = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;

/** A pipeline ticket in the fixture's run (repo shop-app): its journal line and one step of its agent. */
function addTicket(agentId: string, label: string, timestamp: string, finished = false) {
  const { run } = logs.paths();
  writeFileSync(join(run, `agent-${agentId}.jsonl`), stepLine(agentId, timestamp, "npm run build"));
  appendFileSync(
    join(run, "journal.jsonl"),
    journalLine({ type: "started", key: `v2:${agentId}`, agentId, label, phase: "Build" }) +
      (finished ? journalLine({ type: "result", key: `v2:${agentId}`, agentId, result: { status: "done" } }) : ""),
  );
}

/** Each entry has exactly the contract's keys, and each value keeps its rules. */
function expectContract(agents: DayShiftAgents["agents"]) {
  expect(agents.length).toBeLessThanOrEqual(MAX_AGENTS);
  for (const a of agents) {
    expect(Object.keys(a).sort()).toEqual([...CONTRACT_KEYS].sort());
    for (const text of [a.role, a.worksOn]) {
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThanOrEqual(1);
      expect(text.length).toBeLessThanOrEqual(MAX_TEXT);
    }
    if (a.startedAt !== null) expect(a.startedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
    if (a.limitMinutes !== null) {
      expect(Number.isInteger(a.limitMinutes)).toBe(true);
      expect(a.limitMinutes).toBeGreaterThanOrEqual(LIMIT.min);
      expect(a.limitMinutes).toBeLessThanOrEqual(LIMIT.max);
    }
  }
}

describe("Day Shift pulls this computer's running agents", () => {
  it("answers an empty list when nothing runs", async () => {
    const { board } = await logs.open();
    const res = await serve(board, at("16:00:00")); // 7 h after the last line: no desk is live
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe('{"agents":[]}');
  });

  it("sends a pipeline agent on ticket 12 in shop-api with its own last line and a 30-minute limit", async () => {
    const base = logs.base();
    const project = join(logs.paths().root, "-work-shop-api");
    const run = join(project, "s-api", "subagents", "workflows", "run-2");
    mkdirSync(run, { recursive: true });
    mkdirSync(join(base, "shop-api", ".git"), { recursive: true });
    const api = { sessionId: "s-api", cwd: `${base}/shop-api` };
    writeFileSync(
      join(project, "s-api.jsonl"),
      logs.line({
        ...api,
        type: "user",
        timestamp: "2026-10-29T08:58:00.000Z",
        message: { role: "user", content: "Go" },
      }),
    );
    writeFileSync(
      join(run, "journal.jsonl"),
      journalLine({ type: "launched" }) +
        journalLine({ type: "started", key: "v2:a", agentId: "api12", label: "#12 Fix loader", phase: "Build" }),
    );
    writeFileSync(
      join(run, "agent-api12.jsonl"),
      stepLine("api12", "2026-10-29T09:03:00.000Z", "npm run build", api) +
        stepLine("api12", "2026-10-29T09:04:20.000Z", "npm run ci", api),
    );
    const { board } = logs.start();
    const ticket = () => board.running(NOW, "").agents.find((a) => a.worksOn.startsWith("shop-api: #12"));
    expect(await until(() => ticket()?.startedAt === "2026-10-29T09:04:20.000Z")).toBe(true);
    const agents = await agentsOf(board);
    expect(agents.filter((a) => a.worksOn.startsWith("shop-api: #12"))).toEqual([
      {
        role: "pipeline agent",
        worksOn: "shop-api: #12 Fix loader",
        startedAt: "2026-10-29T09:04:20.000Z",
        limitMinutes: 30,
      },
    ]);
    expectContract(agents);
  });

  it("sends main sessions and background agents with no limit, so Day Shift's 15 minutes apply", async () => {
    const { board } = await logs.open();
    const agents = await agentsOf(board);
    expect(agents).toEqual([
      // The background agent waits on an open AskUserQuestion: it is listed, first.
      {
        role: "background agent",
        worksOn: "docs-site: Docs: coupon field",
        startedAt: "2026-10-29T09:03:30.000Z",
        limitMinutes: null,
      },
      {
        role: "pipeline agent",
        worksOn: "shop-app: #7 Add a coupon field",
        startedAt: "2026-10-29T09:04:30.000Z",
        limitMinutes: 30,
      },
      {
        role: "main session",
        worksOn: "shop-app: Add a coupon field to the cart",
        startedAt: "2026-10-29T09:04:00.000Z",
        limitMinutes: null,
      },
    ]);
    expectContract(agents);
  });

  it("lists a session waiting on a rate limit, and drops idle desks and finished agents", async () => {
    const { board } = await logs.open();
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:40.000Z"));
    appendFileSync(
      join(logs.paths().run, "journal.jsonl"),
      journalLine({ type: "result", key: "v2:a", agentId: "pipe7", result: { status: "done" } }),
    );
    const roles = () => board.running(NOW, "").agents.map((a) => a.role);
    expect(await until(() => roles().join() === "main session,background agent")).toBe(true);
    // 15 min after the last steps: the main session's limit is still open (it waits), and the background agent's
    // question too; nothing that only worked is left.
    const later = await agentsOf(board, at("09:20:00"));
    expect(later.map((a) => a.role)).toEqual(["main session", "background agent"]);
    // Once the session goes on, its trouble is over; quiet for 10 minutes it is idle and drops off.
    appendFileSync(
      logs.paths().session,
      logs.line({ type: "user", timestamp: "2026-10-29T09:05:00.000Z", message: { role: "user", content: "Go on" } }),
    );
    expect(await until(() => board.running(at("09:16:00"), "").agents.length === 1)).toBe(true);
    expect(board.running(at("09:16:00"), "").agents.map((a) => a.role)).toEqual(["background agent"]);
  });

  it("shows the home folder as ~ once, single spaces, and cuts worksOn to 200 characters last", async () => {
    // Short, like test/desks.test.ts: the journal cuts a label at 200 characters, and the test folder's path is long.
    const home = "/srv/dev";
    addTicket("long9", `#9   Tidy\t ${home}/notes   ${"word ".repeat(60)}`, "2026-10-29T09:04:10.000Z");
    addTicket("tilde10", "#10 Read ~/notes", "2026-10-29T09:04:05.000Z");
    const { board } = logs.start();
    const find = (prefix: string) => board.running(NOW, home).agents.find((a) => a.worksOn.startsWith(prefix));
    expect(await until(() => Boolean(find("shop-app: #9") && find("shop-app: #10")))).toBe(true);
    const agents = await agentsOf(board, NOW, home);
    const long = agents.find((a) => a.worksOn.startsWith("shop-app: #9"))?.worksOn ?? "";
    expect(long).toHaveLength(200);
    expect(long).toBe(`shop-app: #9 Tidy ~/notes ${"word ".repeat(60)}`.slice(0, 200));
    expect(long).not.toContain(home);
    expect(agents.find((a) => a.worksOn.startsWith("shop-app: #10"))?.worksOn).toBe("shop-app: #10 Read ~/notes");
    expectContract(agents);
  });

  it("keeps 20 running agents from the whole list: 60 live desks, 5 idle ones newer than all", async () => {
    const { session } = logs.paths();
    for (let i = 0; i < 52; i++) {
      const second = String(i).padStart(2, "0");
      writeFileSync(
        session.replace("s-desk-1.jsonl", `s-many-${i}.jsonl`),
        logs.line({
          sessionId: `s-many-${i}`,
          type: "user",
          timestamp: `2026-10-29T09:00:${second}.000Z`,
          message: { role: "user", content: `Task ${i}` },
        }),
      );
    }
    for (let i = 0; i < 5; i++) addTicket(`done${i}`, `#${20 + i} Finished`, `2026-10-29T09:04:5${5 + i}.000Z`, true);
    const engine = logs.start();
    // biome-ignore lint/complexity/useLiteralKeys: the test reaches the board's private source to call seatedOf
    const seated = () => seatedOf(engine.board["deskSource"](""), NOW);
    expect(await until(() => seated().length === 60, 8000)).toBe(true);
    expect(seated().filter((s) => s.desk.state === "idle")).toHaveLength(5);
    expect(engine.board.desks(NOW).list).toHaveLength(50);
    const agents = await agentsOf(engine.board);
    expect(agents).toHaveLength(20);
    expect(agents.some((a) => a.worksOn.includes("Finished"))).toBe(false);
    expectContract(agents);
  });

  it("refuses other hosts and anything but GET, and sends no CORS header", async () => {
    const { board } = await logs.open();
    await serve(board);
    const port = server?.port ?? 0;
    const call = (method: string, host: string) =>
      new Promise<{ status: number; allow: unknown; cors: string[] }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/api/agents", method, headers: { host } }, (res) => {
          res.resume();
          const cors = Object.keys(res.headers).filter((h) => h.startsWith("access-control-"));
          resolve({ status: res.statusCode ?? 0, allow: res.headers.allow, cors });
        });
        req.on("error", reject);
        req.end();
      });
    expect(await call("POST", `127.0.0.1:${port}`)).toEqual({ status: 405, allow: "GET", cors: [] });
    expect(await call("GET", `evil.example:${port}`)).toEqual({ status: 403, allow: undefined, cors: [] });
    expect(await call("GET", `localhost:${port}`)).toEqual({ status: 200, allow: undefined, cors: [] });
  });

  it("is not served without a source for it", async () => {
    server = await startServer(0, { view: () => ({}), projects: () => [] });
    expect((await fetch(`http://127.0.0.1:${server.port}/api/agents`)).status).toBe(404);
  });
});

describe("the reply is Day Shift's contract (issue 14)", () => {
  it("tests against a typed copy of the issue's example and rules", () => {
    expect(CONTRACT.split("\n")[0]).toContain("Zontak-LLC/nightshift issue #14");
    expect(AGENTS_SAMPLE).toEqual(CONTRACT_SAMPLE);
    expect(CONTRACT).toContain(`at most ${MAX_TEXT} characters each`);
    expect(CONTRACT).toContain(`a whole number from ${LIMIT.min} to ${LIMIT.max}, or \`null\``);
    expect(CONTRACT).toContain(`Day Shift keeps at most ${MAX_AGENTS} agents`);
    expectContract(CONTRACT_SAMPLE.agents);
  });

  it("is the same type as the contract's, both ways", () => {
    const accepted: DayShiftAgents = AGENTS_SAMPLE;
    expect(accepted.agents).toHaveLength(2);
    expectTypeOf<DayShiftAgents>().toEqualTypeOf<Agents>();
  });

  it("keeps 20 of 25 running desks, in their order, and drops idle ones before the cut", () => {
    const seat = (i: number, state: DeskState, title = `Task ${i}`): Seated => ({
      desk: { id: `d${i}`, title, role: "main session", project: "shop-app", state },
      lastAt: `2026-10-29T09:00:${String(i).padStart(2, "0")}.000Z`,
    });
    const idle = [0, 1, 2].map((i) => seat(i, "idle"));
    const running = Array.from({ length: 25 }, (_, i) => seat(i + 10, "working"));
    const { agents } = runningAgents([...idle, ...running]);
    expect(agents.map((a) => a.worksOn)).toEqual(running.slice(0, 20).map((s) => `shop-app: ${s.desk.title}`));
    expect(runningAgents([seat(1, "working")]).agents[0]).toMatchObject({ startedAt: "2026-10-29T09:00:01.000Z" });
    expect(runningAgents([{ ...seat(1, "working"), lastAt: "" }]).agents[0]?.startedAt).toBeNull();
  });

  it("collapses any whitespace in a title to single spaces, and keeps a ~ that is already there", () => {
    const desk: Desk = { id: "d", title: "  Fix\n\tthe   ~/notes  loader ", role: "background agent", state: "waits" };
    const [agent] = runningAgents([{ desk: { ...desk, project: "shop-api" }, lastAt: "" }]).agents;
    expect(agent).toEqual({
      role: "background agent",
      worksOn: "shop-api: Fix the ~/notes loader",
      startedAt: null,
      limitMinutes: null,
    });
  });
});
