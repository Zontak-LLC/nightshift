import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Scenario: the owner starts the demo board to take the README screenshot. It must show the two invented projects,
// alive (times moved into the last hour), and nothing from this computer's own Claude Code logs.
const SCRIPT = join(import.meta.dirname, "..", "scripts", "demo-board.mjs");
let child: ChildProcess | null = null;
afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child?.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  child = null;
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

type Row = { project: string; name: string; active: boolean; pinned: boolean; folder: string };

async function firstProjects(port: number): Promise<Row[]> {
  for (let tries = 0; tries < 100; tries++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/events?project=`);
      const reader = res.body?.getReader();
      let text = "";
      while (!/event: projects\ndata: .*\n/.test(text)) text += new TextDecoder().decode((await reader?.read())?.value);
      await reader?.cancel();
      const rows: Row[] = JSON.parse(/event: projects\ndata: (.*)\n/.exec(text)?.[1] ?? "[]");
      if (rows.some((r) => r.active)) return rows;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

describe("the demo board for the README screenshot", () => {
  it("shows Demo App and Shop App from the fixtures, with recent activity", async () => {
    const port = await freePort();
    child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, NIGHTSHIFT_PORT: String(port), NIGHTSHIFT_NIGHTWATCH_URL: "" },
      stdio: "ignore",
    });
    const rows = await firstProjects(port);
    const names = rows.map((r) => r.name);
    expect(names).toContain("Demo App");
    expect(names).toContain("Shop App");
    expect(rows.find((r) => r.name === "Shop App")).toMatchObject({ project: "shop-app", pinned: true, active: true });
    expect(rows.every((r) => r.folder.startsWith("/work/"))).toBe(true);
  }, 20_000);
});
