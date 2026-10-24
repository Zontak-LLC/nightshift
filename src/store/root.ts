import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The repository a path belongs to: its main folder, and whether the path was in one of its linked worktrees. */
export type RepoRoot = { root: string; worktree: boolean };
export type RootOf = (path: string) => RepoRoot | null;

const cache = new Map<string, RepoRoot | null>();

/** A linked worktree has a `.git` FILE: "gitdir: <main>/.git/worktrees/<name>". The main folder is above `.git`. */
function mainOfWorktree(gitFile: string): string | null {
  try {
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitFile, "utf8"))?.[1]?.trim() ?? "";
    return /^(.*)\/\.git\/worktrees\/[^/]+\/?$/.exec(gitdir)?.[1] ?? null;
  } catch {
    return null;
  }
}

function lookup(path: string, home: string): RepoRoot | null {
  const expanded = path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
  if (!expanded.startsWith("/")) return null;
  // Claude Code's own worktrees live inside the main repo: the path alone says which one, even after it is removed.
  const inside = /^(.*?)\/\.claude\/worktrees\/[^/]+/.exec(expanded)?.[1];
  if (inside && inside !== home) return { root: inside, worktree: true };
  for (let dir = expanded; dir !== "/" && dir !== home && dir !== dirname(dir); dir = dirname(dir)) {
    const git = join(dir, ".git");
    if (!existsSync(git)) continue;
    if (!statSync(git).isFile()) return { root: dir, worktree: false };
    const main = mainOfWorktree(git);
    return main && main !== home ? { root: main, worktree: true } : { root: dir, worktree: false };
  }
  return null; // no repository (a temp folder, ~/.claude, the home folder itself): it says nothing about a project
}

/**
 * The git repository a path belongs to, found by walking up to the folder that holds `.git` (read only; cached). A
 * linked worktree counts as its main repository. The home folder and `/` never count, so a dotfiles repo cannot
 * swallow everything under `~`.
 */
export function repoRootOf(path: string, home = homedir()): RepoRoot | null {
  const key = `${home}\n${path}`;
  if (!cache.has(key)) cache.set(key, lookup(path, home));
  return cache.get(key) ?? null;
}
