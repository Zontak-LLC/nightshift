import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseArgs, startBanner, usage } from "../src/usage.js";
import { OLD_NAMES } from "./old-names.js";

// Runs the real command with the same Node that runs the tests (no npx, no network, works on Windows too).
const run = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });

// Scenario: a developer who just installed Lens asks it what it is.
describe("a developer runs nightshift for the first time", () => {
  it("explains what it does, how to use it, and that nothing leaves the computer", () => {
    const { stdout, status } = run("--help");
    expect(status).toBe(0);
    expect(stdout).toMatch(/^Lens \d+\.\d+\.\d+/);
    expect(stdout).toContain("Claude Code agents");
    expect(stdout).toContain("-v, --version");
    expect(stdout).toContain("Lens only reads Claude Code's log files. Nothing leaves your computer.");
    for (const old of OLD_NAMES) expect(stdout).not.toContain(old);
  });

  it("says Lens, what it watches and where the board is when it starts", () => {
    const text = startBanner({
      version: "1.2.3",
      root: "~/.claude/projects",
      db: "~/.nightshift/nightshift.db",
      keepDays: 30,
      port: 4400,
    });
    expect(text.startsWith("Lens 1.2.3 · watching ~/.claude/projects\n")).toBe(true);
    expect(text).toContain("History: ~/.nightshift/nightshift.db (30 days)");
    expect(text).toContain("Board: http://localhost:4400/");
    expect(text).toContain("Desks: http://localhost:4400/agents");
  });

  it("prints just the version for --version", () => {
    expect(run("--version").stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("refuses an unknown option with exit code 2 and shows the help", () => {
    const { stderr, status } = run("--bogus");
    expect(status).toBe(2);
    expect(stderr).toContain("unknown option --bogus");
    expect(stderr).toContain("Usage:");
  });

  it("works as the built, installed command too", () => {
    execFileSync("npm", ["run", "build", "--silent"], { encoding: "utf8", shell: process.platform === "win32" });
    const built = spawnSync(process.execPath, ["dist/cli.js", "--version"], { encoding: "utf8" });
    expect(built.status).toBe(0);
    expect(built.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 60_000);
});

describe("reading the command line", () => {
  it.each([
    [[], "start"],
    [["-h"], "help"],
    [["--help"], "help"],
    [["-v"], "version"],
    [["--version"], "version"],
    [["--bogus"], "unknown"],
  ])("%j means %s", (args, kind) => {
    expect(parseArgs(args).kind).toBe(kind);
  });

  it("names the version in the help", () => {
    expect(usage("1.2.3").split("\n")[0]).toBe("Lens 1.2.3");
  });
});
