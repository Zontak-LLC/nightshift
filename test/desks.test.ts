import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { type NightServer, startServer } from "../src/server/index.js";
import type { DesksView } from "../src/store/index.js";
import { deskById, deskOf, NOW, SESSION, until, useDeskLogs } from "./desks-logs.js";
import { AGENTS_SAMPLE, type Agents } from "./fixtures/board-kit-agents.js";

// Motherboard's Desks (issue 15): every live agent on this computer at GET /agents.
const logs = useDeskLogs();
let server: NightServer | null = null;
const FIXTURES = join(import.meta.dirname, "fixtures");
const CONTRACT = readFileSync(join(FIXTURES, "board-kit-contract.txt"), "utf8");
const TYPED_COPY = readFileSync(join(FIXTURES, "board-kit-agents.ts"), "utf8");

/** A type's source, as written in a file: a block over many lines, or one line. */
const typeIn = (source: string, name: string) =>
  source.match(new RegExp(`^export type ${name} = (?:\\{\\n[^]*?\\n\\}|.*);$`, "m"))?.[0] ?? "";
const fieldsOf = (block: string) =>
  [...block.matchAll(/(\w+)(\??): /g)].map(([, name, optional]) => ({ name: name ?? "", required: !optional }));

const serveDesks = async (agents: () => unknown) => {
  server = await startServer(0, { view: () => ({}), projects: () => [], agents });
  return fetch(`http://127.0.0.1:${server.port}/agents`);
};

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("Motherboard pulls this computer's live agents", () => {
  it("serves one desk per agent: role, ticket, repo, model, steps and run time from the logs", async () => {
    const { board } = await logs.open();
    const res = await serveDesks(() => board.desks(NOW));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const view = (await res.json()) as DesksView;
    // The background agent asks a question: it waits for the owner, so it comes first; then the newest active one.
    expect(view.list?.map((d) => d.role)).toEqual(["background agent", "pipeline agent", "main session"]);

    expect(deskOf(view, "main session")).toEqual({
      id: `main:${SESSION}`,
      title: "Add a coupon field to the cart",
      role: "main session",
      project: "shop-app",
      model: "claude-opus-5-5",
      state: "working",
      steps: ["Searching for coupon", "Editing src/cart.ts", "Run the tests"],
      stepCount: 4,
      costUsd: null,
      minutes: 5, // still active: until now
    });
    expect(deskOf(view, "background agent")).toEqual({
      id: "agent:bg1",
      title: "Docs: coupon field",
      role: "background agent",
      project: "docs-site", // where it works, not where its session started
      model: "claude-sonnet-5-5",
      state: "waits",
      steps: ["Reading guide.md", "Editing guide.md", "AskUserQuestion"],
      stepCount: 3,
      costUsd: null,
      minutes: 4, // 3 min 50 s since 09:01:10
    });
    expect(deskOf(view, "pipeline agent")).toEqual({
      id: "agent:pipe7",
      title: "Add a coupon field",
      role: "pipeline agent",
      ticket: "#7",
      project: "shop-app",
      model: "claude-opus-5-5",
      state: "working",
      steps: ["Reading src/coupon.ts", "Writing src/coupon.ts", "Running npm run ci"],
      stepCount: 3,
      costUsd: null,
      minutes: 3, // 2 min 50 s since 09:02:10
    });
    // Tokens only: no desk has a cost, and nothing else in the payload looks like money.
    expect(view.list?.every((d) => d.costUsd === null)).toBe(true);
    expect(JSON.stringify(view).replaceAll('"costUsd":null', "")).not.toMatch(/\$|usd|price|dollar/i);
    // The pipeline agent is one pipeline desk, never also a background agent.
    expect(view.list?.filter((d) => d.id === "agent:pipe7")).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain(logs.base());
  });

  it("adds up each agent's tokens from the logs, a message on 3 lines counted once", async () => {
    const { board } = await logs.open();
    // msg_m1 is written on 3 lines (text, Read, Grep): counted from its last line (output 80, not 5 + 5 + 80).
    expect(board.deskTokens(`main:${SESSION}`)).toEqual({
      input: 18,
      output: 140,
      cacheRead: 3700,
      cacheWrite: 250,
      total: 4108,
    });
    expect(board.deskTokens("agent:bg1")?.total).toBe(334 + 386 + 360);
    expect(board.deskTokens("agent:pipe7")?.total).toBe(541 + 842 + 891);
  });

  it("never sends a background agent's prompt: with no meta file its desk is named by its id", async () => {
    rmSync(join(logs.paths().subagents, "agent-bg1.meta.json"));
    const { board } = logs.start();
    const background = () => deskOf(board.desks(NOW), "background agent");
    expect(await until(() => background()?.stepCount === 3)).toBe(true);
    expect(background()?.title).toBe("agent bg1");
    expect(JSON.stringify(board.desks(NOW))).not.toContain("Update the docs");
  });

  it("keeps each pipeline agent's own time: a stalled ticket goes idle while its neighbour works", async () => {
    const { board } = await logs.open();
    const { run } = logs.paths();
    writeFileSync(
      join(run, "agent-pipe8.jsonl"),
      logs.line({
        isSidechain: true,
        agentId: "pipe8",
        type: "user",
        timestamp: "2026-10-29T09:02:00.000Z",
        message: { role: "user", content: "Build ticket #8: Coupon docs" },
      }) +
        logs.line({
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
    const desk = (id: string) => deskById(board.desks(at), id);
    expect(await until(() => desk("agent:pipe8")?.idleMinutes === 11)).toBe(true);
    expect(desk("agent:pipe8")).toMatchObject({ role: "pipeline agent", ticket: "#8", state: "idle", minutes: 1 });
    expect(desk("agent:pipe7")).toMatchObject({ state: "working" });
  });

  it("refuses other hosts and anything but GET, and sends no CORS header", async () => {
    await serveDesks(() => ({ list: [] }));
    const port = server?.port ?? 0;
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

  it("shows a desk quiet for 10 minutes as idle, and drops one quiet for 6 hours", async () => {
    const { board } = await logs.open();
    const later = board.desks(Date.parse("2026-10-29T09:20:00.000Z")).list ?? [];
    // The background agent's question is still open: it waits, however long it stays quiet.
    expect(later.map((d) => d.state)).toEqual(["waits", "idle", "idle"]);
    // Idle: the run time stops at the last step (09:04:00), and the idle time goes on.
    expect(later.find((d) => d.role === "main session")).toMatchObject({ minutes: 4, idleMinutes: 16 });
    // 6 h after the background agent's last step (09:03:30), but not yet after the session's (09:04:00).
    const next = board.desks(Date.parse("2026-10-29T15:03:45.000Z")).list ?? [];
    expect(next.map((d) => d.role).sort()).toEqual(["main session", "pipeline agent"]);
    expect(board.desks(Date.parse("2026-10-29T15:10:00.000Z")).list).toEqual([]);
  });
});

// board-kit's contract at commit 0c60024 is copied whole to test/fixtures/board-kit-contract.txt, and its Agents types
// to the typed test/fixtures/board-kit-agents.ts. A drifted copy or an extra key in the payload fails here.
describe("the payload is board-kit's Agents part", () => {
  it("tests against a typed copy that still reads as the contract", () => {
    for (const name of ["AgentState", "Agent", "Agents"]) {
      expect(typeIn(CONTRACT, name)).not.toBe("");
      expect(typeIn(TYPED_COPY, name)).toBe(typeIn(CONTRACT, name));
    }
  });

  it("accepts every field of board-kit's sample, and is the same type both ways", () => {
    const accepted: DesksView = AGENTS_SAMPLE;
    expect(accepted.list).toHaveLength(3);
    expectTypeOf<DesksView>().toEqualTypeOf<Agents>();
  });

  it("sends only the contract's keys, every required one, and its states", async () => {
    const { board } = await logs.open();
    const res = await serveDesks(() => board.desks(NOW));
    const view = (await res.json()) as Agents;
    expect(Object.keys(view)).toEqual(["list"]);
    expect(view.list).toHaveLength(3);
    const fields = fieldsOf(typeIn(CONTRACT, "Agent"));
    const known = fields.map((f) => f.name);
    const states = [...typeIn(CONTRACT, "AgentState").matchAll(/"(\w+)"/g)].map((m) => m[1]);
    for (const desk of view.list ?? []) {
      expect(known).toEqual(expect.arrayContaining(Object.keys(desk)));
      for (const f of fields) if (f.required) expect(desk).toHaveProperty(f.name);
      expect(states).toContain(desk.state);
    }
  });
});
