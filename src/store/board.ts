import { basename } from "node:path";
import { type NightEvent, type RunEvent, titleInLabel } from "../parser/index.js";
import { columnsOf, newRun, newTicket, widenTimes } from "./columns.js";
import { DeskLog, type DesksView, desksOf } from "./desks.js";
import { type NowRow, nowRows, placeStep, type Spot } from "./places.js";
import { type RootOf, repoRootOf } from "./root.js";
import { type Alert, alertsOf, pauseTicket, type Trouble, troubleFrom } from "./trouble.js";
import { type AgentRow, Workers } from "./workers.js";

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
  trouble: Trouble | null;
};
export type Session = {
  cwd: string;
  /** The repository the session started in (a subfolder or worktree counts as its main repository), else the cwd. */
  home: string;
  branch: string | null;
  title: string | null;
  lastAt: string;
  trouble: Trouble | null;
  /** Where the session's steps went, by project (its own folder, and any other repository it worked in). */
  places: Map<string, Spot>;
};
type Helper = { label: string; step: string | null; lastAt: string; active: boolean };
export type Run = {
  runId: string;
  sessionId: string;
  tickets: Map<number, Ticket>;
  helpers: Map<string, Helper>;
  startedAt: string | null;
  lastAt: string;
  /** The order of its latest activity of any kind (journal lines carry no time), so the newest run is shown. */
  seen: number;
};

export type { NowRow } from "./places.js";
export type BoardView = {
  project: string;
  folder: string | null;
  branch: string | null;
  now: NowRow[];
  /** Background agents working in this project (wherever their parent session started). */
  agents: AgentRow[];
  alerts: Alert[];
  run: { runId: string; startedAt: string | null; lastAt: string; columns: Record<Station, Ticket[]> } | null;
};
export type ProjectRow = {
  project: string;
  folder: string;
  lastAt: string;
  running: number;
  agents: number;
  /** Tickets of the newest pipeline run that are not finished (queued, working or checking). */
  open: number;
};
const ownProject = (s: Session) => basename(s.home) || s.home;

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
  private workers: Workers;
  private log = new DeskLog();

  constructor(private readonly rootOf: RootOf = repoRootOf) {
    this.workers = new Workers(rootOf, (id) => this.sessions.get(id)?.cwd ?? null);
  }

  /** The project and name to tag a background agent's step with, or null for the main thread or a pipeline agent. */
  agentLabel(agentId: string): { project: string; name: string } | null {
    return this.agents.has(agentId) ? null : this.workers.label(agentId);
  }

  /** Applies one event; returns true when something on a board changed. */
  apply(event: NightEvent | RunEvent): boolean {
    if ("runId" in event) return this.applyRun(event);
    this.log.note(event);
    return event.kind !== "turn.usage" && this.applySession(event); // tokens alone never redraw a board page
  }

  private applySession(e: NightEvent): boolean {
    if (e.agentId)
      return this.agents.has(e.agentId) ? this.applyAgentStep(e, e.agentId) : this.workers.apply(e, e.agentId);
    const s = this.sessions.get(e.sessionId);
    if (e.kind === "session.seen") {
      this.sessions.set(e.sessionId, {
        cwd: e.cwd,
        home: this.rootOf(e.cwd)?.root ?? e.cwd,
        branch: e.branch,
        title: s?.title ?? null,
        lastAt: later(s?.lastAt ?? "", e.at),
        trouble: s?.trouble ?? null,
        places: s?.places ?? new Map(),
      });
      return true;
    }
    if (!s) return false;
    s.lastAt = later(s.lastAt, e.at);
    if (e.kind === "tool.use") {
      placeStep(s.places, s.home, e.paths ?? [], this.rootOf, e.summary, e.at);
      s.trouble = null; // real work again: the trouble is over
    } else if (e.kind === "reply" || e.kind === "prompt") {
      if (!s.trouble) return false;
      s.trouble = null; // the conversation goes on (a text-only answer counts): the trouble is over
    } else if (e.kind === "session.title") s.title = e.title;
    else if (e.kind === "session.trouble") s.trouble = troubleFrom(e);
    else return false;
    return true;
  }

  private applyAgentStep(e: NightEvent, agentId: string): boolean {
    const where = this.agents.get(agentId);
    const run = where && this.runs.get(where.runId);
    if (!where || !run) return false;
    if (e.kind === "session.trouble") return where.number !== null && pauseTicket(run.tickets.get(where.number), e);
    if (e.kind !== "tool.use") return false;
    run.lastAt = later(run.lastAt, e.at);
    run.seen = ++this.clock;
    run.startedAt ??= e.at || null;
    if (where.number === null) {
      const h = run.helpers.get(agentId);
      if (h) Object.assign(h, { step: e.summary, lastAt: later(h.lastAt, e.at) });
      return Boolean(h);
    }
    const t = run.tickets.get(where.number);
    if (!t) return false;
    // A finished ticket whose steps are read after its result (Night Shift started mid-run): keep only their times.
    if (t.station === "done" || t.station === "skipped") return widenTimes(t, e.at);
    t.step = e.summary;
    t.trouble = null; // real work again: the trouble is over
    t.steps++;
    t.recent = [...t.recent, e.summary].slice(-RECENT);
    t.startedAt ??= e.at || null;
    t.finishedAt = e.at || t.finishedAt; // the last step's time: when a result arrives, that is when it finished
    t.station = CHECKING.test(e.summary) ? "checking" : "working";
    return true;
  }

  private runFor(e: RunEvent): Run {
    const run = this.runs.get(e.runId) ?? newRun(e.runId, e.sessionId);
    this.runs.set(e.runId, run);
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
      Object.assign(t, {
        station: "working",
        status: null,
        pr: null,
        summary: null,
        step: null,
        agentId: e.agentId,
        trouble: null,
      });
      run.tickets.set(e.number, t);
      return true;
    }
    const helper = run.helpers.get(e.agentId);
    if (helper) helper.active = false;
    const number = this.agents.get(e.agentId)?.number ?? e.number;
    const t = number === null ? undefined : run.tickets.get(number);
    if (!t || (t.agentId && t.agentId !== e.agentId)) return Boolean(helper);
    Object.assign(t, { status: e.status, pr: e.pr, summary: e.summary, step: null, trouble: null });
    t.station = e.status && SKIPPED.test(e.status) ? "skipped" : "done";
    return true;
  }

  /** The newest pipeline run of the sessions that started in a project. */
  private runOf(ids: Set<string>): Run | null {
    return [...this.runs.values()].filter((r) => ids.has(r.sessionId)).sort((a, b) => b.seen - a.seen)[0] ?? null;
  }

  /** The projects with a session or a step in them (any session may work in several), newest first. */
  projects(nowMs = Date.now()): ProjectRow[] {
    const rows = new Map<string, ProjectRow>();
    const row = (project: string, folder: string) => {
      const r = rows.get(project) ?? { project, folder, lastAt: "", running: 0, agents: 0, open: 0 };
      rows.set(project, r);
      return r;
    };
    for (const [id, s] of this.sessions) {
      const own = row(ownProject(s), s.home);
      own.lastAt = later(own.lastAt, s.lastAt);
      for (const run of this.runs.values()) {
        if (run.sessionId !== id) continue;
        own.lastAt = later(own.lastAt, run.lastAt);
        own.running += [...run.tickets.values()].filter(
          (t) => t.station === "working" || t.station === "checking",
        ).length;
      }
      for (const [project, spot] of s.places) {
        const r = row(project, spot.folder);
        r.lastAt = later(r.lastAt, spot.lastAt);
      }
    }
    for (const [project, w] of this.workers.projects(nowMs, (id) => this.agents.has(id))) {
      const r = row(project, w.folder);
      r.lastAt = later(r.lastAt, w.lastAt);
      r.agents = w.agents;
    }
    for (const r of rows.values()) {
      const ids = new Set([...this.sessions].filter(([, s]) => ownProject(s) === r.project).map(([id]) => id));
      const run = this.runOf(ids);
      r.open = [...(run?.tickets.values() ?? [])].filter((t) => !["done", "skipped"].includes(t.station)).length;
    }
    return [...rows.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  /** One desk per live agent on this computer, for Motherboard's Agents tab (`GET /agents`, see desks.ts). */
  desks(nowMs = Date.now(), home = ""): DesksView {
    const { sessions, runs, workers, log } = this;
    return desksOf({ sessions, runs, workers, log, home, isPipeline: (id) => this.agents.has(id) }, nowMs);
  }

  /** One project's board: its newest session's place, what is happening now, and its newest pipeline run. */
  view(project: string, nowMs = Date.now()): BoardView {
    // A session shows on its own project's board and on every other repository it worked in (its steps split).
    const mine = [...this.sessions].filter(([, s]) => ownProject(s) === project || s.places.has(project));
    mine.sort(([, a], [, b]) => b.lastAt.localeCompare(a.lastAt));
    const own = mine.filter(([, s]) => ownProject(s) === project);
    const newest = own[0]?.[1];
    const agents = this.workers.rows(project, nowMs, (id) => this.agents.has(id));
    const run = this.runOf(new Set(own.map(([id]) => id))); // pipelines stay with the project they started in
    const alerts = alertsOf(
      mine.map(([, s]) => s),
      run?.tickets.values() ?? [],
    );
    const now = nowRows(
      mine.map(([, s]) => s),
      run,
      project,
    );
    return {
      project,
      folder:
        newest?.cwd ??
        mine[0]?.[1].places.get(project)?.folder ??
        this.workers.projects(nowMs).get(project)?.folder ??
        null,
      branch: newest?.branch ?? null,
      now: now.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
      agents,
      alerts,
      run: run && { runId: run.runId, startedAt: run.startedAt, lastAt: run.lastAt, columns: columnsOf(run) },
    };
  }
}
