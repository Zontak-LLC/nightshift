import { describe, expect, it } from "vitest";
import { parseLine } from "../src/parser/index.js";
import { Board } from "../src/store/index.js";
import { terminalPrinter } from "../src/terminal.js";

// Invented lines in the exact shapes Claude Code writes (found in real logs on 2026-10-24; no real ids or text).
const base = {
  type: "assistant",
  sessionId: "s-demo-1",
  cwd: "/work/demo-app",
  gitBranch: "main",
  isApiErrorMessage: true,
};
const RESET = 1_893_456_000; // a fixed future reset time, in Unix seconds
const limitLine = (at: string, extra: object = {}) =>
  JSON.stringify({
    ...base,
    timestamp: at,
    error: "rate_limit",
    apiErrorStatus: 429,
    quotaLimits: { status: "rejected", resetsAt: RESET, rateLimitType: "five_hour" },
    message: { content: [{ type: "text", text: "You've hit your session limit · resets 8:40pm (America/New_York)" }] },
    ...extra,
  });
const step = (at: string, extra: object = {}) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "s-demo-1",
    cwd: "/work/demo-app",
    timestamp: at,
    message: {
      content: [{ type: "tool_use", id: `t-${at}`, name: "Edit", input: { file_path: "/work/demo-app/a.ts" } }],
    },
    ...extra,
  });
const feed = (board: Board, lines: string[]) => {
  for (const l of lines) for (const e of parseLine(l).events) board.apply(e);
};

// Ticket 5: the board stays honest when work stops.
describe("when Claude stops, the board says why and when it comes back", () => {
  it("reads a usage limit from the structured fields: the reason, the reset time and the limit type", () => {
    const trouble = parseLine(limitLine("2026-10-23T23:40:00.000Z")).events.find((e) => e.kind === "session.trouble");
    expect(trouble).toMatchObject({
      reason: "usage_limit",
      resetsAt: new Date(RESET * 1000).toISOString(),
      limitType: "five_hour",
      text: "You've hit your session limit · resets 8:40pm (America/New_York)",
    });
    // The same line is trouble and nothing else (no "reply" step), besides announcing the session.
    expect(parseLine(limitLine("2026-10-23T23:40:00.000Z")).events.map((e) => e.kind)).toEqual([
      "session.seen",
      "session.trouble",
    ]);
    // A user line carrying the flag is not trouble (only Claude's own error lines are).
    const user = JSON.stringify({ ...base, type: "user", timestamp: "t", message: { content: "hello" } });
    expect(parseLine(user).events.some((e) => e.kind === "session.trouble")).toBe(false);
  });

  it("names lost connections, expired logins and anything else", () => {
    const reason = (error: string) =>
      parseLine(
        JSON.stringify({ ...base, timestamp: "t", error, message: { content: [{ type: "text", text: "x" }] } }),
      ).events.find((e) => e.kind === "session.trouble");
    expect(reason("server_error")).toMatchObject({ reason: "connection", resetsAt: null });
    expect(reason("authentication_failed")).toMatchObject({ reason: "login" });
    expect(reason("something_new")).toMatchObject({ reason: "api" });
  });

  it("pauses the session on the board, then clears by itself on the next real step", () => {
    const board = new Board();
    feed(board, [step("2026-10-23T23:30:00.000Z"), limitLine("2026-10-23T23:40:00.000Z")]);
    expect(board.view("demo-app").alerts).toEqual([
      expect.objectContaining({ who: "Session", reason: "usage_limit", since: "2026-10-23T23:40:00.000Z" }),
    ]);
    feed(board, [step("2026-10-24T01:41:00.000Z")]);
    expect(board.view("demo-app").alerts).toEqual([]);
  });

  it("pauses a pipeline ticket when its agent hits the limit, and only that ticket", () => {
    const board = new Board();
    feed(board, [step("2026-10-23T23:00:00.000Z")]);
    const place = { runId: "wf_demo", sessionId: "s-demo-1" };
    board.apply({
      kind: "run.queue",
      ...place,
      tickets: [
        { number: 13, title: "Dark mode" },
        { number: 14, title: "Export" },
      ],
    });
    board.apply({
      kind: "agent.started",
      ...place,
      agentId: "agent-13",
      label: "#13 Dark mode",
      phase: "Fix",
      number: 13,
    });
    feed(board, [limitLine("2026-10-23T23:40:00.000Z", { agentId: "agent-13", isSidechain: true })]);
    const view = board.view("demo-app");
    expect(view.alerts).toEqual([expect.objectContaining({ who: "#13", reason: "usage_limit" })]);
    expect(view.run?.columns.working.find((t) => t.number === 13)?.trouble).toMatchObject({ reason: "usage_limit" });
    expect(view.run?.columns.queued.find((t) => t.number === 14)?.trouble).toBeNull();
    feed(board, [step("2026-10-24T01:41:00.000Z", { agentId: "agent-13", isSidechain: true })]);
    expect(board.view("demo-app").alerts).toEqual([]);
  });

  it("prints the pause in the terminal with its reset time", () => {
    const print = terminalPrinter();
    const [seen, trouble] = parseLine(limitLine("2026-10-23T23:40:00.000Z")).events;
    if (!seen || !trouble) throw new Error("expected two events");
    print(seen);
    expect(print(trouble)).toMatch(/paused: usage limit · resets \d\d:\d\d$/);
  });

  it("clears the session pause when the conversation goes on with words only (no tool use)", () => {
    const board = new Board();
    feed(board, [step("2026-10-23T23:30:00.000Z"), limitLine("2026-10-23T23:40:00.000Z")]);
    const reply = JSON.stringify({
      type: "assistant",
      sessionId: "s-demo-1",
      timestamp: "2026-10-24T01:45:00.000Z",
      message: { content: [{ type: "text", text: "Picking up where we left off." }] },
    });
    feed(board, [reply]);
    expect(board.view("demo-app").alerts).toEqual([]);
  });

  it("drops the pause when the paused ticket finishes, and when it is restarted by a new agent", () => {
    const board = new Board();
    feed(board, [step("2026-10-23T23:00:00.000Z")]);
    const place = { runId: "wf_demo", sessionId: "s-demo-1" };
    board.apply({ kind: "run.queue", ...place, tickets: [{ number: 13, title: "Dark mode" }] });
    board.apply({
      kind: "agent.started",
      ...place,
      agentId: "agent-13",
      label: "#13 Dark mode",
      phase: "Fix",
      number: 13,
    });
    feed(board, [limitLine("2026-10-23T23:40:00.000Z", { agentId: "agent-13", isSidechain: true })]);
    // Restarted by a new agent: no pause carried over, and a late error from the old agent does not pause it again.
    board.apply({
      kind: "agent.started",
      ...place,
      agentId: "agent-13b",
      label: "#13 Dark mode",
      phase: "Fix",
      number: 13,
    });
    expect(board.view("demo-app").alerts).toEqual([]);
    feed(board, [limitLine("2026-10-23T23:50:00.000Z", { agentId: "agent-13", isSidechain: true })]);
    expect(board.view("demo-app").alerts).toEqual([]);
    // Paused, then finished: the finished ticket is not an alert.
    feed(board, [limitLine("2026-10-23T23:55:00.000Z", { agentId: "agent-13b", isSidechain: true })]);
    expect(board.view("demo-app").alerts).toHaveLength(1);
    board.apply({
      kind: "agent.result",
      ...place,
      agentId: "agent-13b",
      number: 13,
      status: "merged",
      pr: null,
      summary: null,
    });
    expect(board.view("demo-app").alerts).toEqual([]);
  });
});
