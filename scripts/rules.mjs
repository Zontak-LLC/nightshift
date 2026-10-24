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

const REAL_DATA = [
  ["a home folder", /\/Users\/[a-z]|\/home\/[a-z]|[A-Z]:\\\\Users|-Users-[a-z]+-|\/Volumes\/|\/root\//i],
  ["an email address", /[\w.+-]+@(?!example\.(com|org)\b|demo\.invalid\b)[\w-]+\.[\w.]+/i],
  [
    "a secret",
    /sk-ant-[\w-]{8,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\./,
  ],
];
/** What real-looking data a text holds, or null. Secret-looking strings inside test inputs are marked with FAKE. */
function realData(text) {
  for (const [what, re] of REAL_DATA) {
    const hit = re.exec(text);
    if (hit && !/FAKE/.test(text.slice(Math.max(0, hit.index - 80), hit.index + 80))) return what;
  }
  return null;
}

/** @param {{ path: string, text: string }[]} files  paths with forward slashes, relative to the repo */
export function findProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    // Samples, tests and docs must hold invented data only (real in shape): never a home folder, a personal address
    // or a secret from someone's logs. Fixtures (.json/.jsonl) are data files: rules-ok cannot exempt them.
    if (/\.jsonl?$/.test(path) || path.startsWith("test/") || path.startsWith("docs/")) {
      const found = realData(text);
      if (found) problems.push(`${path}: looks like real data (${found}); invent the sample instead`);
      if (/\.jsonl?$/.test(path) || path.startsWith("docs/")) continue;
    }
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
