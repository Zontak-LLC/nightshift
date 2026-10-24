import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startEngine } from "../src/engine.js";
import { History } from "../src/store/index.js";
import { advance, START } from "../src/watcher/index.js";

const line = (o: Record<string, unknown>) =>
  `${JSON.stringify({ sessionId: "s1", cwd: "/work/demo-app", gitBranch: "main", timestamp: "2026-10-23T22:00:00.000Z", ...o })}\n`;
const toolUse = (id: string, file: string, at = "2026-10-23T22:00:00.000Z") =>
  line({
    timestamp: at,
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: `/work/demo-app/${file}` } }] },
  });
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};
// One log line becomes two events: the session is seen, and the tool is used.
const PER_LINE = 2;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("line ends", () => {
  it("tells where each whole line ends in the file, blank lines and a cut first line included", () => {
    const text = Buffer.from("one\n\nsécond\n");
    const a = advance(START, text);
    expect(a.lines).toEqual(["one", "sécond"]);
    expect(a.ends).toEqual([4, text.length]);
    const mid = advance({ offset: 2, partial: Buffer.alloc(0), skipping: true }, text.subarray(2));
    expect(mid.lines).toEqual(["sécond"]);
    expect(mid.ends).toEqual([text.length]);
  });
});

// Spec ticket 6: stop and start; nothing lost, nothing doubled.
describe("a developer restarts Night Shift", () => {
  let dir = "";
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-hist-"));
    mkdirSync(join(dir, "logs", "demo-app"), { recursive: true });
    return {
      root: join(dir, "logs"),
      db: join(dir, "data", "nightshift.db"),
      log: join(dir, "logs", "demo-app", "s1.jsonl"),
    };
  };
  const open = (root: string, dbPath: string, seen: string[] = []) => {
    const engine = startEngine({
      root,
      dbPath,
      everyMs: 40,
      onNew: (e) => seen.push(e.kind === "tool.use" ? e.summary : e.kind),
    });
    stop = engine.stop;
    return engine;
  };
  const steps = (e: ReturnType<typeof open>) => e.board.view("demo-app").now.map((n) => n.what);

  it("gets the same board back, shows nothing twice, and picks up lines written while it was off", async () => {
    const { root, db, log } = setup();
    writeFileSync(log, toolUse("t1", "a.ts") + toolUse("t2", "b.ts"));
    const first: string[] = [];
    let engine = open(root, db, first);
    expect(await until(() => first.filter((k) => k.startsWith("Editing")).length === 2)).toBe(true);
    const stored = engine.history.count();
    stop();

    appendFileSync(log, toolUse("t3", "c.ts")); // written while Night Shift was off
    const second: string[] = [];
    engine = open(root, db, second);
    expect(steps(engine)).toEqual(["Editing b.ts"]); // history alone, before any file is read
    expect(await until(() => second.length > 0)).toBe(true);
    await wait(200);
    expect(second.filter((k) => k.startsWith("Editing"))).toEqual(["Editing c.ts"]); // only the new line
    expect(engine.history.count()).toBe(stored + PER_LINE);
    expect(steps(engine)).toEqual(["Editing c.ts"]);

    stop();
    const third: string[] = [];
    engine = open(root, db, third);
    await wait(300);
    expect(third).toEqual([]); // nothing new: nothing announced, nothing stored twice
    expect(engine.history.count()).toBe(stored + PER_LINE);
  });

  it("does not store a line twice when the saved offset is behind the events (a crash between the two writes)", async () => {
    const { root, db, log } = setup();
    writeFileSync(log, toolUse("t1", "a.ts"));
    let engine = open(root, db);
    expect(await until(() => engine.history.count() > 0)).toBe(true);
    const stored = engine.history.count();
    stop();
    const history = new History(db);
    const mark = history.file(log);
    expect(mark?.offset).toBeGreaterThan(0);
    history.saveFile(log, { ino: statSync(log).ino, epoch: 0, offset: 0 }); // the offset write was lost
    history.close();
    const seen: string[] = [];
    engine = open(root, db, seen);
    await wait(300);
    expect(seen).toEqual([]); // read again, recognised, not announced
    expect(engine.history.count()).toBe(stored);
    expect(engine.history.file(log)?.offset).toBe(mark?.offset); // and the offset is caught up
  });

  it("reads a file that was cut short while it was off, from its top", async () => {
    const { root, db, log } = setup();
    writeFileSync(log, toolUse("t1", "first-name.ts") + toolUse("t2", "second-name.ts"));
    let engine = open(root, db);
    expect(await until(() => engine.history.count() >= 2)).toBe(true);
    const stored = engine.history.count();
    stop();

    writeFileSync(log, toolUse("t9", "x.ts")); // shorter than the saved offset (the same file, emptied and rewritten)
    const seen: string[] = [];
    engine = open(root, db, seen);
    expect(await until(() => seen.includes("Editing x.ts"))).toBe(true);
    expect(engine.history.count()).toBe(stored + PER_LINE);
    expect(steps(engine)).toEqual(["Editing x.ts"]);
  });

  it("keeps a session whole and drops one that has been quiet for more than the retention", () => {
    const history = new History(":memory:");
    const day = 86_400_000;
    const now = Date.parse("2026-10-24T00:00:00Z");
    const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
    const seen = (sessionId: string, daysAgo: number) =>
      ({ kind: "session.seen", at: at(daysAgo), sessionId, cwd: "/w/a", branch: null }) as const;
    history.add(seen("old", 40), "k1");
    history.add(seen("old", 31), "k2");
    history.add(seen("long", 40), "k3"); // a long session: its first line is old, its last is recent
    history.add(seen("long", 2), "k4");
    history.add(seen("new", 1), "k5");
    history.saveFile("/logs/old.jsonl", { ino: 1, epoch: 0, offset: 10 }, now - 40 * day);
    history.saveFile("/logs/new.jsonl", { ino: 2, epoch: 0, offset: 10 }, now - day);
    expect(history.prune(30, now)).toBe(2);
    const left: string[] = [];
    history.replay((e) => left.push(e.sessionId));
    expect(left).toEqual(["long", "long", "new"]);
    expect(history.file("/logs/old.jsonl")).toBeNull();
    expect(history.file("/logs/new.jsonl")).toEqual({ ino: 2, epoch: 0, offset: 10 });
    expect(history.prune(30, now)).toBe(0);
  });

  it("stores a line once, whatever the file says, and a mark that did not move keeps its age", () => {
    const history = new History(":memory:");
    const e = {
      kind: "session.seen",
      at: "2026-10-23T22:00:00.000Z",
      sessionId: "s",
      cwd: "/w",
      branch: null,
    } as const;
    expect(history.add(e, "same")).toBe(true);
    expect(history.add(e, "same")).toBe(false);
    history.saveFile("/f", { ino: 1, epoch: 0, offset: 5 }, 100);
    history.saveFile("/f", { ino: 1, epoch: 0, offset: 5 }, 900);
    expect(history.prune(0.000001, 500)).toBeGreaterThanOrEqual(0);
    expect(history.file("/f")).toBeNull(); // updated at 100, not 900: it was not read since
  });

  it("runs without a history when the database cannot be opened, and says so", () => {
    const { root } = setup();
    const errors: unknown[] = [];
    const engine = startEngine({ root, dbPath: join(dir, "logs"), everyMs: 40, onError: (e) => errors.push(e) }); // a folder
    stop = engine.stop;
    expect(String(errors[0])).toContain("history unavailable");
  });
});
