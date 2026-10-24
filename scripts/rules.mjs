// The rules the linter cannot express, as a pure function so they can be tested with bad code (test/rules.test.ts).
// Exempt one line with `rules-ok: <reason>` on it or on the line above.

export const MAX_LINES = 300;

const LINE_RULES = [
  { name: "no @ts-ignore / @ts-expect-error", test: (l) => /@ts-(ignore|expect-error)/.test(l) },
  { name: "TODO needs a ticket number (TODO(#12))", test: (l) => /\bTODO\b(?!\(#\d+\))/.test(l) },
  { name: "no hard-coded personal paths", test: (l) => /\/Users\/[a-z]|\/home\/[a-z]|[A-Z]:\\\\Users\\\\/i.test(l) },
  { name: "no .only in tests", test: (l) => /\b(it|test|describe)\.only\(/.test(l) },
  { name: "no eval / new Function", test: (l) => /\beval\(|new Function\(/.test(l) },
];

// Night Shift only reads Claude Code's files. Writing to disk, or starting other programs, happens in the store only.
const WRITES =
  /\b(write|append|mkdir|rename|unlink|rmdir|rm|copyFile|cp|truncate|symlink|chmod|utimes|createWriteStream)\w*\s*\(/;
const CHILD_PROCESS = /["']node:child_process["']|["']child_process["']/;

/** @param {{ path: string, text: string }[]} files  paths with forward slashes, relative to the repo */
export function findProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    const lines = text.split("\n");
    if (lines.length > MAX_LINES) problems.push(`${path}: ${lines.length} lines (max ${MAX_LINES}); split it`);
    const inSrc = path.startsWith("src/") && !path.endsWith(".test.ts");
    const mayWrite = path.startsWith("src/store/");
    lines.forEach((line, i) => {
      if (/rules-ok:/.test(line) || /rules-ok:/.test(lines[i - 1] ?? "")) return;
      for (const rule of LINE_RULES) if (rule.test(line)) problems.push(`${path}:${i + 1}: ${rule.name}`);
      if (inSrc && !mayWrite && (WRITES.test(line) || CHILD_PROCESS.test(line)))
        problems.push(`${path}:${i + 1}: only src/store/ may write to disk or start programs`);
    });
  }
  return problems;
}
