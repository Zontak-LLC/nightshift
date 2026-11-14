import type { Helper, Run, Session, Ticket } from "./board.js";
import type { DeskLog, Mark } from "./desks.js";
import type { RootOf } from "./root.js";
import type { Trouble } from "./trouble.js";
import type { Workers } from "./workers.js";

/** What a desk is made of, before `deskOf` decides whether it is live and what state it is in. */
export type Parts = {
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

export type Source = {
  sessions: Map<string, Session>;
  runs: Map<string, Run>;
  workers: Workers;
  log: DeskLog;
  /** The home folder, shown as `~` in what goes out. */
  home: string;
  /** The repository of a folder, so a worktree shows as its repo (cached: no disk read per pull). */
  rootOf: RootOf;
  /** Agents a pipeline started: they are pipeline desks, never background ones. */
  isPipeline: (agentId: string) => boolean;
};

/** Where a pipeline agent works. A quiet session log is followed from its end, so its session can be unknown. */
function pipelineFolder(session: Session | undefined, mark: Mark | undefined, src: Source): string {
  const cwd = mark?.cwd ?? "";
  return session?.home ?? src.rootOf(cwd)?.root ?? cwd;
}

function ticketParts(t: Ticket & { agentId: string }, session: Session | undefined, src: Source): Parts {
  const mark = src.log.get(`agent:${t.agentId}`);
  const own = mark?.lastAt ?? "";
  const working = t.station === "working" || t.station === "checking";
  return {
    id: `agent:${t.agentId}`,
    role: "pipeline agent",
    title: t.title,
    ticket: `#${t.number}`,
    folder: pipelineFolder(session, mark, src),
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

/** A pipeline agent with no ticket (a label with no number): the board keeps only its latest step, so its mark counts. */
function helperParts(agentId: string, h: Helper, session: Session | undefined, src: Source): Parts {
  const mark = src.log.get(`agent:${agentId}`);
  return {
    id: `agent:${agentId}`,
    role: "pipeline agent",
    title: h.label,
    ticket: null,
    folder: pipelineFolder(session, mark, src),
    recent: mark?.recent ?? [],
    steps: mark?.steps ?? 0,
    startedAt: mark?.startedAt ?? null,
    lastAt: mark?.lastAt ?? "",
    working: h.active,
    trouble: h.active ? (mark?.trouble ?? session?.trouble ?? null) : null,
    mark,
  };
}

/** The parts of every agent the board knows: main sessions, background agents, then pipeline agents. */
export function partsOf(src: Source, nowMs: number): Parts[] {
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
    for (const [agentId, h] of run.helpers) parts.push(helperParts(agentId, h, session, src));
  }
  return parts;
}
