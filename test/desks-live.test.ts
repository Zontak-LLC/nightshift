import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deskById, deskOf, NOW, RESET, SESSION, until, useDeskLogs } from "./desks-logs.js";

// Motherboard's Desks (issue 15), as the logs change: tokens counted once, and who waits for the owner.
const logs = useDeskLogs();
const STOPPED = `usage_limit, resets ${new Date(RESET * 1000).toISOString()}`;

describe("a desk's tokens stay true when logs are read again", () => {
  it("counts the same tokens after a restart (the history replays them once, not twice)", async () => {
    const totals = async () => {
      const { board } = await logs.open();
      return (board.desks(NOW).list ?? []).map((d) => [d.id, board.deskTokens(d.id)?.total]);
    };
    const first = await totals();
    logs.stop();
    expect(await totals()).toEqual(first);
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
    const total = () => board.deskTokens(`main:${SESSION}`)?.total;
    expect(await until(() => total() === 4108 + 3)).toBe(true);
    expect(total()).toBe(4108 + 3);
  });
});

describe("a pipeline agent whose session is quiet or stopped", () => {
  it("gets its desk when its session's log was quiet at start (followed from its end)", async () => {
    const old = new Date(Date.now() - 3600_000);
    utimesSync(logs.paths().session, old, old);
    const { board } = logs.start();
    const pipeline = () => deskOf(board.desks(NOW), "pipeline agent");
    expect(await until(() => pipeline()?.stepCount === 3)).toBe(true);
    expect(deskOf(board.desks(NOW), "main session")).toBeUndefined();
    expect(pipeline()).toMatchObject({ id: "agent:pipe7", project: "shop-app", state: "working" });
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
    const desk = (id: string) => deskById(board.desks(NOW), id);
    expect(await until(() => desk("agent:pipe7")?.stepCount === 3 && desk("agent:bg2")?.stepCount === 1)).toBe(true);
    expect(desk("agent:pipe7")?.project).toBe("shop-app");
    expect(desk("agent:bg2")?.project).toBe("shop-app");
  });

  it("waits for the owner when its session hits a usage limit, until the session goes on", async () => {
    const { board } = await logs.open();
    const pipeline = () => deskOf(board.desks(NOW), "pipeline agent");
    expect(pipeline()?.state).toBe("working");
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:30.000Z"));
    expect(await until(() => pipeline()?.state === "waits")).toBe(true);
    expect(pipeline()?.steps?.at(-1)).toBe(STOPPED);
    appendFileSync(
      logs.paths().session,
      logs.line({
        type: "assistant",
        timestamp: "2026-10-29T09:04:40.000Z",
        message: { id: "msg_m4", model: "claude-opus-5-5", content: [{ type: "text", text: "Going on." }] },
      }),
    );
    expect(await until(() => pipeline()?.state === "working")).toBe(true);
  });
});

describe("waits for you", () => {
  it("says a session waits for the owner at a usage limit, with its reset time, until its next real step", async () => {
    const { board } = await logs.open();
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:30.000Z"));
    const main = () => deskOf(board.desks(NOW), "main session");
    expect(await until(() => main()?.state === "waits")).toBe(true);
    // The reason is the desk's newest step, after the current step and the one before it.
    expect(main()?.steps).toEqual(["Editing src/cart.ts", "Run the tests", STOPPED]);
    expect(main()?.action).toBeUndefined(); // read only: no button
    expect(board.desks(NOW).list?.[0]?.state).toBe("waits"); // waiting desks come first
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
    expect(await until(() => main()?.state === "working")).toBe(true);
    expect(main()?.steps).not.toContain(STOPPED);
  });

  it("stops waiting once the agent's question is answered", async () => {
    const { board } = await logs.open();
    expect(deskOf(board.desks(NOW), "background agent")?.state).toBe("waits");
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
    expect(await until(() => deskOf(board.desks(NOW), "background agent")?.state !== "waits")).toBe(true);
  });

  /** The owner answers the background agent, so only its session's trouble can make it wait. */
  const answer = () =>
    appendFileSync(
      join(logs.paths().subagents, "agent-bg1.jsonl"),
      logs.line({
        isSidechain: true,
        agentId: "bg1",
        type: "user",
        timestamp: "2026-10-29T09:03:40.000Z",
        message: { role: "user", content: [{ tool_use_id: "tu_b3", type: "tool_result", content: "Before" }] },
      }),
    );

  it("does not wait for a usage limit its session hits after the agent finished", async () => {
    const { board } = await logs.open();
    answer();
    appendFileSync(
      join(logs.paths().subagents, "agent-bg1.jsonl"),
      logs.line({
        isSidechain: true,
        agentId: "bg1",
        type: "assistant",
        timestamp: "2026-10-29T09:03:50.000Z",
        message: {
          id: "msg_b4",
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Docs done." }],
        },
      }),
    );
    const background = () => deskOf(board.desks(NOW), "background agent");
    expect(await until(() => background()?.state === "idle")).toBe(true);
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:30.000Z"));
    expect(await until(() => deskOf(board.desks(NOW), "main session")?.state === "waits")).toBe(true);
    expect(background()?.state).toBe("idle");
    expect(background()?.steps).toEqual(["Reading guide.md", "Editing guide.md", "AskUserQuestion"]);
    expect(board.desks(NOW).list?.[0]?.role).toBe("main session"); // the finished agent does not sort to the top
  });

  it("waits with its session when the agent is still working at the limit", async () => {
    const { board } = await logs.open();
    answer();
    const background = () => deskOf(board.desks(NOW), "background agent");
    expect(await until(() => background()?.state === "working")).toBe(true);
    appendFileSync(logs.paths().session, logs.limitLine("2026-10-29T09:04:30.000Z"));
    expect(await until(() => background()?.state === "waits")).toBe(true);
    expect(background()?.steps?.at(-1)).toBe(STOPPED);
  });
});
