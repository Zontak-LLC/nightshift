import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NightEvent, RunEvent } from "../parser/index.js";

/**
 * The history: every event the watcher found, in one SQLite file, plus where each log file was read up to. The board
 * is built from events alone, so after a restart the stored events are applied again and the board is the same
 * (sessions, background agents, steps, pipelines and tickets all come from them). The ONLY place that writes to disk.
 *
 * Nothing lost: a file is read on from its saved offset. Nothing doubled: an event is stored under a key that names the
 * file, its identity (inode and epoch) and where its line ends, so reading a line again changes nothing.
 * ":memory:" gives a throwaway database (the tests use it).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id, ts);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  ino INTEGER NOT NULL,
  epoch INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
`;

export type StoredEvent = NightEvent | RunEvent;
export type FileState = { ino: number; epoch: number; offset: number };
export const DEFAULT_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

export class History {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
  }

  /** Stores one event; false when this exact line was stored before (the caller then must not apply it again). */
  add(event: StoredEvent, key: string, nowMs = Date.now()): boolean {
    const at = "at" in event ? Date.parse(event.at) : Number.NaN; // journal lines carry no time: use the time we saw them
    const ts = Number.isFinite(at) ? at : nowMs;
    const done = this.db
      .prepare("INSERT OR IGNORE INTO events (key, session_id, ts, kind, data) VALUES (?, ?, ?, ?, ?)")
      .run(key, event.sessionId, ts, event.kind, JSON.stringify(event));
    return Number(done.changes) === 1;
  }

  /** Every stored event, oldest stored first: the order they arrived in, which is the order the board needs. */
  replay(each: (event: StoredEvent) => void): number {
    let n = 0;
    for (const row of this.db.prepare("SELECT data FROM events ORDER BY id").iterate()) {
      try {
        each(JSON.parse(String(row.data)) as StoredEvent);
        n++;
      } catch {
        // a damaged row is skipped, never fatal
      }
    }
    return n;
  }

  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n);
  }

  file(path: string): FileState | null {
    const row = this.db.prepare("SELECT ino, epoch, offset FROM files WHERE path = ?").get(path) as
      | FileState
      | undefined;
    return row ? { ino: Number(row.ino), epoch: Number(row.epoch), offset: Number(row.offset) } : null;
  }

  saveFile(path: string, mark: FileState, nowMs = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO files (path, ino, epoch, offset, updated) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET ino = excluded.ino, epoch = excluded.epoch, offset = excluded.offset,
           updated = CASE WHEN excluded.ino = ino AND excluded.epoch = epoch AND excluded.offset = offset
                          THEN updated ELSE excluded.updated END`,
      )
      .run(path, mark.ino, mark.epoch, mark.offset, nowMs);
  }

  /**
   * Forgets sessions whose newest event is older than `keepDays` (a session goes whole, so a long one is never cut in
   * the middle) and the marks of files not read for that long. Returns how many events went.
   */
  prune(keepDays = DEFAULT_KEEP_DAYS, nowMs = Date.now()): number {
    const cutoff = nowMs - keepDays * DAY_MS;
    const gone = this.db
      .prepare(
        "DELETE FROM events WHERE session_id IN (SELECT session_id FROM events GROUP BY session_id HAVING MAX(ts) < ?)",
      )
      .run(cutoff);
    this.db.prepare("DELETE FROM files WHERE updated < ?").run(cutoff);
    return Number(gone.changes);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
