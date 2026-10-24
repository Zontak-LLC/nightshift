import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type NightEvent, parseAgentMeta, parseJournalLine, parseLine, type RunEvent } from "../parser/index.js";
import { advance, START, startAt, type TailState } from "./tail.js";

export type WatchOptions = {
  /** Claude Code's projects folder (one sub-folder per project, one .jsonl log per session). */
  root: string;
  /** How often to look for new lines, in ms. Once a second keeps "Now" under the spec's 2 seconds. */
  everyMs?: number;
  /** On start, files changed within this window are read, so a running session shows at once. */
  recentMs?: number;
  /** A file bigger than this, when first seen, is read from its last `tailBytes` only (old history is not "now"). */
  tailBytes?: number;
  onEvent: (event: NightEvent) => void;
  /** A workflow's journal changed: an agent started or finished, or the run's ticket queue arrived. */
  onRun?: (event: RunEvent) => void;
  onSkipped?: (count: number) => void;
  /** A problem that did not stop the watcher (an unreadable folder, a failing `onEvent`). */
  onError?: (error: unknown) => void;
};

type Followed = { tail: TailState; ino: number };

/** A log to follow. A journal is a workflow's ticket list; everything else is a session or agent conversation. */
type LogFile = {
  path: string;
  journal: { runId: string; sessionId: string } | null;
  /** A background agent's `agent-<id>.meta.json`: a small JSON file with the description it was started with. */
  meta?: { sessionId: string; agentId: string };
};

const jsonl = async (dir: string): Promise<string[]> =>
  (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));

/** The workflows of one session: each run's journal FIRST (so its agents are known), then the agents' own logs. */
async function workflowLogs(sessionDir: string, sessionId: string): Promise<LogFile[]> {
  const out: LogFile[] = [];
  const workflows = join(sessionDir, "subagents", "workflows");
  for (const runId of await readdir(workflows).catch(() => [])) {
    const files = await jsonl(join(workflows, runId));
    const journal = files.find((f) => f.endsWith("journal.jsonl"));
    if (journal) out.push({ path: journal, journal: { runId, sessionId } });
    for (const f of files) if (f !== journal) out.push({ path: f, journal: null });
  }
  return out;
}

/** One session folder's logs: its workflows, its background agents' logs and their `.meta.json` descriptions. */
async function sessionLogs(path: string, sessionId: string): Promise<LogFile[]> {
  const out = await workflowLogs(path, sessionId);
  const subagents = join(path, "subagents");
  for (const f of await jsonl(subagents)) out.push({ path: f, journal: null });
  for (const f of await readdir(subagents).catch(() => [])) {
    const agentId = /^agent-(.+)\.meta\.json$/.exec(f)?.[1];
    if (agentId) out.push({ path: join(subagents, f), journal: null, meta: { sessionId, agentId } });
  }
  return out;
}

/** Every log under `root`, or null when `root` does not exist (yet). Session folders hold their agents' logs. */
async function logFiles(root: string): Promise<LogFile[] | null> {
  const projects = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (!projects) return null;
  const out: LogFile[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push({ path, journal: null });
      else if (entry.isDirectory()) out.push(...(await sessionLogs(path, entry.name)));
    }
  }
  return out;
}

/** The bytes from `from` to `to`; fewer when the file shrank meanwhile (never zero padding). */
async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  if (to <= from) return Buffer.alloc(0);
  const handle = await open(path, "r"); // read only: Night Shift never writes to Claude Code's files
  try {
    const buf = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buf, 0, buf.length, from);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Follows every session log under `root`; returns a function that stops it. */
export function watchLogs(opts: WatchOptions): () => void {
  const {
    root,
    everyMs = 1000,
    recentMs = 10 * 60_000,
    tailBytes = 256_000,
    onEvent,
    onRun,
    onSkipped,
    onError,
  } = opts;
  const files = new Map<string, Followed>();
  /** meta file -> the size last read (it is written once, then left alone). */
  const metas = new Map<string, number>();
  let first = true;
  let busy = false;
  let stopped = false;

  function firstTail(size: number, mtimeMs: number): TailState {
    if (!first) return START; // a file that appears later is brand new: read it all
    if (Date.now() - mtimeMs > recentMs) return startAt(size); // quiet: only new lines from now on
    return size > tailBytes ? startAt(size - tailBytes) : START;
  }

  /** One failing listener must not lose the rest of the lines. */
  function safely(call: () => void): void {
    try {
      call();
    } catch (error) {
      onError?.(error);
    }
  }

  function emit(lines: string[], journal: LogFile["journal"]): void {
    let skipped = 0;
    for (const line of lines) {
      if (stopped) return;
      if (journal) {
        const r = parseJournalLine(line, journal);
        skipped += r.skipped;
        for (const e of r.events) safely(() => onRun?.(e));
        continue;
      }
      const r = parseLine(line);
      skipped += r.skipped;
      for (const e of r.events) safely(() => onEvent(e));
    }
    if (skipped && onSkipped) onSkipped(skipped);
  }

  /** Reads what one file gained since the last look and returns its complete new lines. */
  async function newLines({ path, journal }: LogFile): Promise<string[]> {
    const info = await stat(path).catch(() => null);
    if (!info) return [];
    const known = files.get(path);
    // A different file under the same name (replaced, not appended to), or one that shrank: read it from the top.
    const replaced = known && (known.ino !== info.ino || info.size < known.tail.offset);
    if (known && !replaced && info.size === known.tail.offset) return [];
    // A journal is the run's whole ticket list (small): always read it from its start.
    const fresh = journal ? START : firstTail(info.size, info.mtimeMs);
    const tail = known && !replaced ? known.tail : known ? START : fresh;
    const chunk = await readRange(path, tail.offset, info.size).catch(() => Buffer.alloc(0));
    const step = advance(tail, chunk);
    files.set(path, { tail: step.state, ino: info.ino });
    return step.lines;
  }

  /** An agent's description, read once per change of the file (a half-written one is retried on the next look). */
  async function readMeta(file: LogFile & { meta: NonNullable<LogFile["meta"]> }): Promise<void> {
    const info = await stat(file.path).catch(() => null);
    if (!info || metas.get(file.path) === info.size) return;
    const text = await readFile(file.path, "utf8").catch(() => null);
    if (text === null) return;
    const event = parseAgentMeta(text, file.meta.sessionId, file.meta.agentId);
    if (event) safely(() => onEvent({ ...event, agentId: file.meta.agentId }));
    metas.set(file.path, info.size);
  }

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      const paths = await logFiles(root);
      for (const file of paths ?? []) {
        if (file.meta) await readMeta({ ...file, meta: file.meta });
        else emit(await newLines(file), file.journal);
      }
      if (paths) first = false; // a folder that appears later is new work: read it all
    } finally {
      busy = false;
    }
  }

  const run = () => void tick().catch((error: unknown) => onError?.(error));
  run();
  const timer = setInterval(run, everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
