// Lens froze on 2026-11-01 and nobody noticed: the board stopped at "last active Nov 1" while /health still said ok.
// These scenarios keep both halves fixed: the watcher keeps reading whatever one file does, and /health tells the truth.
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startEngine } from "../src/engine.js";
import type { NightEvent } from "../src/parser/index.js";
import { startServer } from "../src/server/index.js";
import { healthOf, watchLogs } from "../src/watcher/index.js";

const line = (o: Record<string, unknown>) =>
  `${JSON.stringify({ sessionId: "s1", cwd: "/work/demo-app", gitBranch: "main", timestamp: "2026-11-01T23:49:00.000Z", ...o })}\n`;
const toolUse = (id: string, file: string) =>
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: `/work/demo-app/${file}` } }] },
  });
// A long session carries big tool results; pad each line so a few thousand of them make megabytes.
const bigStep = (i: number) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "x".repeat(2_000) }] },
  });
const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return check();
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const edits = (events: NightEvent[]) => events.flatMap((e) => (e.kind === "tool.use" ? [e.summary] : []));

let dir = "";
let stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  rmSync(dir, { recursive: true, force: true });
});
const setup = () => {
  dir = mkdtempSync(join(tmpdir(), "lens-stale-"));
  mkdirSync(join(dir, "demo-app"));
  return join(dir, "demo-app");
};

describe("a very long session keeps growing while Lens watches", () => {
  it("reads a huge log a slice at a time, never whole, and still sees the step written last", async () => {
    const project = setup();
    const events: NightEvent[] = [];
    const reads: number[] = [];
    const chunkBytes = 64_000;
    stops.push(
      watchLogs({
        root: dir,
        everyMs: 10,
        chunkBytes,
        onEvent: (e) => events.push(e),
        onLines: (n) => reads.push(n),
      }),
    );
    await wait(50); // Lens is running; the session starts after it did, so it is read from its start
    const log = join(project, "s1.jsonl");
    const body = Array.from({ length: 1_000 }, (_, i) => bigStep(i)).join(""); // about 2 MB
    writeFileSync(log, toolUse("first", "first.ts") + body);
    await wait(30);
    appendFileSync(log, body + toolUse("last", "last.ts")); // it keeps growing while Lens catches up
    expect(await until(() => edits(events).includes("Editing last.ts"), 10_000)).toBe(true);
    expect(edits(events)).toEqual(["Editing first.ts", "Editing last.ts"]);
    const lineBytes = bigStep(0).length;
    expect(Math.max(...reads)).toBeLessThanOrEqual(Math.ceil(chunkBytes / lineBytes) + 1); // one slice per look
    expect(reads.length).toBeGreaterThan(body.length / chunkBytes); // so it took many looks, not one
  });

  it("reports a log it cannot read once, and keeps reading the others", async () => {
    const project = setup();
    const locked = join(project, "locked.jsonl");
    writeFileSync(locked, toolUse("x", "x.ts"));
    const old = new Date(Date.now() - 20 * 60_000);
    utimesSync(locked, old, old); // quiet for 20 minutes: Lens follows it from its end, its old step is history
    chmodSync(locked, 0o200); // the session can still write it; Lens cannot read it
    const events: NightEvent[] = [];
    const errors: string[] = [];
    stops.push(
      watchLogs({
        root: dir,
        everyMs: 10,
        onEvent: (e) => events.push(e),
        onError: (e) => errors.push(e instanceof Error ? e.message : String(e)),
      }),
    );
    writeFileSync(join(project, "s2.jsonl"), toolUse("t1", "a.ts"));
    expect(await until(() => edits(events).includes("Editing a.ts"))).toBe(true);
    appendFileSync(locked, toolUse("y", "y.ts"));
    await wait(100);
    expect(errors.filter((m) => m.includes("locked.jsonl"))).toHaveLength(1); // said once, not every second
    chmodSync(locked, 0o600); // readable again: its new step shows, and its old history is not replayed as new
    expect(await until(() => edits(events).includes("Editing y.ts"))).toBe(true);
    expect(edits(events)).not.toContain("Editing x.ts");
  });

  it("passes over a file whose read never comes back, says so, and goes on with the rest", async () => {
    const project = setup();
    const subagents = join(project, "s1", "subagents");
    mkdirSync(subagents, { recursive: true });
    const pipe = join(subagents, "agent-a1.meta.json");
    execFileSync("mkfifo", [pipe]); // reading a pipe with no writer blocks, like a read that never returns
    const events: NightEvent[] = [];
    const errors: string[] = [];
    stops.push(
      watchLogs({
        root: dir,
        everyMs: 10,
        stuckMs: 200,
        onEvent: (e) => events.push(e),
        onError: (e) => errors.push(e instanceof Error ? e.message : String(e)),
      }),
    );
    // The new session's log is listed AFTER the stuck file (its folder sorts later), so a stuck look would hide it.
    mkdirSync(join(dir, "z-app"));
    writeFileSync(join(dir, "z-app", "s9.jsonl"), toolUse("t1", "after.ts"));
    expect(await until(() => edits(events).includes("Editing after.ts"))).toBe(true);
    expect(errors.some((m) => m.includes("agent-a1.meta.json") && m.includes("no answer"))).toBe(true);
    closeSync(openSync(pipe, "w")); // let the blocked read finish, so the test leaves no thread behind
  });
});

describe("/health tells the truth", () => {
  it("says stale (503) when logs change but no line was read for the window, with the time of the last line", async () => {
    const project = setup();
    const log = join(project, "s1.jsonl");
    const engine = startEngine({ root: dir, dbPath: ":memory:", everyMs: 10, staleMs: 300 });
    stops.push(engine.stop);
    writeFileSync(log, toolUse("t1", "a.ts"));
    expect(await until(() => engine.health().lastLineAt !== null)).toBe(true);
    const lastLineAt = engine.health().lastLineAt;
    chmodSync(log, 0o200); // write only: from now on Lens cannot read it, but the session goes on writing
    const server = await startServer(0, { view: () => ({}), projects: () => [], health: () => engine.health() });
    stops.push(() => void server.close());
    for (let i = 0; i < 8; i++) {
      appendFileSync(log, toolUse(`t${i + 2}`, "b.ts"));
      await wait(60);
    }
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, status: "stale", lastLineAt });
    expect(Date.parse(String(body.lastChangeAt))).toBeGreaterThan(Date.parse(String(lastLineAt)));
    chmodSync(log, 0o600);
  });

  it("says ok on a quiet computer: nothing read for hours, but no log changed either", async () => {
    const project = setup();
    writeFileSync(join(project, "s1.jsonl"), toolUse("t1", "a.ts"));
    const engine = startEngine({ root: dir, dbPath: ":memory:", everyMs: 10, staleMs: 100 });
    stops.push(engine.stop);
    expect(await until(() => engine.health().lastLineAt !== null)).toBe(true);
    const later = Date.now() + 3 * 3_600_000; // three hours on, nobody has typed anything
    expect(engine.health(later)).toMatchObject({ ok: true, status: "ok" });
    const server = await startServer(0, { view: () => ({}), projects: () => [], health: () => engine.health(later) });
    stops.push(() => void server.close());
    expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(200);
  });

  it("says ok while lines keep coming, and on an empty folder", () => {
    const now = Date.parse("2026-11-07T11:00:00Z");
    const min = 60_000;
    const keepingUp = { startedMs: now - 600 * min, lastLineMs: now - min, newestChangeMs: now - min, nowMs: now };
    expect(healthOf(keepingUp).status).toBe("ok");
    expect(healthOf({ startedMs: now - 600 * min, lastLineMs: null, newestChangeMs: null, nowMs: now }).ok).toBe(true);
    // The freeze itself: last line at 23:49, the session wrote on until this morning.
    const frozen = {
      startedMs: now - 900 * min,
      lastLineMs: now - 671 * min,
      newestChangeMs: now - 2 * min,
      nowMs: now,
    };
    expect(healthOf(frozen)).toEqual({
      ok: false,
      status: "stale",
      lastLineAt: new Date(now - 671 * min).toISOString(),
      lastChangeAt: new Date(now - 2 * min).toISOString(),
    });
  });
});
