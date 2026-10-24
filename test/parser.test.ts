import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLine, parseLog, toolSummary } from "../src/parser/index.js";

const sample = readFileSync("test/fixtures/session-basic.jsonl", "utf8");

// SPEC scenario 2: a session reads a file, edits it and runs the tests; Night Shift sees each step in order.
describe("a session works on a bug", () => {
  const { events, skipped } = parseLog(sample);
  const steps = events.filter((e) => e.kind === "tool.use" || e.kind === "tool.result");

  it("shows the steps in order, in words a person reads", () => {
    expect(steps.map((e) => (e.kind === "tool.use" ? e.summary : e.ok ? "ok" : "failed"))).toEqual([
      "Reading src/login-form.ts",
      "ok",
      "Editing src/login-form.ts",
      "ok",
      "Run the tests",
      "failed",
    ]);
  });

  it("knows the project folder, the branch, the title, the first request and the pull request", () => {
    expect(events.find((e) => e.kind === "session.seen")).toMatchObject({ cwd: "/work/demo-app", branch: "fix-login" });
    expect(events.find((e) => e.kind === "session.title")).toMatchObject({ title: "Fix the login form bug" });
    expect(events.find((e) => e.kind === "prompt")).toMatchObject({ text: "Fix the login bug in the form" });
    expect(events.find((e) => e.kind === "pr.link")).toMatchObject({ number: 42 });
    expect(events.find((e) => e.kind === "reply")).toMatchObject({ text: "I'll look at the form first." });
  });

  it("ties each result to its tool call", () => {
    const uses = steps.filter((e) => e.kind === "tool.use").map((e) => e.toolUseId);
    const results = steps.filter((e) => e.kind === "tool.result").map((e) => e.toolUseId);
    expect(results).toEqual(uses);
  });

  // SPEC scenario 5: a half-written or unknown line is skipped and counted, never a crash.
  it("skips and counts the broken lines, and stays quiet about Claude Code's own bookkeeping", () => {
    expect(skipped).toBe(2);
    expect(events.every((e) => e.sessionId === "s-demo-1")).toBe(true);
  });
});

describe("lines that must not crash or mislead", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["[]", 1],
    ["42", 1],
    ["null", 1],
    ['{"type":"assistant"}', 1],
    ['{"type":"weird","sessionId":"s"}', 1],
  ])("%j is skipped (%i)", (line, skipped) => {
    expect(parseLine(line)).toEqual({ events: [], skipped });
  });

  it("does not report a meta message as something the person asked", () => {
    const line = JSON.stringify({ type: "user", sessionId: "s", isMeta: true, message: { content: "<system note>" } });
    expect(parseLine(line).events.filter((e) => e.kind === "prompt")).toEqual([]);
  });
});

describe("one-line summaries", () => {
  const cwd = "/work/app";
  it.each([
    ["Read", { file_path: "/work/app/src/a.ts" }, "Reading src/a.ts"],
    ["Write", { file_path: "/elsewhere/notes.md" }, "Writing notes.md"],
    ["Bash", { command: "npm   run ci" }, "Running npm run ci"],
    ["Bash", { command: "git push origin main" }, "Running git push"],
    ["Bash", { command: 'curl -H "Authorization: Bearer abcdefghijklmnop" https://api.example.com' }, "Running curl"],
    ["Bash", { command: "API_KEY=abc123 node deploy.js" }, "Running node deploy.js"],
    // rules-ok: TODO here is search text in a test, not a note
    ["Grep", { pattern: "TODO" }, "Searching for TODO"],
    ["Agent", { description: "Review the diff" }, "Agent: Review the diff"],
    ["WebSearch", { query: "sse node" }, "Searching the web: sse node"],
    ["WebFetch", { url: "https://example.com" }, "Reading https://example.com"],
    ["mcp__claude_ai_Gmail__create_draft", {}, "Gmail: create draft"],
    ["SomethingNew", {}, "SomethingNew"],
  ])("%s %j → %s", (tool, input, expected) => {
    expect(toolSummary(tool, input, cwd)).toBe(expected);
  });

  it("cuts a very long description to one short line", () => {
    const s = toolSummary("Bash", { description: "x ".repeat(100) }, cwd);
    expect(s.length).toBeLessThanOrEqual(72);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("nothing secret reaches the screen", () => {
  it.each([
    ["Bash", { description: "Call the API with Bearer abcdefghijklmnopqrst" }, "Bearer •••"],
    ["Bash", { description: "Set GITHUB_TOKEN=ghp_FAKEabcdefghijklmnopqrstuvwxyz1234" }, "GITHUB_TOKEN=•••"],
    ["WebFetch", { url: "https://example.com/report?sig=abc&token=xyz" }, "Reading https://example.com/report?…"],
    ["Grep", { pattern: "sk-ant-api03-FAKEabcdefghijklmnop" }, "Searching for •••"],
  ])("%s %j shows %s", (tool, input, expected) => {
    expect(toolSummary(tool, input, "/work/app")).toContain(expected);
  });

  it("hides a key inside a reply too", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "s",
      message: { content: [{ type: "text", text: "Your key is sk-FAKEabcdefghijklmnopqrstuvwx." }] },
    });
    expect(JSON.stringify(parseLine(line).events)).not.toContain("abcdefghijklmnop");
  });
});

describe("what counts as something the person asked", () => {
  const user = (content: unknown, extra: Record<string, unknown> = {}) =>
    parseLine(JSON.stringify({ type: "user", sessionId: "s", message: { content }, ...extra })).events.filter(
      (e) => e.kind === "prompt",
    );

  it("a slash command, its output or a system note is not a prompt", () => {
    expect(user("<command-name>/clear</command-name>")).toEqual([]);
    expect(user("<local-command-stdout>done</local-command-stdout>")).toEqual([]);
    expect(user("<system-reminder>note</system-reminder>")).toEqual([]);
  });

  it("a prompt sent as text blocks is a prompt", () => {
    expect(user([{ type: "text", text: "Please fix the header" }])).toHaveLength(1);
  });

  it("a subagent's own prompt is not shown as the person's", () => {
    expect(user("Review the diff", { isSidechain: true })).toEqual([]);
  });
});

describe("odd lines never crash", () => {
  it.each([
    JSON.stringify({ type: "assistant", sessionId: "s", message: { content: [null, 3, "x", []] } }),
    JSON.stringify({
      type: "assistant",
      sessionId: "s",
      message: { content: [{ type: "tool_use", id: 5, name: {} }] },
    }),
    JSON.stringify({ type: "user", sessionId: "s", message: { content: [{ type: "tool_result" }] } }),
  ])("%s", (line) => {
    expect(() => parseLine(line)).not.toThrow();
    expect(parseLine(line).events).toEqual([]);
  });

  it("skips a pull request line with no number or a non-https link, and an empty title", () => {
    expect(parseLine(JSON.stringify({ type: "pr-link", sessionId: "s", prUrl: "https://x/1" })).skipped).toBe(1);
    expect(
      parseLine(JSON.stringify({ type: "pr-link", sessionId: "s", prNumber: 2, prUrl: "javascript:alert(1)" })).skipped,
    ).toBe(1);
    expect(parseLine(JSON.stringify({ type: "ai-title", sessionId: "s", aiTitle: "" })).events).toEqual([]);
  });

  it("skips a line too big to be worth reading", () => {
    expect(parseLine(`{"type":"user","sessionId":"s","x":"${"a".repeat(2_000_001)}"}`).skipped).toBe(1);
  });

  it("announces a session once, and again only when its branch changes", () => {
    const at = (branch: string) =>
      JSON.stringify({ type: "user", sessionId: "s", cwd: "/work/app", gitBranch: branch, message: { content: "hi" } });
    const seen = parseLog([at("a"), at("a"), at("a"), at("b")].join("\n")).events.filter(
      (e) => e.kind === "session.seen",
    );
    expect(seen.map((e) => (e.kind === "session.seen" ? e.branch : ""))).toEqual(["a", "b"]);
  });
});
