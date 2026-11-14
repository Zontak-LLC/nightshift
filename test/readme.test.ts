import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OLD_NAMES } from "./old-names.js";

// Scenario: a stranger opens the public repo. scripts/check-rules.mjs does not scan README.md, so this guards it:
// the new name, no private projects or paths, no dead link to Sentinel's private repo, and a real-sized screenshot.
const ROOT = join(import.meta.dirname, "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const SHOT = join(ROOT, "docs", "screenshot.png");

describe("the README a stranger reads first", () => {
  it("is about Lens and shows the board", () => {
    expect(README.startsWith("# Lens\n")).toBe(true);
    expect(README).toContain("](docs/screenshot.png)");
  });

  it.each([
    "Ticket 3",
    "npx nightshift",
    "magsmith",
    "usehourly",
    "Loader",
    "UseHourly",
    "/Users/",
    "../nightwatch",
    "github.com/Zontak-LLC/nightwatch",
  ])("does not say %s", (word) => {
    expect(README).not.toContain(word);
  });

  // The one place the old name is meant: README's note on why the command keeps it. Only that exact sentence is
  // removed, so a second mention anywhere else still fails.
  const RENAME_NOTE = "Lens was called Night Shift; the repo, the command and ~/.nightshift keep that name for now.";
  const docs: [string, string][] = [
    ["README.md", README.replace(RENAME_NOTE, "")],
    ["SECURITY.md", readFileSync(join(ROOT, "SECURITY.md"), "utf8")],
    ["docs/SPEC.md", readFileSync(join(ROOT, "docs", "SPEC.md"), "utf8")],
  ];

  it("keeps its one rename note", () => {
    expect(README).toContain(RENAME_NOTE);
  });

  it.each(docs)("%s says none of the old names", (_file, text) => {
    for (const old of OLD_NAMES) expect(text).not.toContain(old);
  });

  it("has a screenshot under 500 KB, 1200 to 1600 px wide", () => {
    expect(existsSync(SHOT)).toBe(true);
    expect(statSync(SHOT).size).toBeLessThan(500 * 1024);
    const png = readFileSync(SHOT);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    const width = png.readUInt32BE(16); // the IHDR chunk: width, then height
    expect(width).toBeGreaterThanOrEqual(1200);
    expect(width).toBeLessThanOrEqual(1600);
  });
});
