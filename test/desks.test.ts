import { appendFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { type NightServer, startServer } from "../src/server/index.js";
import type { Desk, DesksView } from "../src/store/index.js";
import { deskOf, NOW, SESSION, until, useDeskLogs } from "./desks-logs.js";

// Motherboard's Desks (issue 15): every live agent on this computer at GET /agents.
const logs = useDeskLogs();
let server: NightServer | null = null;
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

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("Motherboard pulls this computer's live agents", () => {
  it("serves one desk per agent: role, ticket, repo, model, steps, tokens and run time from the logs", async () => {
    const { board } = await logs.open();
    const base = logs.base();
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
    const { board } = await logs.open();
    const { run } = logs.paths();
    writeFileSync(
      join(run, "agent-pipe8.jsonl"),
      logs.line({
        isSidechain: true,
        agentId: "pipe8",
        type: "user",
        timestamp: "2026-10-29T09:02:30.000Z",
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

  it("shows a desk quiet for 10 minutes as idle, and drops one quiet for 6 hours", async () => {
    const { board } = await logs.open();
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
