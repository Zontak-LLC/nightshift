import { basename } from "node:path";
import type { RootOf } from "./root.js";

/** Where a main session's steps went in ONE project: its latest step there,. */
export type Spot = { folder: string; step: string | null; lastAt: string };

/**
 * Files one tool call of a main session by where it works (the same rule as a background agent: the repositories its
 * paths belong to, a worktree counting as its main repository). A step that names no repository stays with the
 * session's own folder. A step that touches two repositories counts in both.
 */
export function placeStep(
  places: Map<string, Spot>,
  ownFolder: string,
  paths: readonly string[],
  rootOf: RootOf,
  step: string,
  at: string,
): void {
  const folders = new Set<string>();
  for (const p of paths) {
    const root = rootOf(p);
    if (root) folders.add(root.root);
  }
  if (!folders.size) folders.add(ownFolder);
  for (const folder of folders) {
    const project = basename(folder) || folder;
    const spot = places.get(project) ?? { folder, step: null, lastAt: "" };
    spot.step = step;
    if (at > spot.lastAt) spot.lastAt = at;
    places.set(project, spot);
  }
}

export type NowRow = { who: string; what: string; at: string };

/** What is happening now: the sessions' own steps, the pipeline's helper steps and its tickets in progress. */
export function nowRows(
  sessions: { title: string | null; places: Map<string, Spot> }[],
  run: {
    helpers: Map<string, { label: string; step: string | null; lastAt: string; active: boolean }>;
    tickets: Map<number, { number: number; station: string; step: string | null; finishedAt: string | null }>;
  } | null,
  project: string,
): NowRow[] {
  const now: NowRow[] = [];
  for (const s of sessions) {
    const spot = s.places.get(project); // only the steps that worked in THIS project
    if (spot?.step) now.push({ who: s.title ?? "Session", what: spot.step, at: spot.lastAt });
  }
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
