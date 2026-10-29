import { describe, expect, it } from "vitest";
import { parseLine } from "../src/parser/index.js";
import { Board } from "../src/store/index.js";

// Motherboard's Desks (issue 15): each desk's token count, read from the assistant lines of real-shaped logs.
describe("tokens are read from the assistant lines", () => {
  const usageLine = (id: string, output: number) =>
    JSON.stringify({
      type: "assistant",
      sessionId: "s-1",
      cwd: "/work/demo-app",
      timestamp: "2026-10-29T09:00:00.000Z",
      message: {
        id,
        model: "claude-opus-5-5",
        content: [{ type: "text", text: "Thinking it over." }],
        usage: {
          input_tokens: 1,
          output_tokens: output,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 100,
        },
      },
    });

  it("turns usage into a turn.usage event that never redraws a board page", () => {
    const events = parseLine(usageLine("msg_1", 5)).events;
    expect(events.map((e) => e.kind)).toEqual(["session.seen", "reply", "turn.usage"]);
    const usage = events.find((e) => e.kind === "turn.usage");
    expect(usage).toEqual({
      kind: "turn.usage",
      at: "2026-10-29T09:00:00.000Z",
      sessionId: "s-1",
      messageId: "msg_1",
      model: "claude-opus-5-5",
      inputTokens: 1,
      outputTokens: 5,
      cacheReadTokens: 10,
      cacheWriteTokens: 100,
    });
    const board = new Board();
    for (const e of events) if (e.kind !== "turn.usage") board.apply(e);
    expect(usage && board.apply(usage)).toBe(false);
  });

  it("counts one message written on three lines once, and a later message on top", () => {
    const board = new Board(() => null);
    for (const l of [usageLine("msg_1", 5), usageLine("msg_1", 5), usageLine("msg_1", 60), usageLine("msg_2", 7)])
      for (const e of parseLine(l).events) board.apply(e);
    const desk = board.desks(Date.parse("2026-10-29T09:01:00.000Z")).agents[0];
    expect(desk?.tokens).toEqual({ input: 2, output: 67, cacheRead: 20, cacheWrite: 200, total: 289 });
  });

  it("leaves tokens unknown for logs without usage, and skips Claude Code's synthetic lines", () => {
    const old = JSON.stringify({
      ...JSON.parse(usageLine("msg_1", 5)),
      message: { content: [{ type: "text", text: "Hi" }] },
    });
    expect(parseLine(old).events.some((e) => e.kind === "turn.usage")).toBe(false);
    const synthetic = usageLine("msg_9", 0).replace("claude-opus-5-5", "<synthetic>");
    expect(parseLine(synthetic).events.some((e) => e.kind === "turn.usage")).toBe(false);
    const board = new Board(() => null);
    for (const e of parseLine(old).events) board.apply(e);
    expect(board.desks(Date.parse("2026-10-29T09:01:00.000Z")).agents[0]).toMatchObject({ tokens: null, model: null });
  });
});
