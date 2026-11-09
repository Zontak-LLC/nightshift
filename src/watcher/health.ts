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

export const WATCHDOG_EVERY_MS = 60_000;

/**
 * Looks at `check()` every `everyMs` and calls `onStale` once when it says stale. Lens froze twice (2026-11-01 and
 * 2026-11-07) with every file read stuck: Node's 4 file threads were all held by reads that never came back, so later
 * reads only waited in line. /health said "stale" for two days and nobody acted. Only a new process clears that,
 * so the CLI exits on `onStale` and the service (launchd KeepAlive) starts a fresh Lens.
 */
export function watchdog(check: () => Health, onStale: (health: Health) => void, everyMs = WATCHDOG_EVERY_MS) {
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    const health = check();
    if (health.ok) return;
    fired = true;
    onStale(health);
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
