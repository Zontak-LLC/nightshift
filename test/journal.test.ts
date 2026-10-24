import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { numberInLabel, parseJournalLine, type RunEvent, titleInLabel } from "../src/parser/index.js";

const place = { runId: "wf_demo", sessionId: "s-demo-1" };
const read = (lines: string[]) => lines.flatMap((l) => parseJournalLine(l, place).events);

describe("a pipeline's journal becomes ticket events", () => {
  it("reads a whole run: the ranked queue, each ticket started and finished", () => {
    const lines = readFileSync(new URL("./fixtures/workflow-journal.jsonl", import.meta.url), "utf8")
      .trim()
      .split("\n");
    const events = read(lines);
    expect(events.map((e) => e.kind)).toEqual([
      "run.launched",
      "agent.started",
      "run.queue",
      "agent.result",
      "agent.started",
      "agent.result",
      "agent.started",
      "agent.result",
      "agent.started",
    ]);
    const queue = events.find((e): e is Extract<RunEvent, { kind: "run.queue" }> => e.kind === "run.queue");
    expect(queue?.tickets).toEqual([
      { number: 11, title: "Fix the login redirect" },
      { number: 12, title: "Export timesheets as CSV" },
      { number: 13, title: "Dark mode toggle in the header" },
    ]);
    const done = events.find((e) => e.kind === "agent.result" && e.agentId === "agent-11");
    expect(done).toMatchObject({
      number: 11,
      status: "merged",
      pr: "https://github.com/example/demo-app/pull/41",
      summary: "The redirect now keeps the page the person asked for.",
    });
    expect(events.find((e) => e.kind === "agent.started" && e.agentId === "agent-13")).toMatchObject({
      number: 13,
      label: "#13 Dark mode toggle in the header",
      phase: "Fix",
    });
  });

  it("knows a ticket by the number at the start of its label, and a helper step by having none", () => {
    expect(numberInLabel("#70 Native mobile app")).toBe(70);
    expect(numberInLabel("rank open tickets")).toBeNull();
    expect(numberInLabel("land #234 and #235")).toBeNull();
    expect(titleInLabel("#70 Native mobile app")).toBe("Native mobile app");
  });

  it("shows only a GitHub pull request or #n as a link, and a short status word", () => {
    const result = (r: object) => read([JSON.stringify({ type: "result", agentId: "a", result: r })])[0];
    expect(result({ pr: "javascript:alert(1)" })).toMatchObject({ pr: null });
    expect(result({ pr: "https://evil.example/pull/1" })).toMatchObject({ pr: null });
    expect(result({ pr: "#253" })).toMatchObject({ pr: "#253" });
    expect(result({ status: "Merged! <b>" })).toMatchObject({ status: null });
    expect(result({ number: 1.5 })).toMatchObject({ number: null });
  });

  it("never shows a secret from a summary or a label", () => {
    const fake = "ghp_FAKE0000000000000000000000000000000000";
    const [res] = read([
      JSON.stringify({ type: "result", agentId: "a", result: { summary: `Pushed with token ${fake} and done.` } }),
    ]);
    expect(JSON.stringify(res)).not.toContain(fake);
    const [start] = read([JSON.stringify({ type: "started", agentId: "b", label: `#5 use API_KEY=${fake}` })]);
    expect(JSON.stringify(start)).not.toContain(fake);
  });

  it("skips and counts a broken or unknown line, never throws", () => {
    for (const line of ["{", "[]", "null", '{"type":"started"}', '{"type":"mystery"}']) {
      expect(parseJournalLine(line, place)).toEqual({ events: [], skipped: 1 });
    }
    expect(parseJournalLine("   ", place)).toEqual({ events: [], skipped: 0 });
  });
});
