// Runs the project rules (scripts/rules.mjs) over src, test and scripts. Part of `npm run ci`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findProblems } from "./rules.mjs";

const SELF = new Set(["scripts/rules.mjs", "scripts/check-rules.mjs", "test/rules.test.ts"]);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|mjs)$/.test(name)) {
      const path = relative(".", p).split(sep).join("/");
      if (!SELF.has(path)) files.push({ path, text: readFileSync(p, "utf8") });
    }
  }
};
for (const root of ["src", "test", "scripts"]) walk(root);

const problems = findProblems(files);
if (problems.length) {
  console.error(`check-rules: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.info(`check-rules: ${files.length} files, clean`);
