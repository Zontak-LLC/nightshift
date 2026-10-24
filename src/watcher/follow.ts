import type { Stats } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type NightEvent, parseAgentMeta, parseJournalLine, parseLine, type RunEvent } from "../parser/index.js";
import { advance, committed, START, startAt, type TailState } from "./tail.js";

/** Where an event came from: a key that is the same every time the same line is read, so a store can tell a repeat. */
export type Origin = { key: string };
/** What a file looked like when the watcher last finished with it (kept by the store, handed back after a restart). */
export type FileMark = { ino: number; epoch: number; offset: number };

export type WatchOptions = {
  /** Claude Code's projects folder (one sub-folder per project, one .jsonl log per session). */
  root: string;
  /** How often to look for new lines, in ms. Once a second keeps "Now" under the spec's 2 seconds. */
  everyMs?: number;
  /** On start, files changed within this window are read, so a running session shows at once. */
  recentMs?: number;
  /** A file bigger than this, when first seen, is read from its last `tailBytes` only (old history is not "now"). */
  tailBytes?: number;
  onEvent: (event: NightEvent, origin: Origin) => void;
  /** A workflow's journal changed: an agent started or finished, or the run's ticket queue arrived. */
  onRun?: (event: RunEvent, origin: Origin) => void;
  /** Where a file got to last time: carry on from there (same file, not shorter) instead of guessing from its age. */
  resume?: (path: string) => FileMark | null;
  /** A file was read up to `offset` (the end of its last whole line): remember it. Called after its events. */
  onRead?: (path: string, mark: FileMark) => void;
  onSkipped?: (count: number) => void;
  /** A problem that did not stop the watcher (an unreadable folder, a failing `onEvent`). */
  onError?: (error: unknown) => void;
};

type Followed = { tail: TailState; ino: number; epoch: number };

/** A log to follow. A journal is a workflow's ticket list; everything else is a session or agent conversation. */
type Read = {
  path: string;
  ino: number;
  epoch: number;
  lines: string[];
  ends: number[];
  mark: FileMark | null;
};

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
    resume,
    onRead,
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

  function emit(read: Read, journal: LogFile["journal"]): void {
    let skipped = 0;
    const at = `${read.path}#${read.ino}.${read.epoch}`;
    read.lines.forEach((line, i) => {
      if (stopped) return;
      const key = (n: number) => ({ key: `${at}@${read.ends[i]}.${n}` });
      if (journal) {
        const r = parseJournalLine(line, journal);
        skipped += r.skipped;
        for (const [n, e] of r.events.entries()) safely(() => onRun?.(e, key(n)));
        return;
      }
      const r = parseLine(line);
      skipped += r.skipped;
      for (const [n, e] of r.events.entries()) safely(() => onEvent(e, key(n)));
    });
    if (skipped && onSkipped) onSkipped(skipped);
  }

  /** What was remembered about a file before this run, if it is still the same file and has not shrunk. */
  function remembered(path: string, ino: number, size: number): Followed | null {
    const saved = resume?.(path);
    if (!saved) return null;
    if (saved.ino === ino && size >= saved.offset) {
      return { tail: { offset: saved.offset, partial: Buffer.alloc(0), skipping: false }, ino, epoch: saved.epoch };
    }
    return { tail: START, ino, epoch: saved.epoch + 1 }; // replaced or cut short while we were away: read it anew
  }

  /** Where to read from and which epoch the file is in: carried on, read from the top, or a first look. */
  function placeFor(known: Followed | null, info: Stats, journal: boolean): { tail: TailState; epoch: number } {
    // A different file under the same name (replaced, not appended to), or one that shrank: read it from the top.
    const replaced = known && (known.ino !== info.ino || info.size < known.tail.offset);
    if (known && !replaced) return { tail: known.tail, epoch: known.epoch };
    if (known) return { tail: START, epoch: known.epoch + 1 };
    // A journal is the run's whole ticket list (small): always read it from its start.
    return { tail: journal ? START : firstTail(info.size, info.mtimeMs), epoch: 0 };
  }

  /** Reads what one file gained since the last look and returns its complete new lines. */
  async function newLines({ path, journal }: LogFile): Promise<Read | null> {
    const info = await stat(path).catch(() => null);
    if (!info) return null;
    const known = files.get(path) ?? remembered(path, info.ino, info.size);
    if (known && known.ino === info.ino && info.size === known.tail.offset) return null;
    const { tail, epoch } = placeFor(known, info, Boolean(journal));
    const chunk = await readRange(path, tail.offset, info.size).catch(() => Buffer.alloc(0));
    const step = advance(tail, chunk);
    files.set(path, { tail: step.state, ino: info.ino, epoch });
    const mark = step.state.skipping ? null : { ino: info.ino, epoch, offset: committed(step.state) };
    return { path, ino: info.ino, epoch, lines: step.lines, ends: step.ends, mark };
  }

  /** An agent's description, read once per change of the file (a half-written one is retried on the next look). */
  async function readMeta(file: LogFile & { meta: NonNullable<LogFile["meta"]> }): Promise<void> {
    const info = await stat(file.path).catch(() => null);
    if (!info || metas.get(file.path) === info.size) return;
    const text = await readFile(file.path, "utf8").catch(() => null);
    if (text === null) return;
    const event = parseAgentMeta(text, file.meta.sessionId, file.meta.agentId);
    const key = `${file.path}#meta@${info.size}.${Math.floor(info.mtimeMs)}.0`;
    if (event) safely(() => onEvent({ ...event, agentId: file.meta.agentId }, { key }));
    metas.set(file.path, info.size);
  }

  async function follow(file: LogFile): Promise<void> {
    const read = await newLines(file);
    if (!read) return;
    emit(read, file.journal);
    const mark = read.mark;
    if (mark && !stopped) safely(() => onRead?.(read.path, mark));
  }

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      const paths = await logFiles(root);
      for (const file of paths ?? []) {
        if (file.meta) await readMeta({ ...file, meta: file.meta });
        else await follow(file);
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
