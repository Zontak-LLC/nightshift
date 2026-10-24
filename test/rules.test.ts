import { describe, expect, it } from "vitest";
import { findProblems } from "../scripts/rules.mjs";

const check = (path: string, text: string): string[] => findProblems([{ path, text }]);

// The guardrails are only worth something if they catch bad code. Each case is code they must refuse.
describe("the rules catch what they claim to catch", () => {
  it.each([
    "writeFileSync(p, x)",
    "await writeFile(p, x)",
    "appendFileSync(p, x)",
    "mkdirSync(d)",
    "renameSync(a, b)",
    "unlinkSync(p)",
    'rm("x")',
    "copyFileSync(a, b)",
    "createWriteStream(p)",
    'import { spawn } from "node:child_process";',
  ])("refuses %s outside the store", (line) => {
    expect(check("src/watcher/follow.ts", line).join()).toMatch(/only src\/store/);
  });

  it("lets the store write", () => {
    expect(check("src/store/db.ts", "writeFileSync(p, x)")).toEqual([]);
  });

  it.each([
    ["// @ts-ignore", /ts-ignore/],
    ["// TODO tidy this", /TODO needs a ticket/],
    ['const p = "/Users/denis/logs";', /personal paths/],
    ['const p = "/home/ana/logs";', /personal paths/],
    ["it.only('x', () => {})", /\.only/],
    ["eval(code)", /eval/],
  ])("refuses %s", (line, rule) => {
    expect(check("src/parser/x.ts", line).join()).toMatch(rule);
  });

  it("accepts a TODO with a ticket and an exempted line", () => {
    expect(check("src/parser/x.ts", "// TODO(#12) later")).toEqual([]);
    expect(check("src/watcher/x.ts", "// rules-ok: reads only\nwriteFileSync(p)")).toEqual([]);
  });

  it("refuses a file over 300 lines", () => {
    expect(check("src/parser/x.ts", "x\n".repeat(301)).join()).toMatch(/lines \(max 300\)/);
  });
});
