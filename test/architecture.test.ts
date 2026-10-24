import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { layerViolations } from "./layers.js";

function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) ? [{ path: relative(".", p).split(sep).join("/"), text: readFileSync(p, "utf8") }] : [];
  });
}

describe("the layers only point one way (SPEC section 7)", () => {
  it("holds for the real code", () => {
    expect(layerViolations(sources("src"))).toEqual([]);
  });
});

// The check is only worth something if it catches bad code.
describe("the layer check catches", () => {
  const bad = (path: string, text: string) => layerViolations([{ path, text }]);

  it.each([
    ['import { x } from "../web/page.js";', "src/store/db.ts"],
    ['import "../server/http.js";', "src/parser/line.ts"],
    ['const m = await import("../store/db.js");', "src/watcher/follow.ts"],
    ['import { run } from "../cli.js";', "src/parser/line.ts"],
    ['import { x } from "../../src/web/page.js";', "src/store/db.ts"],
  ])("%s in %s", (line, path) => {
    expect(bad(path, line).length).toBe(1);
  });

  it.each([
    'import { readFileSync } from "node:fs";',
    'import fs from "fs";',
    'import { DatabaseSync } from "node:sqlite";',
  ])("a pure layer importing %s", (line) => {
    expect(bad("src/parser/line.ts", line).length).toBe(1);
  });

  it("a pure layer calling fetch", () => {
    expect(bad("src/web/page.ts", "await fetch('/x')").length).toBe(1);
  });

  it("but not allowed imports, or words in comments", () => {
    expect(bad("src/watcher/follow.ts", 'import { parse } from "../parser/line.js";')).toEqual([]);
    expect(bad("src/parser/line.ts", '// see from "../web/page.js" for the screen')).toEqual([]);
    expect(bad("src/parser/line.ts", 'import { join } from "node:path";')).toEqual([]);
  });
});
