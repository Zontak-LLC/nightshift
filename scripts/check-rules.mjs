// Rules the linter cannot express. Each one keeps the project from drifting; exempt one line with
// `rules-ok: <reason>` on it or on the line above. Run by `npm run ci`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_LINES = 300;
const roots = ["src", "test", "scripts"];
const rules = [
  { name: "no @ts-ignore / @ts-expect-error", test: (l) => /@ts-(ignore|expect-error)/.test(l) },
  { name: "TODO needs a ticket number (TODO(#12))", test: (l) => /\bTODO\b(?!\(#\d+\))/.test(l) },
  { name: "no hard-coded personal paths", test: (l) => /\/Users\/[a-z]|C:\\\\Users\\\\/i.test(l) },
  { name: "no .only in tests", test: (l) => /\b(it|test|describe)\.only\(/.test(l) },
  { name: "no eval / new Function", test: (l) => /\beval\(|new Function\(/.test(l) },
];
// Night Shift only reads Claude Code's files. Writing to disk happens in one place: the store.
const WRITE = /\b(writeFile|appendFile|rmSync|rm\(|unlink|mkdir|rename|createWriteStream)\b/;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|mjs)$/.test(name)) files.push(p);
  }
};
for (const r of roots) walk(r);

const problems = [];
for (const file of files) {
  if (file === "scripts/check-rules.mjs") continue;
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines.length > MAX_LINES) problems.push(`${file}: ${lines.length} lines (max ${MAX_LINES}); split it`);
  lines.forEach((line, i) => {
    const exempt = /rules-ok:/.test(line) || /rules-ok:/.test(lines[i - 1] ?? "");
    if (exempt) return;
    for (const rule of rules) if (rule.test(line)) problems.push(`${file}:${i + 1}: ${rule.name}`);
    if (file.startsWith("src/") && !file.startsWith("src/store/") && !file.endsWith(".test.ts") && WRITE.test(line))
      problems.push(`${file}:${i + 1}: only src/store/ may write to disk`);
  });
}
if (problems.length) {
  console.error(`check-rules: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.info(`check-rules: ${files.length} files, clean`);
