import { basename } from "node:path";
import type { NightEvent } from "../parser/index.js";
import type { Run, Session, Ticket } from "./board.js";
import { type Trouble, troubleFrom } from "./trouble.js";
import { KEEP_MS, QUIET_MS, type Workers } from "./workers.js";

/**
 * Desks: one per live agent on this computer (main sessions, background agents, pipeline agents), served read only at
 * `GET /agents` for Motherboard's Agents tab. Meant to follow board-kit's `Agents` / `Agent` contract (`src/contract.ts`,
 * board-kit PR #21, merged 2026-10-27). NOT YET MATCHED: board-kit is not in this repo and no build sandbox could read
 * it (2026-10-29 to 2026-10-31), so the names below are unchecked and no board-kit commit is pinned. Match them and note
 * the commit here before merging (issue 15); this file is the only place that knows the mapping.
 * Tokens only: `cost` is always null, there is no price table (the owner is on a flat plan; see decisions.md).
 */
export type DeskRole = "main" | "background" | "pipeline";
export type DeskTokens = { total: number; input: number; output: number; cacheRead: number; cacheWrite: number };
export type DeskWait = { reason: Trouble["reason"] | "question"; resetsAt: string | null };
export type Desk = {
  id: string;
  role: DeskRole;
  /** A pipeline's ticket number and title; otherwise the session's or the agent's title (number null). */
  ticket: { number: number | null; title: string };
  /** The repository's folder name. */
  project: string;
  folder: string;
  model: string | null;
  step: string | null;
  /** The current step and the two before it, oldest first. */
  recent: string[];
  steps: number;
  /** Null when unknown (steps stored before tokens were read). */
  tokens: DeskTokens | null;
  cost: null;
  startedAt: string | null;
  lastAt: string;
  runMs: number;
  state: "active" | "idle";
  waitsForYou: boolean;
  wait: DeskWait | null;
};
export type DesksView = { generatedAt: string; agents: Desk[] };

type UsageEvent = Extract<NightEvent, { kind: "turn.usage" }>;
/** What the board keeps nowhere else, per main session (`main:<id>`) and per agent (`agent:<id>`). */
type Mark = {
  model: string | null;
  tokens: DeskTokens | null;
  /** What each message id counts for: a later line of it, or a log read again from the top, replaces its count. */
  counted: Map<string, DeskTokens>;
  /** The folder this agent's own lines name: where a pipeline agent works when its session's log was not read. */
  cwd: string;
  /** The `AskUserQuestion` call still waiting for its answer. */
  asking: string | null;
  /** A background agent's own trouble (pipeline tickets and main sessions keep theirs on the board). */
  trouble: Trouble | null;
  /** A main session's steps and its first event's time (the board keeps only its latest step per project). */
  steps: number;
  recent: string[];
  startedAt: string | null;
  /** This agent's own newest event (a pipeline run's `lastAt` is the newest of all its agents). */
  lastAt: string;
};

const SHOWN = 50;
const RECENT = 3;
const ZERO: DeskTokens = { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const keyOf = (e: { sessionId: string; agentId?: string }) =>
  e.agentId ? `agent:${e.agentId}` : `main:${e.sessionId}`;

function tokensOf(e: UsageEvent): DeskTokens {
  const t = {
    input: e.inputTokens,
    output: e.outputTokens,
    cacheRead: e.cacheReadTokens,
    cacheWrite: e.cacheWriteTokens,
  };
  return { ...t, total: t.input + t.output + t.cacheRead + t.cacheWrite };
}

function addUsage(m: Mark, e: UsageEvent): void {
  const now = tokensOf(e);
  const counted = m.counted.get(e.messageId) ?? ZERO;
  const sum = m.tokens ?? ZERO;
  m.tokens = {
    total: sum.total - counted.total + now.total,
    input: sum.input - counted.input + now.input,
    output: sum.output - counted.output + now.output,
    cacheRead: sum.cacheRead - counted.cacheRead + now.cacheRead,
    cacheWrite: sum.cacheWrite - counted.cacheWrite + now.cacheWrite,
  };
  m.counted.set(e.messageId, now);
  m.model = e.model;
}

/** Tokens, model, open questions and a main session's steps, from the events (the board's other state stays in Board). */
export class DeskLog {
  private marks = new Map<string, Mark>();

  get(key: string): Mark | undefined {
    return this.marks.get(key);
  }

  note(e: NightEvent): void {
    const key = keyOf(e);
    const m = this.marks.get(key) ?? {
      model: null,
      tokens: null,
      counted: new Map(),
      cwd: "",
      asking: null,
      trouble: null,
      steps: 0,
      recent: [],
      startedAt: null,
      lastAt: "",
    };
    this.marks.set(key, m);
    if (e.at) {
      m.startedAt ??= e.at;
      if (e.at > m.lastAt) m.lastAt = e.at;
    }
    if (e.kind === "turn.usage") addUsage(m, e);
    else if (e.kind === "session.seen") m.cwd = e.cwd;
    else if (e.kind === "session.trouble") m.trouble = troubleFrom(e);
    else if (e.kind === "tool.result" && e.toolUseId === m.asking) m.asking = null;
    else if (e.kind === "reply" || e.kind === "prompt") m.trouble = null;
    else if (e.kind === "tool.use") {
      m.asking = e.tool === "AskUserQuestion" ? e.toolUseId : null;
      m.trouble = null;
      m.steps++;
      m.recent = [...m.recent, e.summary].slice(-RECENT);
    }
  }
}

type Parts = Pick<Desk, "id" | "role" | "ticket" | "folder" | "steps" | "startedAt" | "lastAt"> & {
  recent: string[];
  /** Not finished (a session has no end marker; an agent's turn ended; a ticket got its result). */
  working: boolean;
  trouble: Trouble | null;
  mark: Mark | undefined;
};

/** One desk, or null when it was quiet too long to count as live. */
function deskOf(p: Parts, nowMs: number): Desk | null {
  const at = Date.parse(p.lastAt);
  if (!p.folder || Number.isNaN(at) || nowMs - at > KEEP_MS) return null;
  const active = p.working && nowMs - at <= QUIET_MS;
  const wait: DeskWait | null = p.trouble
    ? { reason: p.trouble.reason, resetsAt: p.trouble.resetsAt }
    : p.mark?.asking
      ? { reason: "question", resetsAt: null }
      : null;
  const start = p.startedAt ? Date.parse(p.startedAt) : Number.NaN;
  const recent = p.recent.slice(-RECENT);
  return {
    id: p.id,
    role: p.role,
    ticket: p.ticket,
    project: basename(p.folder) || p.folder,
    folder: p.folder,
    model: p.mark?.model ?? null,
    step: recent.at(-1) ?? null,
    recent,
    steps: p.steps,
    tokens: p.mark?.tokens ?? null,
    cost: null,
    startedAt: p.startedAt,
    lastAt: p.lastAt,
    runMs: Number.isNaN(start) ? 0 : Math.max(0, (active ? nowMs : at) - start),
    state: active ? "active" : "idle",
    waitsForYou: wait !== null,
    wait,
  };
}

function ticketParts(t: Ticket & { agentId: string }, session: Session | undefined, log: DeskLog): Parts {
  const mark = log.get(`agent:${t.agentId}`);
  const own = mark?.lastAt ?? "";
  const working = t.station === "working" || t.station === "checking";
  return {
    id: `agent:${t.agentId}`,
    role: "pipeline",
    ticket: { number: t.number, title: t.title },
    // A quiet session log is followed from its end, so a run's session can be unknown while its agents work.
    folder: session?.home ?? mark?.cwd ?? "",
    recent: t.recent,
    steps: t.steps,
    startedAt: t.startedAt ?? mark?.startedAt ?? null,
    // Its own newest line, never the run's: another ticket's steps must not keep a stalled agent active.
    lastAt: t.finishedAt && t.finishedAt > own ? t.finishedAt : own,
    working,
    trouble: working ? (t.trouble ?? session?.trouble ?? null) : t.trouble,
    mark,
  };
}

/** A path as the board shows it: the home folder as `~`. */
export function tilde(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

type Source = {
  sessions: Map<string, Session>;
  runs: Map<string, Run>;
  workers: Workers;
  log: DeskLog;
  /** Agents a pipeline started: they are pipeline desks, never background ones. */
  isPipeline: (agentId: string) => boolean;
  /** The home folder, shown as `~` ("" leaves paths as they are). */
  home: string;
};

/** Every live desk: waiting for the owner first, then the active ones, then the newest; at most 50. */
export function desksOf(src: Source, nowMs: number): DesksView {
  const parts: Parts[] = [];
  for (const [id, s] of src.sessions) {
    const mark = src.log.get(`main:${id}`);
    parts.push({
      id: `main:${id}`,
      role: "main",
      ticket: { number: null, title: s.title ?? "Session" },
      folder: s.home,
      recent: mark?.recent ?? [],
      steps: mark?.steps ?? 0,
      startedAt: mark?.startedAt ?? null,
      lastAt: s.lastAt,
      working: true, // a main session has no end marker: quiet for 10 minutes = idle
      trouble: s.trouble,
      mark,
    });
  }
  for (const { w, place } of src.workers.live(nowMs, src.isPipeline)) {
    const mark = src.log.get(`agent:${w.agentId}`);
    parts.push({
      id: `agent:${w.agentId}`,
      role: "background",
      ticket: { number: null, title: w.title ?? w.task ?? `agent ${w.agentId.slice(0, 6)}` },
      folder: place.folder,
      recent: w.recent,
      steps: w.steps,
      startedAt: w.startedAt,
      lastAt: w.lastAt,
      working: !w.ended,
      trouble: mark?.trouble ?? src.sessions.get(w.parent)?.trouble ?? null,
      mark,
    });
  }
  for (const run of src.runs.values()) {
    const session = src.sessions.get(run.sessionId);
    for (const t of run.tickets.values())
      if (t.agentId) parts.push(ticketParts({ ...t, agentId: t.agentId }, session, src.log));
  }
  const desks = parts
    .map((p) => deskOf(p, nowMs))
    .filter((d) => d !== null)
    .map((d) => ({ ...d, folder: tilde(d.folder, src.home) }));
  desks.sort(
    (a, b) =>
      Number(b.waitsForYou) - Number(a.waitsForYou) ||
      Number(b.state === "active") - Number(a.state === "active") ||
      b.lastAt.localeCompare(a.lastAt),
  );
  return { generatedAt: new Date(nowMs).toISOString(), agents: desks.slice(0, SHOWN) };
}
