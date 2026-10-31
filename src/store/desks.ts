import { basename } from "node:path";
import type { NightEvent } from "../parser/index.js";
import type { Run, Session, Ticket } from "./board.js";
import type { RootOf } from "./root.js";
import { type Trouble, troubleFrom } from "./trouble.js";
import { KEEP_MS, QUIET_MS, type Workers } from "./workers.js";

/**
 * Desks: one per live agent on this computer (main sessions, background agents, pipeline agents), served read only at
 * `GET /agents` for Motherboard's Agents tab. `Desk` and `DesksView` are board-kit's `Agent` and `Agents` at commit
 * 0c60024 (`src/contract.ts`, copied to test/fixtures/); this file is the only place that knows the mapping.
 * The contract has no field for tokens or for why an agent waits. Tokens stay in the store (`DeskTokens`) until board-kit
 * adds one (see decisions.md); the reason goes out as the desk's newest step. `costUsd` is always null: no price table,
 * the owner is on a flat plan. `action` stays unset: desks are read only here.
 */
export type DeskState = "working" | "waits" | "done" | "idle";
export type Desk = {
  id: string;
  title: string;
  role?: string;
  ticket?: string;
  project?: string;
  model?: string;
  state?: DeskState;
  stage?: number;
  steps?: string[];
  stepCount?: number;
  costUsd?: number | null;
  minutes?: number;
  action?: "answer" | "approve";
  finishedAt?: string;
  idleMinutes?: number;
};
export type DesksView = { list?: Desk[]; doneToday?: number; stepsPerHour?: number };
export type DeskTokens = { total: number; input: number; output: number; cacheRead: number; cacheWrite: number };

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

type Parts = {
  id: string;
  role: string;
  title: string;
  /** A pipeline's ticket number. */
  ticket: string | null;
  folder: string;
  steps: number;
  recent: string[];
  startedAt: string | null;
  lastAt: string;
  /** Not finished (a session has no end marker; an agent's turn ended; a ticket got its result). */
  working: boolean;
  trouble: Trouble | null;
  mark: Mark | undefined;
};
type Seated = { desk: Desk; lastAt: string };

/** The board's words for why it stopped; the steps are the one place the contract has for them. */
const stopLine = (t: Trouble) => (t.resetsAt ? `${t.reason}, resets ${t.resetsAt}` : t.reason);

/** One desk, or null when it was quiet too long to count as live. */
function deskOf(p: Parts, nowMs: number): Seated | null {
  const at = Date.parse(p.lastAt);
  if (!p.folder || Number.isNaN(at) || nowMs - at > KEEP_MS) return null;
  const active = p.working && nowMs - at <= QUIET_MS;
  const state: DeskState = p.trouble || p.mark?.asking ? "waits" : active ? "working" : "idle";
  const start = p.startedAt ? Date.parse(p.startedAt) : Number.NaN;
  const desk: Desk = {
    id: p.id,
    title: p.title,
    role: p.role,
    ...(p.ticket && { ticket: p.ticket }),
    project: basename(p.folder) || p.folder,
    ...(p.mark?.model && { model: p.mark.model }),
    state,
    steps: (p.trouble ? [...p.recent, stopLine(p.trouble)] : p.recent).slice(-RECENT),
    stepCount: p.steps,
    costUsd: null,
    ...(!Number.isNaN(start) && { minutes: Math.round(Math.max(0, (active ? nowMs : at) - start) / 60_000) }),
    ...(state === "idle" && { idleMinutes: Math.floor((nowMs - at) / 60_000) }),
  };
  return { desk, lastAt: p.lastAt };
}

function ticketParts(t: Ticket & { agentId: string }, session: Session | undefined, src: Source): Parts {
  const mark = src.log.get(`agent:${t.agentId}`);
  const own = mark?.lastAt ?? "";
  const cwd = mark?.cwd ?? "";
  const working = t.station === "working" || t.station === "checking";
  return {
    id: `agent:${t.agentId}`,
    role: "pipeline agent",
    title: t.title,
    ticket: `#${t.number}`,
    // A quiet session log is followed from its end, so a run's session can be unknown while its agents work.
    folder: session?.home ?? src.rootOf(cwd)?.root ?? cwd,
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

type Source = {
  sessions: Map<string, Session>;
  runs: Map<string, Run>;
  workers: Workers;
  log: DeskLog;
  /** The repository of a folder, so a worktree shows as its repo (cached: no disk read per pull). */
  rootOf: RootOf;
  /** Agents a pipeline started: they are pipeline desks, never background ones. */
  isPipeline: (agentId: string) => boolean;
};

/** Every live desk: waiting for the owner first, then the active ones, then the newest; at most 50. */
export function desksOf(src: Source, nowMs: number): DesksView {
  const parts: Parts[] = [];
  for (const [id, s] of src.sessions) {
    const mark = src.log.get(`main:${id}`);
    parts.push({
      id: `main:${id}`,
      role: "main session",
      title: s.title ?? "Session",
      ticket: null,
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
      role: "background agent",
      // Never `w.task`: that is the start of the agent's prompt, and prompts stay off this endpoint.
      title: w.title ?? `agent ${w.agentId.slice(0, 6)}`,
      ticket: null,
      folder: src.rootOf(place.folder)?.root ?? place.folder,
      recent: w.recent,
      steps: w.steps,
      startedAt: w.startedAt,
      lastAt: w.lastAt,
      working: !w.ended,
      // Its session's trouble stops only the work in progress: an agent that finished is not held up by it.
      trouble: mark?.trouble ?? (w.ended ? null : (src.sessions.get(w.parent)?.trouble ?? null)),
      mark,
    });
  }
  for (const run of src.runs.values()) {
    const session = src.sessions.get(run.sessionId);
    for (const t of run.tickets.values())
      if (t.agentId) parts.push(ticketParts({ ...t, agentId: t.agentId }, session, src));
  }
  const seated = parts.map((p) => deskOf(p, nowMs)).filter((s) => s !== null);
  seated.sort(
    (a, b) =>
      Number(b.desk.state === "waits") - Number(a.desk.state === "waits") ||
      Number(b.desk.state === "working") - Number(a.desk.state === "working") ||
      b.lastAt.localeCompare(a.lastAt),
  );
  return { list: seated.slice(0, SHOWN).map((s) => s.desk) };
}
