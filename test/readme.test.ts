import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
