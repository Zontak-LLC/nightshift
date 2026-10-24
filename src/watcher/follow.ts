import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type NightEvent, parseLine } from "../parser/index.js";
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
  onSkipped?: (count: number) => void;
  /** A problem that did not stop the watcher (an unreadable folder, a failing `onEvent`). */
  onError?: (error: unknown) => void;
};

type Followed = { tail: TailState; ino: number };

/** The session logs under `root`, or null when `root` does not exist (yet). */
async function logFiles(root: string): Promise<string[] | null> {
  const projects = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (!projects) return null;
  const out: string[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    for (const f of await readdir(join(root, project.name)).catch(() => [])) {
      if (f.endsWith(".jsonl")) out.push(join(root, project.name, f));
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
  const { root, everyMs = 1000, recentMs = 10 * 60_000, tailBytes = 256_000, onEvent, onSkipped, onError } = opts;
  const files = new Map<string, Followed>();
  let first = true;
  let busy = false;
  let stopped = false;

  function firstTail(size: number, mtimeMs: number): TailState {
    if (!first) return START; // a file that appears later is brand new: read it all
    if (Date.now() - mtimeMs > recentMs) return startAt(size); // quiet: only new lines from now on
    return size > tailBytes ? startAt(size - tailBytes) : START;
  }

  function emit(lines: string[]): void {
    let skipped = 0;
    for (const line of lines) {
      if (stopped) return;
      const r = parseLine(line);
      skipped += r.skipped;
      for (const e of r.events) {
        try {
          onEvent(e);
        } catch (error) {
          onError?.(error); // one failing listener must not lose the rest of the lines
        }
      }
    }
    if (skipped && onSkipped) onSkipped(skipped);
  }

  /** Reads what one file gained since the last look and returns its complete new lines. */
  async function newLines(path: string): Promise<string[]> {
    const info = await stat(path).catch(() => null);
    if (!info) return [];
    const known = files.get(path);
    // A different file under the same name (replaced, not appended to), or one that shrank: read it from the top.
    const replaced = known && (known.ino !== info.ino || info.size < known.tail.offset);
    if (known && !replaced && info.size === known.tail.offset) return [];
    const tail = known && !replaced ? known.tail : known ? START : firstTail(info.size, info.mtimeMs);
    const chunk = await readRange(path, tail.offset, info.size).catch(() => Buffer.alloc(0));
    const step = advance(tail, chunk);
    files.set(path, { tail: step.state, ino: info.ino });
    return step.lines;
  }

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      const paths = await logFiles(root);
      for (const path of paths ?? []) emit(await newLines(path));
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
