import type { Stats } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { type NightEvent, parseAgentMeta, parseJournalLine, parseLine, type RunEvent } from "../parser/index.js";
import { type LogFile, logFiles } from "./files.js";
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
  /** Whole lines were read (any lines, events or not): the watcher is alive and keeping up. */
  onLines?: (count: number) => void;
  /** A problem that did not stop the watcher (an unreadable folder or file, a failing `onEvent`, a stuck look). */
  onError?: (error: unknown) => void;
  /** At most this many bytes of one file per look: a huge log is caught up over several looks, never read whole. */
  chunkBytes?: number;
  /** A file whose read has not come back after this long is reported and passed over until it does. */
  stuckMs?: number;
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

/** The bytes from `from` to `to`; fewer when the file shrank meanwhile (never zero padding). */
async function readRange(path: string, from: number, to: number): Promise<Buffer> {
  if (to <= from) return Buffer.alloc(0);
  const handle = await open(path, "r"); // read only: Lens never writes to Claude Code's files
  try {
    const buf = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buf, 0, buf.length, from);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** True when `work` settles within `ms`; false when it is still pending then (it carries on in the background). */
async function finishedWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), ms);
  });
  try {
    return await Promise.race([work.then(() => true), late]);
  } finally {
    clearTimeout(timer);
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
    onLines,
    chunkBytes = 8_000_000,
    stuckMs = 120_000,
  } = opts;
  const files = new Map<string, Followed>();
  /** meta file -> the size last read (it is written once, then left alone). */
  const metas = new Map<string, number>();
  let first = true;
  let busy = false;
  let stopped = false;
  /** Files whose read has not come back after `stuckMs`: passed over until it does, so the others go on. */
  const hung = new Set<string>();
  /** File and folder problems are said once each: the same unreadable file must not fill the log every second. */
  const said = new Set<string>();
  function reportOnce(where: string, error: unknown): void {
    const message = `${where}: ${error instanceof Error ? error.message : String(error)}`;
    if (said.has(message)) return;
    said.add(message);
    onError?.(new Error(message));
  }

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
    const to = Math.min(info.size, tail.offset + chunkBytes);
    const chunk = await readRange(path, tail.offset, to).catch((error: unknown) => {
      reportOnce(path, error); // and try again on the next look
      return null;
    });
    // Keep the place chosen even when the read failed: a retry must not start the file over from its top.
    if (!chunk) {
      files.set(path, { tail, ino: info.ino, epoch });
      return null;
    }
    for (const message of said) if (message.startsWith(`${path}: `)) said.delete(message); // it reads again
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
    if (read.lines.length) safely(() => onLines?.(read.lines.length));
    emit(read, file.journal);
    const mark = read.mark;
    if (mark && !stopped) safely(() => onRead?.(read.path, mark));
  }

  /** One file at a time. A file that fails is reported and skipped; one whose read never comes back (a blocked
   * read, a pipe) is reported and passed over after `stuckMs`, so one file can never stop every other one. */
  async function look(file: LogFile): Promise<void> {
    if (hung.has(file.path)) return;
    const work = (file.meta ? readMeta({ ...file, meta: file.meta }) : follow(file)).catch((error: unknown) =>
      reportOnce(file.path, error),
    );
    if (await finishedWithin(work, stuckMs)) return;
    hung.add(file.path);
    reportOnce(file.path, new Error(`no answer after ${Math.round(stuckMs / 1000)} s; reading the other files`));
    void work.finally(() => hung.delete(file.path));
  }

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      const paths = logFiles(root, (error) => reportOnce(root, error));
      for (const file of paths ?? []) {
        if (stopped) return;
        await look(file);
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
