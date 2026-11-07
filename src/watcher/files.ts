/**
 * Which files under Claude Code's projects folder are logs. Listed with the SYNC calls on purpose: a listing is a few
 * dozen folders, and a sync call always returns, so a stuck background read can never also stop the listing (or the
 * health probe that uses it). Read only.
 */
import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogFile = {
  path: string;
  journal: { runId: string; sessionId: string } | null;
  /** A background agent's `agent-<id>.meta.json`: a small JSON file with the description it was started with. */
  meta?: { sessionId: string; agentId: string };
};

/** A problem worth telling (a folder that cannot be read), as opposed to one that just vanished meanwhile. */
type Report = (error: unknown) => void;

const missing = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

function names(dir: string, report: Report): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    if (!missing(error)) report(error);
    return [];
  }
}

function entries(dir: string, report: Report): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (!missing(error)) report(error);
    return null;
  }
}

const jsonl = (dir: string, report: Report): string[] =>
  names(dir, report)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f));

/** The workflows of one session: each run's journal FIRST (so its agents are known), then the agents' own logs. */
function workflowLogs(sessionDir: string, sessionId: string, report: Report): LogFile[] {
  const out: LogFile[] = [];
  const workflows = join(sessionDir, "subagents", "workflows");
  for (const runId of names(workflows, report)) {
    const files = jsonl(join(workflows, runId), report);
    const journal = files.find((f) => f.endsWith("journal.jsonl"));
    if (journal) out.push({ path: journal, journal: { runId, sessionId } });
    for (const f of files) if (f !== journal) out.push({ path: f, journal: null });
  }
  return out;
}

/** One session folder's logs: its workflows, its background agents' logs and their `.meta.json` descriptions. */
function sessionLogs(path: string, sessionId: string, report: Report): LogFile[] {
  const out = workflowLogs(path, sessionId, report);
  const subagents = join(path, "subagents");
  for (const f of jsonl(subagents, report)) out.push({ path: f, journal: null });
  for (const f of names(subagents, report)) {
    const agentId = /^agent-(.+)\.meta\.json$/.exec(f)?.[1];
    if (agentId) out.push({ path: join(subagents, f), journal: null, meta: { sessionId, agentId } });
  }
  return out;
}

/** Every log under `root`, or null when `root` cannot be listed (not there yet). Session folders hold their agents' logs. */
export function logFiles(root: string, report: Report = () => {}): LogFile[] | null {
  const projects = entries(root, report);
  if (!projects) return null;
  const out: LogFile[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    for (const entry of entries(dir, report) ?? []) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push({ path, journal: null });
      else if (entry.isDirectory()) out.push(...sessionLogs(path, entry.name, report));
    }
  }
  return out;
}

/** When any log under `root` last changed (ms), or null when there is none. For `/health`: is there work to read? */
export function newestChange(root: string): number | null {
  let newest: number | null = null;
  for (const file of logFiles(root) ?? []) {
    if (file.meta) continue;
    try {
      const { mtimeMs } = statSync(file.path);
      if (newest === null || mtimeMs > newest) newest = mtimeMs;
    } catch {
      // gone between the listing and the look: it is not news
    }
  }
  return newest;
}
