import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Scenario: a developer whose projects.json relied on the old built-in Sentinel sites runs the move script once
// (and maybe twice by mistake). Every name below is invented.
const SCRIPT = join(import.meta.dirname, "..", "scripts", "fill-watch-sites.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

const LIST = [
  { path: "~/Projects/my-app", name: "My App" },
  { path: "~/Projects/demo-app", name: "Demo App", watchSite: "demo-old" },
  { path: "~/Projects/shop-app/", name: "Shop App", watchSite: "" },
  { path: "~/Projects/tools", name: "Tools", hide: true },
];
let dir = "";
let file = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-fill-"));
  file = join(dir, "projects.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("filling in the watchSite of an old projects.json", () => {
  it("backs the file up, adds the site only where it is missing, and keeps every line in its place", () => {
    const original = `${JSON.stringify(LIST, null, 2)}\n`;
    writeFileSync(file, original);
    const out = run(file, "my-app=my-site", "demo-app=demo-new", "shop-app=shop-site", "ghost=ghost-site");
    expect(out.status).toBe(0);

    const backups = readdirSync(dir).filter((n) => n.startsWith("projects.json.bak-"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^projects\.json\.bak-\d{4}-\d{2}-\d{2}$/);
    expect(readFileSync(join(dir, backups[0] ?? ""), "utf8")).toBe(original);

    const after = JSON.parse(readFileSync(file, "utf8"));
    expect(after).toEqual([
      { path: "~/Projects/my-app", name: "My App", watchSite: "my-site" },
      { path: "~/Projects/demo-app", name: "Demo App", watchSite: "demo-old" }, // kept
      { path: "~/Projects/shop-app/", name: "Shop App", watchSite: "" }, // switched off on purpose: kept
      { path: "~/Projects/tools", name: "Tools", hide: true },
    ]);
    expect(out.stdout).toContain("Before");
    expect(out.stdout).toContain("After");
    expect(out.stdout).toContain(`"watchSite": "my-site"`);
    expect(out.stdout).toContain("Added: my-app=my-site");
  });

  it("changes nothing on a second run", () => {
    writeFileSync(file, `${JSON.stringify(LIST, null, 2)}\n`);
    expect(run(file, "my-app=my-site").status).toBe(0);
    const once = readFileSync(file, "utf8");
    const again = run(file, "my-app=my-site");
    expect(again.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(once);
    expect(again.stdout).toContain("Nothing to add; the file is unchanged.");
    expect(readdirSync(dir).filter((n) => n.includes(".bak-"))).toHaveLength(1);
  });

  it("says so and leaves the folder as it was when the file is missing", () => {
    const out = run(file, "my-app=my-site");
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("is missing; nothing changed");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a damaged file or a bad pair without touching anything", () => {
    writeFileSync(file, "{not json");
    expect(run(file, "my-app=my-site").stderr).toContain("is not JSON");
    expect(run(file, "my-app").stderr).toContain('"my-app" is not folder=site');
    expect(readdirSync(dir)).toEqual(["projects.json"]);
    expect(readFileSync(file, "utf8")).toBe("{not json");
  });
});
