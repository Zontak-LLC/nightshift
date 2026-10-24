import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ProjectRow } from "./board.js";

/**
 * One line of `~/.nightshift/projects.json`: a folder, the name to show, `hide` to drop an auto-added repo, and
 * `watchSite` (the id of the site Night Watch watches for this project; "" = none).
 */
export type Pinned = { path: string; name: string; hide?: boolean; watchSite?: string };
/** A tile on the start page. `project` is the folder name (the board's address); `name` is what people read. */
export type Tile = ProjectRow & { name: string; active: boolean; pinned: boolean; watchSite: string | null };

/** The Night Watch site of the two projects it watches, used when a line says nothing (keys are folder names). */
export const DEFAULT_WATCH_SITES: Record<string, string> = { magsmith: "loader", usehourly: "usehourly" };
/** The Night Watch site for a project (folder name): the line's `watchSite`, else the default, else none. */
export function watchSiteOf(pinned: Pinned[], project: string, home: string): string | null {
  const line = pinned.find((p) => basename(expand(p.path, home)) === project);
  const site = line?.watchSite ?? DEFAULT_WATCH_SITES[project];
  return site?.trim() ? site.trim() : null;
}

export const DEFAULT_PINNED: Pinned[] = [
  { path: "~/Projects/magsmith", name: "Loader", watchSite: "loader" },
  { path: "~/Projects/usehourly", name: "UseHourly", watchSite: "usehourly" },
  { path: "~/Projects/nightwatch", name: "Night Watch" },
  { path: "~/Projects/nightshift", name: "Night Shift" },
];
/** A repository next to the pinned ones is added by itself when Claude worked in it this recently. */
export const AUTO_DAYS = 30;
/** A project with a step this recently counts as busy even when no pipeline or agent is running. */
const BUSY_MS = 10 * 60_000;

export const expand = (path: string, home: string): string =>
  path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;

/** One line of the file; a line without a path is an error (the whole file is then ignored). */
function parseLine(item: unknown): Pinned {
  const o = (item ?? {}) as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path.trim()) throw new Error("every line needs a path");
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : basename(o.path.replace(/\/+$/, ""));
  const watch = typeof o.watchSite === "string" ? { watchSite: o.watchSite.trim() } : {};
  return { path: o.path.trim(), name, ...(o.hide === true ? { hide: true } : {}), ...watch };
}

/** Reads the list; a missing file is created with the defaults, a damaged one is ignored (defaults) and reported. */
export function loadPinned(file: string, warn: (message: string) => void): Pinned[] {
  if (!existsSync(file)) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(DEFAULT_PINNED, null, 2)}\n`);
    } catch (error) {
      warn(`could not create ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return DEFAULT_PINNED;
  }
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(data)) throw new Error("it must be a list");
    const out: Pinned[] = [];
    for (const item of data) out.push(parseLine(item));
    return out;
  } catch (error) {
    warn(`${file} is not usable (${error instanceof Error ? error.message : String(error)}); using the defaults`);
    return DEFAULT_PINNED;
  }
}

type Options = { home: string; nowMs: number; isRepo?: (folder: string) => boolean };

/**
 * The start page's tiles: the pinned projects (always, even idle), the repositories directly under `~/Projects`
 * with Claude activity in the last 30 days, and any other project that is busy right now. Busy ones come first,
 * then the newest.
 */
export function projectTiles(rows: ProjectRow[], pinned: Pinned[], o: Options): Tile[] {
  const isRepo = o.isRepo ?? ((folder: string) => existsSync(join(folder, ".git")));
  const byProject = new Map(rows.map((r) => [r.project, r]));
  const hidden = new Set(pinned.filter((p) => p.hide).map((p) => basename(expand(p.path, o.home))));
  const tiles = new Map<string, Tile>();
  const busy = (r: ProjectRow) => r.running > 0 || r.agents > 0 || o.nowMs - Date.parse(r.lastAt) <= BUSY_MS;
  const add = (r: ProjectRow, name: string, isPinned: boolean) =>
    tiles.set(r.project, {
      ...r,
      name,
      active: busy(r),
      pinned: isPinned,
      watchSite: watchSiteOf(pinned, r.project, o.home),
    });
  for (const p of pinned) {
    if (p.hide) continue;
    const folder = expand(p.path, o.home);
    const key = basename(folder) || folder;
    const row = byProject.get(key) ?? { project: key, folder, lastAt: "", running: 0, agents: 0, open: 0 };
    add({ ...row, folder }, p.name, true);
  }
  const projectsDir = join(o.home, "Projects");
  for (const r of rows) {
    if (tiles.has(r.project) || hidden.has(r.project)) continue;
    const recent = Date.parse(r.lastAt) >= o.nowMs - AUTO_DAYS * 86_400_000;
    const auto = recent && dirname(r.folder) === projectsDir && isRepo(r.folder);
    if (auto || busy(r)) add(r, r.project, false);
  }
  return [...tiles.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.lastAt.localeCompare(a.lastAt));
}
