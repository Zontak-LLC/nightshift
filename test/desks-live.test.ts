import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deskOf, NOW, RESET, SESSION, until, useDeskLogs } from "./desks-logs.js";

// Motherboard's Desks (issue 15), as the logs change: tokens counted once, and who waits for the owner.
const logs = useDeskLogs();

describe("a desk's tokens stay true when logs are read again", () => {
  it("counts the same tokens after a restart (the history replays them once, not twice)", async () => {
    const first = (await logs.open()).board.desks(NOW).agents.map((d) => [d.id, d.tokens?.total]);
    logs.stop();
    const again = (await logs.open()).board.desks(NOW).agents.map((d) => [d.id, d.tokens?.total]);
    expect(again).toEqual(first);
    expect(first).toContainEqual([`main:${SESSION}`, 4108]);
  });

  it("counts every message once when a cut-short log is read again from the top", async () => {
    const { board } = await logs.open();
    // The watcher starts the file over under a new epoch: its lines get new history keys, so the store must dedupe.
    const shorter = readFileSync(logs.paths().session, "utf8").split("\n").slice(0, 8).join("\n");
    const newest = logs.line({
      type: "assistant",
      timestamp: "2026-10-29T09:04:40.000Z",
      message: {
        id: "msg_m4",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: "Done." }],
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2 },
      },
    });
    writeFileSync(logs.paths().session, `${shorter}\n${newest}`);
    const main = () => deskOf(board.desks(NOW), "main");
    expect(await until(() => main()?.lastAt === "2026-10-29T09:04:40.000Z")).toBe(true);
    expect(main()?.tokens?.total).toBe(4108 + 3);
  });
});

describe("a pipeline agent whose session is quiet or stopped", () => {
  it("gets its desk when its session's log was quiet at start (followed from its end)", async () => {
    const old = new Date(Date.now() - 3600_000);
    utimesSync(logs.paths().session, old, old);
    const { board } = logs.start();
    const pipeline = () => deskOf(board.desks(NOW, logs.base()), "pipeline");
    expect(await until(() => pipeline()?.steps === 3)).toBe(true);
    expect(deskOf(board.desks(NOW, logs.base()), "main")).toBeUndefined();
    expect(pipeline()).toMatchObject({ id: "agent:pipe7", project: "shop-app", folder: "~/shop-app", state: "active" });
  });

  it("files agents in a linked worktree under the repo, not the worktree's folder", async () => {
    const base = logs.base();
    const tree = join(base, "dayshift-work", "shop-app-R-7");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, ".git"), `gitdir: ${base}/shop-app/.git/worktrees/shop-app-R-7\n`);
    const { session, run, subagents } = logs.paths();
    const pipe = join(run, "agent-pipe7.jsonl");
    writeFileSync(pipe, readFileSync(pipe, "utf8").replaceAll(`"cwd":"${base}/shop-app"`, `"cwd":"${tree}"`));
    // A background agent whose steps name no path: only its cwd says where it works.
    writeFileSync(
      join(subagents, "agent-bg2.jsonl"),
      logs.line({
        isSidechain: true,
        agentId: "bg2",
        cwd: tree,
        type: "assistant",
        timestamp: "2026-10-29T09:04:10.000Z",
        message: {
          id: "msg_w1",
          model: "claude-opus-5-5",
          content: [{ type: "tool_use", id: "tu_w1", name: "Bash", input: { command: "ls" } }],
        },
      }),
    );
    const old = new Date(Date.now() - 3600_000);
    utimesSync(session, old, old);
    const { board } = logs.start();
    const desk = (id: string) => board.desks(NOW, base).agents.find((d) => d.id === id);
    expect(await until(() => desk("agent:pipe7")?.steps === 3 && desk("agent:bg2")?.steps === 1)).toBe(true);
    expect(desk("agent:pipe7")).toMatchObject({ project: "shop-app", folder: "~/shop-app" });
    expect(desk("agent:bg2")).toMatchObject({ project: "shop-app", folder: "~/shop-app" });
  });

  it("waits for the owner when its session hits a usage limit, until the session goes on", async () => {
    const { board } = await logs.open();
    const pipeline = () => deskOf(board.desks(NOW), "pipeline");
    expect(pipeline()?.waitsForYou).toBe(false);
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:30.000Z"));
    expect(await until(() => pipeline()?.waitsForYou === true)).toBe(true);
    expect(pipeline()?.wait).toEqual({ reason: "usage_limit", resetsAt: new Date(RESET * 1000).toISOString() });
    appendFileSync(
      logs.paths().session,
      logs.line({
        type: "assistant",
        timestamp: "2026-10-29T09:04:40.000Z",
        message: { id: "msg_m4", model: "claude-opus-5-5", content: [{ type: "text", text: "Going on." }] },
      }),
    );
    expect(await until(() => pipeline()?.waitsForYou === false)).toBe(true);
  });
});

describe("waits for you", () => {
  it("says a session waits for the owner at a usage limit, with its reset time, until its next real step", async () => {
    const { board } = await logs.open();
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:30.000Z"));
    const main = () => deskOf(board.desks(NOW), "main");
    expect(await until(() => main()?.waitsForYou === true)).toBe(true);
    expect(main()?.wait).toEqual({ reason: "usage_limit", resetsAt: new Date(RESET * 1000).toISOString() });
    expect(board.desks(NOW).agents[0]?.waitsForYou).toBe(true); // waiting desks come first
    appendFileSync(
      logs.paths().session,
      logs.line({
        type: "assistant",
        timestamp: "2026-10-29T09:06:00.000Z",
        message: {
          id: "msg_m4",
          model: "claude-opus-5-5",
          content: [
            { type: "tool_use", id: "tu_m5", name: "Read", input: { file_path: `${logs.base()}/shop-app/a.ts` } },
          ],
        },
      }),
    );
    expect(await until(() => main()?.waitsForYou === false)).toBe(true);
    expect(main()?.wait).toBeNull();
  });

  it("stops waiting once the agent's question is answered", async () => {
    const { board } = await logs.open();
    expect(deskOf(board.desks(NOW), "background")?.waitsForYou).toBe(true);
    appendFileSync(
      join(logs.paths().subagents, "agent-bg1.jsonl"),
      logs.line({
        isSidechain: true,
        agentId: "bg1",
        type: "user",
        timestamp: "2026-10-29T09:04:50.000Z",
        message: { role: "user", content: [{ tool_use_id: "tu_b3", type: "tool_result", content: "Before" }] },
      }),
    );
    expect(await until(() => deskOf(board.desks(NOW), "background")?.waitsForYou === false)).toBe(true);
  });
});
