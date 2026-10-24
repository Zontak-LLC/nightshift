import { basename } from "node:path";
import type { NightEvent } from "../parser/index.js";
import { type RootOf, repoRootOf } from "./root.js";

/**
 * Background agents (Claude Code "subagents"): each one has its own log next to the session that started it. They
 * are filed by where they really work, not by the folder their parent started in.
 */
export type AgentRow = {
  agentId: string;
  /** A short name: the description it was started with, else the first line of its task. */
  name: string;
  /** True when it works in a linked worktree of the project. */
  worktree: boolean;
  step: string | null;
  recent: string[];
  steps: number;
  startedAt: string | null;
  lastAt: string;
  active: boolean;
  parent: string;
};
type Vote = { n: number; worktree: boolean };
type Worker = {
  agentId: string;
  parent: string;
  cwd: string;
  title: string | null;
  task: string | null;
  step: string | null;
  recent: string[];
  steps: number;
  startedAt: string | null;
  lastAt: string;
  ended: boolean;
  votes: Map<string, Vote>;
};
export type Place = { project: string; folder: string; worktree: boolean };

/** An agent quiet for this long is no longer "working" (the log has no end marker when a run is cut off). */
export const QUIET_MS = 10 * 60_000;
/** Agents quieter than this are left off the board. */
const KEEP_MS = 6 * 3600_000;
const SHOWN = 20;
const RECENT = 4;
const NAME_LENGTH = 32;

const short = (s: string): string => (s.length > NAME_LENGTH ? `${s.slice(0, NAME_LENGTH - 1)}…` : s);

export class Workers {
  private all = new Map<string, Worker>();

  constructor(
    private readonly rootOf: RootOf = repoRootOf,
    /** The folder of a session, for an agent that names no repository. */
    private readonly cwdOf: (sessionId: string) => string | null = () => null,
  ) {}

  has(agentId: string): boolean {
    return this.all.has(agentId);
  }

  /** Applies one event of an agent that is not part of a pipeline; true when something changed. */
  apply(e: NightEvent, agentId: string): boolean {
    let w = this.all.get(agentId);
    if (!w) {
      w = {
        agentId,
        parent: e.sessionId,
        cwd: "",
        title: null,
        task: null,
        step: null,
        recent: [],
        steps: 0,
        startedAt: null,
        lastAt: "",
        ended: false,
        votes: new Map(),
      };
      this.all.set(agentId, w);
    }
    if (e.kind === "session.seen") {
      w.cwd = e.cwd;
      return true;
    }
    if (e.kind === "agent.title") {
      w.title = e.title;
      return true;
    }
    if (e.kind === "agent.task") {
      w.task ??= e.text;
      return true;
    }
    if (e.kind === "turn.end") {
      w.ended = true;
      return true;
    }
    if (e.kind !== "tool.use") return false;
    w.ended = false;
    w.step = e.summary;
    w.steps++;
    w.recent = [...w.recent, e.summary].slice(-RECENT);
    w.startedAt ??= e.at || null;
    if (e.at > w.lastAt) w.lastAt = e.at;
    for (const root of new Set((e.paths ?? []).map((p) => this.rootOf(p)).filter((r) => r !== null))) {
      const v = w.votes.get(root.root) ?? { n: 0, worktree: root.worktree };
      v.n++;
      v.worktree = root.worktree;
      w.votes.set(root.root, v);
    }
    return true;
  }

  /** Where an agent works: the repository most of its tool calls touch, else where its parent session is. */
  placeOf(w: Worker): Place | null {
    let best: [string, Vote] | null = null;
    for (const entry of w.votes) if (!best || entry[1].n > best[1].n) best = entry;
    if (best) return { project: basename(best[0]), folder: best[0], worktree: best[1].worktree };
    const cwd = this.cwdOf(w.parent) ?? w.cwd;
    return cwd ? { project: basename(cwd) || cwd, folder: cwd, worktree: false } : null;
  }

  /** The agents worth showing (they took a step recently), each with its place. */
  private live(nowMs: number, skip: (agentId: string) => boolean): { w: Worker; place: Place }[] {
    const out: { w: Worker; place: Place }[] = [];
    for (const w of this.all.values()) {
      const at = Date.parse(w.lastAt);
      if (!w.lastAt || Number.isNaN(at) || nowMs - at > KEEP_MS || skip(w.agentId)) continue;
      const place = this.placeOf(w);
      if (place) out.push({ w, place });
    }
    return out;
  }

  /** One project's agents, the active ones first, then the newest. */
  rows(project: string, nowMs: number, skip: (agentId: string) => boolean = () => false): AgentRow[] {
    return this.live(nowMs, skip)
      .filter(({ place }) => place.project === project)
      .map(({ w, place }) => {
        const active = !w.ended && nowMs - Date.parse(w.lastAt) <= QUIET_MS;
        const name = short(w.title ?? w.task ?? `agent ${w.agentId.slice(0, 6)}`);
        const row: AgentRow = {
          agentId: w.agentId,
          name,
          worktree: place.worktree,
          step: w.step,
          recent: w.recent,
          steps: w.steps,
          startedAt: w.startedAt,
          lastAt: w.lastAt,
          active,
          parent: w.parent,
        };
        return row;
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || b.lastAt.localeCompare(a.lastAt))
      .slice(0, SHOWN);
  }

  /** The projects agents work in, with how many are active and when the newest took a step. */
  projects(nowMs: number, skip: (agentId: string) => boolean = () => false) {
    const out = new Map<string, { folder: string; lastAt: string; agents: number }>();
    for (const { w, place } of this.live(nowMs, skip)) {
      const row = out.get(place.project) ?? { folder: place.folder, lastAt: "", agents: 0 };
      if (w.lastAt > row.lastAt) Object.assign(row, { lastAt: w.lastAt, folder: place.folder });
      if (!w.ended && nowMs - Date.parse(w.lastAt) <= QUIET_MS) row.agents++;
      out.set(place.project, row);
    }
    return out;
  }

  /** What the terminal needs to tag a step: the project the agent really works in, and its name. */
  label(agentId: string): { project: string; name: string } | null {
    const w = this.all.get(agentId);
    const place = w && this.placeOf(w);
    return w && place
      ? { project: place.project, name: short(w.title ?? w.task ?? `agent ${agentId.slice(0, 6)}`) }
      : null;
  }
}
