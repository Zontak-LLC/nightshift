import { describe, expect, it } from "vitest";
import { terminalPrinter } from "../src/terminal.js";

describe("the terminal view", () => {
  it("names the project once, then prints each step on one line with its time", () => {
    const print = terminalPrinter();
    const at = "2026-10-23T22:01:02.000Z";
    expect(print({ kind: "session.seen", at, sessionId: "s", cwd: "/work/demo-app", branch: "main" })).toContain(
      "demo-app",
    );
    expect(print({ kind: "session.seen", at, sessionId: "s", cwd: "/work/demo-app", branch: "main" })).toBeNull();
    expect(
      print({ kind: "tool.use", at, sessionId: "s", toolUseId: "t", tool: "Edit", summary: "Editing a.ts" }),
    ).toMatch(/^\d\d:\d\d:02 {2}demo-app\s+Editing a\.ts$/);
    expect(print({ kind: "tool.result", at, sessionId: "s", toolUseId: "t", ok: true })).toBeNull();
    expect(print({ kind: "tool.result", at, sessionId: "s", toolUseId: "t", ok: false })).toContain("failed");
    expect(print({ kind: "pr.link", at, sessionId: "s", number: 7, url: "https://x" })).toContain("#7");
    expect(print({ kind: "reply", at, sessionId: "s", text: "ok" })).toBeNull();
  });

  it("prints a title or a pull request once, even when the log repeats it", () => {
    const print = terminalPrinter();
    const at = "2026-10-23T22:01:02.000Z";
    const title = { kind: "session.title", at, sessionId: "s", title: "Fix login" } as const;
    expect(print(title)).toContain("Fix login");
    expect(print(title)).toBeNull();
    expect(print({ ...title, title: "Fix login, part 2" })).toContain("part 2");
    const pr = { kind: "pr.link", at, sessionId: "s", number: 42, url: "https://example.com/pr/42" } as const;
    expect(print(pr)).toContain("#42");
    expect(print(pr)).toBeNull();
    expect(print({ ...pr, at: "" })).toBeNull();
    expect(print({ ...title, at: "", title: "No time" })).toMatch(/^ {8} {2}/);
  });

  it("prints escape codes from a log as harmless marks, so a prompt cannot steer the terminal", () => {
    const print = terminalPrinter();
    const out = print({ kind: "prompt", at: "", sessionId: "s", text: "hi \u001b]0;owned\u0007 \u001b[2J" }) ?? "";
    expect([...out].some((c) => (c.codePointAt(0) ?? 0) < 0x20)).toBe(false);
    expect(out).toContain("hi");
  });
});
