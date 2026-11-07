/**
 * Is Lens keeping up? Stale = no line read for `staleMs` while a log changed in that time: there was work and nobody
 * read it. A quiet computer (no log changed) is not stale, however long it has been. Pure, so it is easy to test.
 */
export const STALE_MS = 30 * 60_000;

export type Health = {
  ok: boolean;
  status: "ok" | "stale";
  /** When the last whole line was read (ISO), or null when none was read since the start. */
  lastLineAt: string | null;
  /** When any log last changed (ISO), or null when there is none. */
  lastChangeAt: string | null;
};

export type HealthInput = {
  /** When the watcher started: the "last read" before any line came. */
  startedMs: number;
  lastLineMs: number | null;
  newestChangeMs: number | null;
  nowMs: number;
  staleMs?: number;
};

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function healthOf({ startedMs, lastLineMs, newestChangeMs, nowMs, staleMs = STALE_MS }: HealthInput): Health {
  const quietSince = lastLineMs ?? startedMs;
  const stale = nowMs - quietSince > staleMs && newestChangeMs !== null && newestChangeMs > nowMs - staleMs;
  return { ok: !stale, status: stale ? "stale" : "ok", lastLineAt: iso(lastLineMs), lastChangeAt: iso(newestChangeMs) };
}
