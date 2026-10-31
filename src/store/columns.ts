import type { Run, Station, Ticket } from "./board.js";

export function newRun(runId: string, sessionId: string): Run {
  return { runId, sessionId, tickets: new Map(), helpers: new Map(), startedAt: null, lastAt: "", seen: 0 };
}

export function widenTimes(t: Ticket, at: string): boolean {
  if (!at) return false;
  const start = t.startedAt && t.startedAt < at ? t.startedAt : at;
  const end = t.finishedAt && t.finishedAt > at ? t.finishedAt : at;
  if (start === t.startedAt && end === t.finishedAt) return false;
  Object.assign(t, { startedAt: start, finishedAt: end });
  return true;
}

export function newTicket(number: number, title: string, queueIndex: number): Ticket {
  return {
    number,
    title,
    station: "queued",
    step: null,
    steps: 0,
    recent: [],
    startedAt: null,
    finishedAt: null,
    status: null,
    pr: null,
    summary: null,
    queueIndex,
    agentId: null,
    trouble: null,
  };
}

export function columnsOf(run: { tickets: Map<number, Ticket> }): Record<Station, Ticket[]> {
  const cols: Record<Station, Ticket[]> = { queued: [], working: [], checking: [], done: [], skipped: [] };
  for (const t of run.tickets.values()) cols[t.station].push(t);
  cols.queued.sort((a, b) => a.queueIndex - b.queueIndex);
  cols.working.sort((a, b) => b.steps - a.steps);
  cols.checking.sort((a, b) => b.steps - a.steps);
  cols.done.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  cols.skipped.sort((a, b) => a.queueIndex - b.queueIndex);
  return cols;
}
