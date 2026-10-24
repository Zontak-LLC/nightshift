import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NightEvent, RunEvent } from "../src/parser/index.js";
import { advance, START, startAt, watchLogs } from "../src/watcher/index.js";

const line = (o: Record<string, unknown>) =>
  `${JSON.stringify({ sessionId: "s1", cwd: "/work/demo-app", gitBranch: "main", timestamp: "2026-10-23T22:00:00.000Z", ...o })}\n`;
const toolUse = (id: string, file: string) =>
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: `/work/demo-app/${file}` } }] },
  });
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};

describe("following a growing file", () => {
  const b = (text: string) => Buffer.from(text, "utf8");

  it("hands back complete lines and keeps a half-written one until the rest arrives", () => {
    const a = advance(START, b('one\n{"ha'));
    expect(a.lines).toEqual(["one"]);
    const c = advance(a.state, b('lf"}\n'));
    expect(c.lines).toEqual(['{"half"}']);
    expect(c.state.offset).toBe(13); // 8 + 5 bytes
  });

  it("keeps a character whole when a read ends in the middle of it", () => {
    const euro = b("paid 5 €\n"); // the euro sign is 3 bytes
    const cut = euro.length - 2; // inside the euro sign
    const a = advance(START, euro.subarray(0, cut));
    const c = advance(a.state, euro.subarray(cut));
    expect([...a.lines, ...c.lines]).toEqual(["paid 5 €"]);
  });

  it("starting mid-file drops only the cut line, never a whole one", () => {
    const text = b("first\nsecond\nthird\n");
    const midLine = advance(startAt(3), text.subarray(2)); // starts inside "first"
    expect(midLine.lines).toEqual(["second", "third"]);
    const onBoundary = advance(startAt(6), text.subarray(5)); // starts exactly at "second"
    expect(onBoundary.lines).toEqual(["second", "third"]);
  });
});

// SPEC scenarios 1 and 2, live: a session starts and works; each step reaches the stream within 2 seconds.
describe("a developer runs Claude Code while Night Shift watches", () => {
  let dir = "";
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("sees a new session and each new step as it is written, even a line written in two halves", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-"));
    mkdirSync(join(dir, "demo-app"));
    const events: NightEvent[] = [];
    stop = watchLogs({ root: dir, everyMs: 50, onEvent: (e) => events.push(e) });
    const log = join(dir, "demo-app", "s1.jsonl");
    writeFileSync(log, toolUse("t1", "a.ts"));
    expect(await until(() => events.some((e) => e.kind === "tool.use"))).toBe(true);
    const second = toolUse("t2", "b.ts");
    appendFileSync(log, second.slice(0, 40));
    await new Promise((r) => setTimeout(r, 200));
    appendFileSync(log, second.slice(40));
    expect(await until(() => events.filter((e) => e.kind === "tool.use").length === 2)).toBe(true);
    const summaries = events.flatMap((e) => (e.kind === "tool.use" ? [e.summary] : []));
    expect(summaries).toEqual(["Editing a.ts", "Editing b.ts"]);
  });

  it("does not replay old, quiet logs as if they were happening now", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-"));
    mkdirSync(join(dir, "old-app"));
    const old = join(dir, "old-app", "s0.jsonl");
    writeFileSync(old, toolUse("old", "x.ts"));
    const tenMinutesAgo = new Date(Date.now() - 11 * 60_000);
    utimesSync(old, tenMinutesAgo, tenMinutesAgo);
    const events: NightEvent[] = [];
    stop = watchLogs({ root: dir, everyMs: 50, onEvent: (e) => events.push(e) });
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual([]);
    appendFileSync(old, toolUse("new", "y.ts"));
    expect(await until(() => events.some((e) => e.kind === "tool.use"))).toBe(true);
    expect(events.flatMap((e) => (e.kind === "tool.use" ? [e.summary] : []))).toEqual(["Editing y.ts"]);
  });

  it("reads a whole session that starts after Night Shift did, and a log that is replaced", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-"));
    const events: NightEvent[] = [];
    stop = watchLogs({ root: dir, everyMs: 50, onEvent: (e) => events.push(e) });
    await new Promise((r) => setTimeout(r, 150)); // the logs folder does not exist yet
    mkdirSync(join(dir, "demo-app"));
    const log = join(dir, "demo-app", "s1.jsonl");
    writeFileSync(log, toolUse("t1", "a.ts") + toolUse("t2", "b.ts"));
    const edits = () => events.flatMap((e) => (e.kind === "tool.use" ? [e.summary] : []));
    expect(await until(() => edits().length === 2)).toBe(true);
    const other = join(dir, "demo-app", "next.tmp");
    writeFileSync(other, toolUse("t3", "c.ts") + toolUse("t4", "d.ts")); // same size, a different file
    renameSync(other, log);
    expect(await until(() => edits().length === 4)).toBe(true);
    expect(edits()).toEqual(["Editing a.ts", "Editing b.ts", "Editing c.ts", "Editing d.ts"]);
  });

  it("reads only the recent end of a big log, without a broken first line", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-"));
    mkdirSync(join(dir, "demo-app"));
    const lines = Array.from({ length: 40 }, (_, i) => toolUse(`t${i}`, `f${i}.ts`));
    writeFileSync(join(dir, "demo-app", "s1.jsonl"), lines.join(""));
    const events: NightEvent[] = [];
    let skipped = 0;
    const tailBytes = (lines[0] ?? "").length * 3 + 10; // three whole lines and part of a fourth
    stop = watchLogs({
      root: dir,
      everyMs: 50,
      tailBytes,
      onEvent: (e) => events.push(e),
      onSkipped: (n) => (skipped += n),
    });
    expect(await until(() => events.filter((e) => e.kind === "tool.use").length === 3)).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(events.flatMap((e) => (e.kind === "tool.use" ? [e.summary] : []))).toEqual([
      "Editing f37.ts",
      "Editing f38.ts",
      "Editing f39.ts",
    ]);
    expect(skipped).toBe(0);
  });

  it("keeps watching when a listener throws", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-"));
    mkdirSync(join(dir, "demo-app"));
    writeFileSync(join(dir, "demo-app", "s1.jsonl"), toolUse("t1", "a.ts") + toolUse("t2", "b.ts"));
    const seen: string[] = [];
    const errors: unknown[] = [];
    stop = watchLogs({
      root: dir,
      everyMs: 50,
      onEvent: (e) => {
        if (e.kind !== "tool.use") return;
        seen.push(e.summary);
        if (seen.length === 1) throw new Error("listener broke");
      },
      onError: (e) => errors.push(e),
    });
    expect(await until(() => seen.length === 2)).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it("follows a pipeline: its journal (always from the start) and each agent's own log, tagged with the agent", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-"));
    const run = join(dir, "demo-app", "s-demo-1", "subagents", "workflows", "wf_demo");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(dir, "demo-app", "s-demo-1.jsonl"), toolUse("t0", "main.ts"));
    writeFileSync(
      join(run, "journal.jsonl"),
      `${JSON.stringify({ type: "started", agentId: "agent-13", label: "#13 Dark mode toggle" })}\n`,
    );
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(join(run, "journal.jsonl"), old, old); // even a quiet journal is read whole: it is the run's ticket list
    writeFileSync(
      join(run, "agent-agent-13.jsonl"),
      line({
        type: "assistant",
        agentId: "agent-13",
        isSidechain: true,
        message: {
          content: [{ type: "tool_use", id: "x1", name: "Edit", input: { file_path: "/work/demo-app/header.tsx" } }],
        },
      }),
    );
    const runs: RunEvent[] = [];
    const steps: NightEvent[] = [];
    stop = watchLogs({ root: dir, everyMs: 50, onEvent: (e) => steps.push(e), onRun: (e) => runs.push(e) });
    expect(
      await until(() => runs.length > 0 && steps.some((e) => e.kind === "tool.use" && e.agentId === "agent-13")),
    ).toBe(true);
    expect(runs[0]).toMatchObject({ kind: "agent.started", runId: "wf_demo", sessionId: "s-demo-1", number: 13 });
    expect(steps.find((e) => e.kind === "tool.use" && e.agentId === "agent-13")).toMatchObject({
      summary: "Editing header.tsx",
    });
  });
});
