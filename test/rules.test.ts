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
    "await fsp.rm(dir)",
    "await fs.promises.rm(dir)",
    'await open(p, "a")',
    "fs.writev(fd, bufs)",
    'import { spawn } from "node:child_process";',
  ])("refuses %s outside the store", (line) => {
    expect(check("src/watcher/follow.ts", line).join()).toMatch(/only src\/store/);
  });

  it("does not mistake a network response for a disk write", () => {
    expect(check("src/server/http.ts", "res.writeHead(200);\nres.write(frame);")).toEqual([]);
    expect(check("src/server/http.ts", "fs.write(fd, x)")).toHaveLength(1);
    expect(check("src/server/http.ts", "await rm(dir)")).toHaveLength(1);
  });

  it("does not mistake look-alike names for disk writes", () => {
    expect(check("src/server/x.ts", 'os.cpus(); truncate(text, 40); await open(p, "r")')).toEqual([]);
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

describe("test samples", () => {
  it.each(['{"cwd":"/Users/ana/app"}', '{"cwd":"/home/ana/app"}', '{"to":"ana@gmail.com"}'])(
    "refuse real-looking data %s",
    (text) => {
      expect(findProblems([{ path: "test/fixtures/a.jsonl", text }]).join()).toMatch(/real data/);
    },
  );
  it("accept an invented sample, an example.com address and a marked fake secret", () => {
    expect(
      findProblems([{ path: "test/fixtures/a.jsonl", text: '{"cwd":"/work/demo-app","to":"dev@example.com"}' }]),
    ).toEqual([]);
    expect(
      findProblems([{ path: "test/x.test.ts", text: 'const k = "ghp_FAKEabcdefghijklmnopqrstuvwxyz1234";' }]),
    ).toEqual([]);
  });

  it("check the docs too", () => {
    expect(findProblems([{ path: "docs/notes.md", text: "logs live in /Users/ana/.claude" }]).join()).toMatch(
      /real data/,
    );
  });
});
