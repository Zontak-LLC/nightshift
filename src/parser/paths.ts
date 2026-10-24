import { resolve } from "node:path";

type Input = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const MAX_PATHS = 8;
const MAX_LENGTH = 300;

/** A word from a shell command, without the quotes around it or a trailing `;` `)` `,`. */
const clean = (word: string): string => word.replace(/^["'(]+|["');,]+$/g, "");

/** Where a command goes: its `cd` targets, `git -C` folders and any absolute (or `~/`) path it names. */
function commandPaths(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/(?:\bcd\s+|\bgit\s+-C\s+)("[^"]+"|'[^']+'|[^\s;&|]+)/g))
    out.push(clean(m[1] ?? ""));
  for (const word of command.split(/\s+/)) {
    const w = clean(word);
    if (w.startsWith("/") || w.startsWith("~/")) out.push(w);
  }
  return out;
}

/**
 * The folders and files a tool call works on, as absolute paths (a leading `~` is kept for the store to expand). This
 * tells a background agent's real project apart from the folder its parent session started in. Pure: nothing is read.
 */
export function pathsOf(tool: string, input: Input, cwd: string): string[] {
  const raw =
    tool === "Bash" || tool === "bash"
      ? commandPaths(text(input.command))
      : [text(input.file_path), text(input.notebook_path), text(input.path)];
  const out = new Set<string>();
  for (const p of raw) {
    if (!p || p.length > MAX_LENGTH) continue;
    if (p.startsWith("~") && p !== "~" && !p.startsWith("~/")) continue; // another user's home: not a place we know
    if (p.startsWith("~") || p.startsWith("/")) out.add(p);
    else if (cwd && (p.startsWith("./") || p.startsWith("../") || p === ".." || p === ".")) out.add(resolve(cwd, p));
  }
  return [...out].slice(0, MAX_PATHS);
}
