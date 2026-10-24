import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type NightEvent, parseJournalLine } from "../src/parser/index.js";
import { Board } from "../src/store/index.js";

const journal = readFileSync(new URL("./fixtures/workflow-journal.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n");
// Real agent ids are random and unique; a second run gets its own by prefixing them.
const runEvents = (runId: string, sessionId: string, prefix = "") =>
  journal.flatMap((l) => parseJournalLine(l.replaceAll('"agent-', `"${prefix}agent-`), { runId, sessionId }).events);
const seen = (sessionId: string, cwd: string, at = "2026-10-23T21:00:00.000Z"): NightEvent => ({
  kind: "session.seen",
  at,
  sessionId,
  cwd,
  branch: "next",
});
const step = (agentId: string, summary: string, at: string): NightEvent => ({
  kind: "tool.use",
  at,
  sessionId: "s-demo-1",
  agentId,
  toolUseId: `${agentId}-${at}`,
  tool: "Bash",
  summary,
});
const numbers = (list: { number: number }[]) => list.map((t) => t.number);

function demoNight(): Board {
  const board = new Board();
  board.apply(seen("s-demo-1", "/work/demo-app"));
  for (const e of runEvents("wf_demo", "s-demo-1")) board.apply(e);
  return board;
}

// SPEC scenario 4 (a workflow runs) and scenario 3 (two projects at once, never mixed).
describe("the board follows a pipeline through the night", () => {
  it("puts each ticket in its station: finished, skipped, and the one still being worked", () => {
    const run = demoNight().view("demo-app").run;
    expect(run?.runId).toBe("wf_demo");
    expect(numbers(run?.columns.done ?? [])).toEqual([11]);
    expect(numbers(run?.columns.skipped ?? [])).toEqual([12]);
    expect(numbers(run?.columns.working ?? [])).toEqual([13]);
    expect(run?.columns.done[0]).toMatchObject({
      title: "Fix the login redirect",
      status: "merged",
      pr: "https://github.com/example/demo-app/pull/41",
    });
  });

  it("moves a ticket to Checking while its agent runs the checks, and back to Working after", () => {
    const board = demoNight();
    board.apply(step("agent-13", "Editing src/header.tsx", "2026-10-23T21:10:00.000Z"));
    expect(numbers(board.view("demo-app").run?.columns.working ?? [])).toEqual([13]);
    board.apply(step("agent-13", "Running npm run ci", "2026-10-23T21:12:00.000Z"));
    const t = board.view("demo-app").run?.columns.checking[0];
    expect(t).toMatchObject({
      number: 13,
      step: "Running npm run ci",
      steps: 2,
      recent: ["Editing src/header.tsx", "Running npm run ci"],
    });
    board.apply(step("agent-13", "Editing src/header.tsx", "2026-10-23T21:14:00.000Z"));
    expect(numbers(board.view("demo-app").run?.columns.working ?? [])).toEqual([13]);
  });

  it("shows what is happening now: the working ticket and the session's own step", () => {
    const board = demoNight();
    board.apply(step("agent-13", "Running npx playwright test", "2026-10-23T21:20:00.000Z"));
    board.apply({
      kind: "tool.use",
      at: "2026-10-23T21:21:00.000Z",
      sessionId: "s-demo-1",
      toolUseId: "m1",
      tool: "Read",
      summary: "Reading docs/plan.md",
    });
    const now = board.view("demo-app").now;
    expect(now.map((r) => r.what)).toEqual(["Reading docs/plan.md", "Running npx playwright test"]);
    expect(now[1]?.who).toBe("#13");
  });

  it("sends a ticket started again (a resumed run) back to work without its old result", () => {
    const board = demoNight();
    board.apply({
      kind: "agent.started",
      runId: "wf_demo",
      sessionId: "s-demo-1",
      agentId: "agent-11b",
      label: "#11 Fix the login redirect",
      phase: "Fix",
      number: 11,
    });
    const run = board.view("demo-app").run;
    expect(numbers(run?.columns.working ?? [])).toEqual([11, 13]);
    expect(run?.columns.working.find((t) => t.number === 11)).toMatchObject({ status: null, pr: null });
  });

  it("keeps two projects apart: each board shows only its own run, the start page lists both", () => {
    const board = demoNight();
    board.apply(seen("s-other", "/work/other-app", "2026-10-23T22:00:00.000Z"));
    for (const e of runEvents("wf_other", "s-other", "other-")) board.apply(e);
    board.apply(step("agent-13", "Editing only/in/demo.ts", "2026-10-23T21:30:00.000Z"));
    expect(board.view("other-app").run?.runId).toBe("wf_other");
    expect(board.view("demo-app").run?.runId).toBe("wf_demo");
    expect(board.view("demo-app").folder).toBe("/work/demo-app");
    expect(board.view("other-app").now.map((r) => r.what)).not.toContain("Editing only/in/demo.ts");
    expect(
      board
        .projects()
        .map((p) => p.project)
        .sort(),
    ).toEqual(["demo-app", "other-app"]);
    expect(board.view("no-such-project")).toMatchObject({ run: null, now: [], folder: null });
  });

  it("ignores steps from an agent it does not know, and finished tickets do not move", () => {
    const board = demoNight();
    expect(board.apply(step("agent-unknown", "Editing x.ts", "2026-10-23T21:40:00.000Z"))).toBe(false);
    expect(board.apply(step("agent-11", "Editing late.ts", "2026-10-23T21:41:00.000Z"))).toBe(false);
    expect(numbers(board.view("demo-app").run?.columns.done ?? [])).toEqual([11]);
  });

  it("shows a newly started run at once, even before its first step, over an older busy run", () => {
    const board = demoNight();
    board.apply(step("agent-13", "Editing src/header.tsx", "2026-10-23T23:59:00.000Z"));
    board.apply({ kind: "run.launched", runId: "wf_next", sessionId: "s-demo-1" });
    expect(board.view("demo-app").run?.runId).toBe("wf_next");
  });

  it("ignores a late result from an earlier agent once the ticket was started again", () => {
    const board = demoNight();
    board.apply({
      kind: "agent.started",
      runId: "wf_demo",
      sessionId: "s-demo-1",
      agentId: "agent-13b",
      label: "#13 Dark mode toggle in the header",
      phase: "Fix",
      number: 13,
    });
    board.apply({
      kind: "agent.result",
      runId: "wf_demo",
      sessionId: "s-demo-1",
      agentId: "agent-13",
      number: 13,
      status: "merged",
      pr: null,
      summary: null,
    });
    expect(numbers(board.view("demo-app").run?.columns.working ?? [])).toEqual([13]);
    board.apply({
      kind: "agent.result",
      runId: "wf_demo",
      sessionId: "s-demo-1",
      agentId: "agent-13b",
      number: 13,
      status: "merged",
      pr: "#7",
      summary: null,
    });
    expect(board.view("demo-app").run?.columns.done.find((t) => t.number === 13)).toMatchObject({ pr: "#7" });
  });
});
