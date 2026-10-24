import { readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, string | null>();

/** "Zontak-LLC/usehourly" from the folder's git remote "origin", or null. Read only, cached per folder. */
export function repoOf(folder: string): string | null {
  if (cache.has(folder)) return cache.get(folder) ?? null;
  let repo: string | null = null;
  try {
    const config = readFileSync(join(folder, ".git", "config"), "utf8");
    const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1] ?? "";
    repo = /[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin)?.[1] ?? null;
  } catch {
    repo = null; // not a git folder, or no remote: the board shows the folder name instead
  }
  cache.set(folder, repo);
  return repo;
}
