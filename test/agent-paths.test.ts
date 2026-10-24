import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("finding the project from tool calls", () => {
  it("reads paths from file tools and from cd and git -C in a command, and keeps relative ones inside the cwd", async () => {
    const { pathsOf } = await import("../src/parser/paths.js");
    expect(pathsOf("Edit", { file_path: "/a/b/c.ts" }, "/a")).toEqual(["/a/b/c.ts"]);
    expect(pathsOf("Bash", { command: "cd ~/Projects/x && git -C '/p/qr' status; cd ../up" }, "/w/here")).toEqual([
      "~/Projects/x",
      "/p/qr",
      "/w/up",
    ]);
    expect(pathsOf("Read", { file_path: "relative/only.ts" }, "/w")).toEqual([]);
    expect(pathsOf("Bash", { command: "cd ~root/x" }, "/w")).toEqual([]);
    expect(pathsOf("Bash", { command: 1 }, "/w")).toEqual([]);
  });

  it("never lets the home folder or a folder without git decide, and treats a removed worktree path as its repo", async () => {
    const { repoRootOf } = await import("../src/store/index.js");
    const home = realpathSync(mkdtempSync(join(tmpdir(), "nightshift-home-")));
    try {
      mkdirSync(join(home, ".git"), { recursive: true }); // a dotfiles repo in the home folder
      mkdirSync(join(home, "plain", "deep"), { recursive: true });
      expect(repoRootOf(join(home, "plain", "deep", "f.txt"), home)).toBeNull();
      expect(repoRootOf("relative/path", home)).toBeNull();
      expect(repoRootOf(join(home, "Projects", "gone", ".claude", "worktrees", "w1", "x.ts"), home)).toEqual({
        root: join(home, "Projects", "gone"),
        worktree: true,
      });
      mkdirSync(join(home, "Projects", "app", ".git"), { recursive: true });
      expect(repoRootOf("~/Projects/app/src/new.ts", home)).toEqual({
        root: join(home, "Projects", "app"),
        worktree: false,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("a command that starts with cd names the program after it", () => {
  it("says what runs in the folder, not 'cd'", async () => {
    const { toolSummary } = await import("../src/parser/index.js");
    expect(toolSummary("Bash", { command: "cd ~/Projects/x && npm run ci" }, "/w")).toBe("Running npm run ci");
    expect(toolSummary("Bash", { command: "cd '/a b'; cd c && git status" }, "/w")).toBe("Running git status");
    expect(toolSummary("Bash", { command: "ls" }, "/w")).toBe("Running ls");
  });
});
