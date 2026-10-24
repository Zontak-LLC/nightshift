/**
 * The board's arithmetic: totals, the finish estimate, durations in words and the timeline's hour rows.
 * Each function is tested here AND sent to the browser as its own source text (`SHIFT` below, joined into the page
 * script), so the page runs exactly the tested code. That is why each one stands alone: no imports, no module values,
 * no calls to anything outside the list in `SHIFT`.
 */
export type ShiftTicket = {
  number: number;
  title: string;
  station: string;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};
export type ShiftColumns = Record<"queued" | "working" | "checking" | "done" | "skipped", ShiftTicket[]>;
export type Bar = { num: number; label: string; kind: string; left: number; width: number; first: boolean };
export type HourRow = { at: number; bars: Bar[]; nowAt: number | null };

/** "1h 05m", "7m 12s", or "–" when there is nothing to say. */
export function durationText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "–";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** The run's totals: what is finished, how long a ticket takes on average, the longest, what is left. */
export function shiftTotals(c: ShiftColumns) {
  const took = (t: ShiftTicket) =>
    t.startedAt && t.finishedAt ? Date.parse(t.finishedAt) - Date.parse(t.startedAt) : NaN;
  const timed = c.done
    .concat(c.skipped)
    .map((t) => ({ number: t.number, ms: took(t) }))
    .filter((x) => x.ms >= 0);
  let longest: { number: number; ms: number } | null = null;
  for (const x of timed) if (!longest || x.ms > longest.ms) longest = x;
  const left = c.queued.length + c.working.length + c.checking.length;
  return {
    done: c.done.length,
    skipped: c.skipped.length,
    merged: c.done.filter((t) => t.status === "merged" || t.status === "partial-merged").length,
    total: left + c.done.length + c.skipped.length,
    left,
    avgMs: timed.length ? timed.reduce((sum, x) => sum + x.ms, 0) / timed.length : null,
    longest,
  };
}

/** When the run should finish at the average pace, or null when there is no pace yet or nothing left. */
export function finishEstimate(avgMs: number | null, left: number, nowMs: number): number | null {
  return avgMs && left > 0 ? nowMs + avgMs * left : null;
}

/** Each started ticket as a span of time: done and skipped end where they finished, the rest run until now. */
export function segmentsOf(c: ShiftColumns, nowMs: number) {
  const kinds: Record<string, string> = { working: "live", checking: "live", done: "done", skipped: "skip" };
  const all = c.working.concat(c.checking, c.done, c.skipped);
  return all
    .filter((t) => t.startedAt && Number.isFinite(Date.parse(t.startedAt)))
    .map((t) => {
      const from = Date.parse(t.startedAt ?? "");
      const ended =
        (t.station === "done" || t.station === "skipped") && t.finishedAt ? Date.parse(t.finishedAt) : nowMs;
      return {
        num: t.number,
        label: `#${t.number}`,
        kind: kinds[t.station] ?? "skip",
        from,
        to: Math.max(from, ended),
      };
    })
    .sort((a, b) => a.from - b.from);
}

export type ShiftAgent = { name: string; active: boolean; startedAt: string | null; lastAt: string };

/** "3 agents working", "1 agent working", or "" when none is active. */
export function agentsWorking(agents: ShiftAgent[]): string {
  const n = agents.filter((a) => a.active).length;
  return n ? `${n} ${n === 1 ? "agent" : "agents"} working` : "";
}

/** Each background agent that took a step as a span of time (negative numbers: they are not tickets). */
export function agentSegments(agents: ShiftAgent[], nowMs: number) {
  return agents
    .filter((a) => a.startedAt && Number.isFinite(Date.parse(a.startedAt)))
    .map((a, i) => {
      const from = Date.parse(a.startedAt ?? "");
      return {
        num: -1 - i,
        label: a.name,
        kind: a.active ? "live" : "done",
        from,
        to: Math.max(from, a.active ? nowMs : Date.parse(a.lastAt) || from),
      };
    });
}

/**
 * The timeline: one row per clock hour from the start of the run to now (the newest 24 at most), each holding the
 * pieces of the segments that fall in it, as percentages of the hour. A label goes only where a segment starts.
 */
export function hourRows(
  startMs: number,
  nowMs: number,
  segs: { num: number; label: string; kind: string; from: number; to: number }[],
): HourRow[] {
  const HOUR = 3600e3;
  const end = Math.max(nowMs, ...segs.map((s) => s.to));
  const firstHour = Math.max(Math.floor(startMs / HOUR) * HOUR, Math.floor(end / HOUR) * HOUR - 23 * HOUR);
  const rows: HourRow[] = [];
  for (let at = firstHour; at < end || rows.length === 0; at += HOUR) {
    const bars: Bar[] = [];
    for (const s of segs) {
      if (s.to <= at || s.from >= at + HOUR) continue;
      const a = Math.max(s.from, at);
      bars.push({
        num: s.num,
        label: s.label,
        kind: s.kind,
        left: ((a - at) / HOUR) * 100,
        width: ((Math.min(s.to, at + HOUR) - a) / HOUR) * 100,
        first: s.from >= at,
      });
    }
    rows.push({ at, bars, nowAt: nowMs >= at && nowMs < at + HOUR ? ((nowMs - at) / HOUR) * 100 : null });
  }
  return rows;
}

/**
 * The functions above as page-script source (types already gone). A runner that keeps function names (tsx in
 * `npm run dev`) wraps named arrows in `__name(...)`; the one-line stand-in makes that harmless in the browser.
 */
export const SHIFT = [
  "var __name = function (f) { return f; };",
  ...[durationText, shiftTotals, finishEstimate, segmentsOf, agentsWorking, agentSegments, hourRows].map((f) =>
    f.toString(),
  ),
].join("\n");
