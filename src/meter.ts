// The usage meter's source: a small JSON file that something else keeps up to date (how much of the 5-hour and the
// weekly allowance is used). Read only; the file may be missing, half written or old.
import { readFileSync } from "node:fs";

export type Meter = {
  /** Percent of the 5-hour allowance used, 0 to 100. */
  five_hour: number | null;
  /** Percent of the weekly allowance used, 0 to 100. */
  seven_day: number | null;
  /** When the 5-hour window resets, in Unix seconds. */
  five_hour_resets_at: number | null;
  /** When the file was written (ISO time), so the page can tell when it has gone stale. */
  updated: string | null;
};

const percent = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;

/** The meter in the file's text, or null when it is not JSON or holds no usable percentage. */
export function parseMeter(text: string): Meter | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const meter: Meter = {
    five_hour: percent(r.five_hour),
    seven_day: percent(r.seven_day),
    five_hour_resets_at:
      typeof r.five_hour_resets_at === "number" && Number.isFinite(r.five_hour_resets_at)
        ? r.five_hour_resets_at
        : null,
    updated: typeof r.updated === "string" && Number.isFinite(Date.parse(r.updated)) ? r.updated : null,
  };
  return meter.five_hour === null && meter.seven_day === null ? null : meter;
}

/** The meter in a file, or null when the file is missing or unusable. */
export function readMeter(path: string): Meter | null {
  try {
    return parseMeter(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Looks at the file now and every `everyMs`; `current()` is what it held last time. */
export function startMeter(path: string, everyMs = 30_000): { current: () => Meter | null; stop: () => void } {
  let meter = readMeter(path);
  const timer = setInterval(() => {
    meter = readMeter(path);
  }, everyMs);
  timer.unref();
  return { current: () => meter, stop: () => clearInterval(timer) };
}
