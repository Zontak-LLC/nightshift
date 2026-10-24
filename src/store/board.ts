import { basename } from "node:path";
import { type NightEvent, type RunEvent, titleInLabel } from "../parser/index.js";

/**
 * The board's live state, built from events alone (no clock, no disk): a session's place and current step, and each
 * workflow run's tickets moving through the stations. `view(project)` is what one project's board page draws.
 */
export type Station = "queued" | "working" | "checking" | "done" | "skipped";
export type Ticket = {
  number: number;
  title: string;
  station: Station;
  step: string | null;
  steps: number;
  recent: string[];
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
  pr: string | null;
  summary: string | null;
  queueIndex: number;
  /** The agent working on it now: a late result from an earlier agent (a restarted ticket) is ignored. */
  agentId: string | null;
};
type Session = { cwd: string; branch: string | null; title: string | null; step: string | null; lastAt: string };
type Helper = { label: string; step: string | null; lastAt: string; active: boolean };
type Run = {
  runId: string;
  sessionId: string;
  tickets: Map<number, Ticket>;
  helpers: Map<string, Helper>;
  startedAt: string | null;
  lastAt: string;
  /** The order of its latest activity of any kind (journal lines carry no time), so the newest run is shown. */
  seen: number;
};
export type NowRow = { who: string; what: string; at: string };
export type BoardView = {
  project: string;
  folder: string | null;
  branch: string | null;
  now: NowRow[];
  run: { runId: string; startedAt: string | null; lastAt: string; columns: Record<Station, Ticket[]> } | null;
};
export type ProjectRow = { project: string; folder: string; lastAt: string; running: number };

/** Steps that mean "checking the work" rather than writing it. */
const CHECKING = /\b(npm run ci|npm test|vitest|playwright|e2e|gh pr checks|gh run watch|biome check|tsc)\b/i;
const SKIPPED = /^(skip|skipped|blocked|needs-owner|wont-fix)/;
const RECENT = 4;
const later = (a: string, b: string) => (a > b ? a : b);

export class Board {
  private sessions = new Map<string, Session>();
  private runs = new Map<string, Run>();
  /** agentId -> where its steps belong. */
  private agents = new Map<string, { runId: string; number: number | null }>();
  private clock = 0;

  /** Applies one event; returns true when something on a board changed. */
  apply(event: NightEvent | RunEvent): boolean {
    return "runId" in event ? this.applyRun(event) : this.applySession(event);
  }

  private applySession(e: NightEvent): boolean {
    if (e.agentId) return this.applyAgentStep(e, e.agentId);
    const s = this.sessions.get(e.sessionId);
    if (e.kind === "session.seen") {
      this.sessions.set(e.sessionId, {
        cwd: e.cwd,
        branch: e.branch,
        title: s?.title ?? null,
        step: s?.step ?? null,
        lastAt: later(s?.lastAt ?? "", e.at),
      });
      return true;
    }
    if (!s) return false;
    s.lastAt = later(s.lastAt, e.at);
    if (e.kind === "tool.use") s.step = e.summary;
    else if (e.kind === "session.title") s.title = e.title;
    else return false;
    return true;
  }

  private applyAgentStep(e: NightEvent, agentId: string): boolean {
    const where = this.agents.get(agentId);
    const run = where && this.runs.get(where.runId);
    if (!where || !run || e.kind !== "tool.use") return false;
    run.lastAt = later(run.lastAt, e.at);
    run.seen = ++this.clock;
    run.startedAt ??= e.at || null;
    if (where.number === null) {
      const h = run.helpers.get(agentId);
      if (h) Object.assign(h, { step: e.summary, lastAt: later(h.lastAt, e.at) });
      return Boolean(h);
    }
    const t = run.tickets.get(where.number);
    if (!t || t.station === "done" || t.station === "skipped") return false;
    t.step = e.summary;
    t.steps++;
    t.recent = [...t.recent, e.summary].slice(-RECENT);
    t.startedAt ??= e.at || null;
    t.finishedAt = e.at || t.finishedAt; // the last step's time: when a result arrives, that is when it finished
    t.station = CHECKING.test(e.summary) ? "checking" : "working";
    return true;
  }

  private runFor(e: RunEvent): Run {
    let run = this.runs.get(e.runId);
    if (!run) {
      run = {
        runId: e.runId,
        sessionId: e.sessionId,
        tickets: new Map(),
        helpers: new Map(),
        startedAt: null,
        lastAt: "",
        seen: 0,
      };
      this.runs.set(e.runId, run);
    }
    return run;
  }

  private applyRun(e: RunEvent): boolean {
    const run = this.runFor(e);
    run.seen = ++this.clock;
    if (e.kind === "run.launched") return true;
    if (e.kind === "run.queue") {
      e.tickets.forEach(({ number, title }, i) => {
        const t = run.tickets.get(number);
        if (t) Object.assign(t, { title, queueIndex: i });
        else run.tickets.set(number, newTicket(number, title, i));
      });
      return true;
    }
    if (e.kind === "agent.started") {
      this.agents.set(e.agentId, { runId: e.runId, number: e.number });
      if (e.number === null) {
        run.helpers.set(e.agentId, { label: e.label, step: null, lastAt: run.lastAt, active: true });
        return true;
      }
      const t = run.tickets.get(e.number) ?? newTicket(e.number, titleInLabel(e.label), run.tickets.size);
      // A ticket started again (a resumed run) goes back to work and loses its old result.
      Object.assign(t, { station: "working", status: null, pr: null, summary: null, step: null, agentId: e.agentId });
      run.tickets.set(e.number, t);
      return true;
    }
    const helper = run.helpers.get(e.agentId);
    if (helper) helper.active = false;
    const number = this.agents.get(e.agentId)?.number ?? e.number;
    const t = number === null ? undefined : run.tickets.get(number);
    if (!t || (t.agentId && t.agentId !== e.agentId)) return Boolean(helper);
    Object.assign(t, { status: e.status, pr: e.pr, summary: e.summary, step: null });
    t.station = e.status && SKIPPED.test(e.status) ? "skipped" : "done";
    return true;
  }

  /** The projects with a session, most recently active first. */
  projects(): ProjectRow[] {
    const rows = new Map<string, ProjectRow>();
    for (const [id, s] of this.sessions) {
      const project = basename(s.cwd) || s.cwd;
      const row = rows.get(project) ?? { project, folder: s.cwd, lastAt: "", running: 0 };
      row.lastAt = later(row.lastAt, s.lastAt);
      for (const run of this.runs.values()) {
        if (run.sessionId !== id) continue;
        row.lastAt = later(row.lastAt, run.lastAt);
        row.running += [...run.tickets.values()].filter(
          (t) => t.station === "working" || t.station === "checking",
        ).length;
      }
      rows.set(project, row);
    }
    return [...rows.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  /** One project's board: its newest session's place, what is happening now, and its newest pipeline run. */
  view(project: string): BoardView {
    const mine = [...this.sessions].filter(([, s]) => (basename(s.cwd) || s.cwd) === project);
    mine.sort(([, a], [, b]) => b.lastAt.localeCompare(a.lastAt));
    const newest = mine[0]?.[1];
    const ids = new Set(mine.map(([id]) => id));
    const runs = [...this.runs.values()].filter((r) => ids.has(r.sessionId)).sort((a, b) => b.seen - a.seen);
    const run = runs[0] ?? null;
    const now = nowRows(
      mine.map(([, s]) => s),
      run,
    );
    return {
      project,
      folder: newest?.cwd ?? null,
      branch: newest?.branch ?? null,
      now: now.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
      run: run && { runId: run.runId, startedAt: run.startedAt, lastAt: run.lastAt, columns: columnsOf(run) },
    };
  }
}

/** What is happening now: the sessions' own steps, the pipeline's helper steps and its tickets in progress. */
function nowRows(sessions: Session[], run: Run | null): NowRow[] {
  const now: NowRow[] = [];
  for (const s of sessions) if (s.step) now.push({ who: s.title ?? "Session", what: s.step, at: s.lastAt });
  for (const h of run?.helpers.values() ?? []) {
    if (h.active) now.push({ who: h.label, what: h.step ?? "Starting", at: h.lastAt });
  }
  for (const t of run?.tickets.values() ?? []) {
    if (t.station === "working" || t.station === "checking") {
      now.push({ who: `#${t.number}`, what: t.step ?? "Starting", at: t.finishedAt ?? "" });
    }
  }
  return now;
}

function newTicket(number: number, title: string, queueIndex: number): Ticket {
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
  };
}

function columnsOf(run: Run): Record<Station, Ticket[]> {
  const cols: Record<Station, Ticket[]> = { queued: [], working: [], checking: [], done: [], skipped: [] };
  for (const t of run.tickets.values()) cols[t.station].push(t);
  cols.queued.sort((a, b) => a.queueIndex - b.queueIndex);
  cols.working.sort((a, b) => b.steps - a.steps);
  cols.checking.sort((a, b) => b.steps - a.steps);
  cols.done.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  cols.skipped.sort((a, b) => a.queueIndex - b.queueIndex);
  return cols;
}
