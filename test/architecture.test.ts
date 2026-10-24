import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layers only point one way (SPEC section 7): watcher -> parser -> store -> server -> web.
 * Each layer may import only the layers listed for it. This is the main guard against a slow tangle.
 */
const ALLOWED: Record<string, string[]> = {
  parser: [],
  watcher: ["parser"],
  store: ["parser"],
  server: ["store", "parser"],
  web: [],
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.ts$/.test(name) ? [p] : [];
  });
}

describe("the layers only point one way", () => {
  for (const [layer, allowed] of Object.entries(ALLOWED)) {
    it(`${layer} imports only ${allowed.length ? allowed.join(", ") : "nothing else in src"}`, () => {
      for (const file of sources(join("src", layer))) {
        const imports = [...readFileSync(file, "utf8").matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].map((m) => m[1] ?? "");
        for (const spec of imports) {
          const target = Object.keys(ALLOWED).find((l) => spec.includes(`../${l}/`) || spec.startsWith(`../${l}`));
          if (target && target !== layer) expect(allowed, `${file} imports ${spec}`).toContain(target);
        }
      }
    });
  }

  it("the parser never touches the file system or the network", () => {
    for (const file of sources(join("src", "parser"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["']node:(fs|net|http|https)/);
    }
  });
});
