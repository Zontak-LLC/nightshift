import { redact } from "./redact.js";

/**
 * A workflow's journal (`.../subagents/workflows/<run>/journal.jsonl`): one line per agent started or finished. This is
 * how the board knows a pipeline's tickets. The journal belongs to Claude Code; only this file knows its shape.
 */
export type Place = { runId: string; sessionId: string };
export type QueuedTicket = { number: number; title: string };

export type RunEvent =
  | (Place & { kind: "run.launched" })
  | (Place & { kind: "agent.started"; agentId: string; label: string; phase: string | null; number: number | null })
  | (Place & {
      kind: "agent.result";
      agentId: string;
      number: number | null;
      status: string | null;
      pr: string | null;
      summary: string | null;
    })
  | (Place & { kind: "run.queue"; tickets: QueuedTicket[] });

type Raw = Record<string, unknown>;
const MAX_LINE = 2_000_000;
const MAX_QUEUE = 300;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ticketNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1_000_000 ? v : null;

/** "#70 Native mobile app" -> 70. Labels without a leading number are helper steps ("rank open tickets"). */
export function numberInLabel(label: string): number | null {
  const m = /^#(\d{1,6})\b/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

/** "#70 Native mobile app" -> "Native mobile app". */
export function titleInLabel(label: string): string {
  return label.trim().replace(/^#\d+\s*/, "");
}

/** Only a GitHub pull request link, or "#123"; anything else is not shown. */
function prOf(v: unknown): string | null {
  const s = str(v).trim();
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(s)) return s;
  return /^#\d{1,6}$/.test(s) ? s : null;
}

/** A short status word chosen by the pipeline ("merged", "plan-posted", "skipped"). */
function statusOf(v: unknown): string | null {
  const s = str(v).trim().toLowerCase();
  return /^[a-z][a-z-]{0,39}$/.test(s) ? s : null;
}

/** The first sentence of a summary, without secrets, at most 240 characters. */
function summaryOf(v: unknown): string | null {
  const s = redact(str(v).replace(/\s+/g, " ").trim());
  if (!s) return null;
  const first = /^(.{20,240}?[.!?])(\s|$)/.exec(s)?.[1] ?? s.slice(0, 240);
  return first;
}

function queueOf(v: unknown): QueuedTicket[] | null {
  if (!Array.isArray(v)) return null;
  const out: QueuedTicket[] = [];
  for (const t of v.slice(0, MAX_QUEUE)) {
    if (!t || typeof t !== "object") continue;
    const number = ticketNumber((t as Raw).number);
    const title = redact(
      str((t as Raw).title)
        .replace(/\s+/g, " ")
        .trim(),
    ).slice(0, 200);
    if (number && title) out.push({ number, title });
  }
  return out;
}

function resultEvents(raw: Raw, place: Place): RunEvent[] {
  const agentId = str(raw.agentId);
  const r = raw.result && typeof raw.result === "object" ? (raw.result as Raw) : {};
  const out: RunEvent[] = [];
  const queue = queueOf(r.tickets);
  if (queue?.length) out.push({ kind: "run.queue", ...place, tickets: queue });
  if (agentId) {
    out.push({
      kind: "agent.result",
      ...place,
      agentId,
      number: ticketNumber(r.number),
      status: statusOf(r.status),
      pr: prOf(r.pr),
      summary: summaryOf(r.summary ?? r.notes),
    });
  }
  return out;
}

/** One journal line -> its events. Never throws; an unreadable or unknown line is counted as skipped. */
export function parseJournalLine(line: string, place: Place): { events: RunEvent[]; skipped: number } {
  if (!line.trim()) return { events: [], skipped: 0 };
  let raw: Raw;
  try {
    const v: unknown = line.length > MAX_LINE ? null : JSON.parse(line);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { events: [], skipped: 1 };
    raw = v as Raw;
  } catch {
    return { events: [], skipped: 1 };
  }
  const type = str(raw.type);
  if (type === "launched") return { events: [{ kind: "run.launched", ...place }], skipped: 0 };
  if (type === "result") return { events: resultEvents(raw, place), skipped: 0 };
  if (type !== "started" || !str(raw.agentId)) return { events: [], skipped: 1 };
  const label = redact(str(raw.label).replace(/\s+/g, " ").trim()).slice(0, 200);
  const phase = str(raw.phase).slice(0, 40) || null;
  const started: RunEvent = {
    kind: "agent.started",
    ...place,
    agentId: str(raw.agentId),
    label,
    phase,
    number: numberInLabel(label),
  };
  return { events: [started], skipped: 0 };
}
