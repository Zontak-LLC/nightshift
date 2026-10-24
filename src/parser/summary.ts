import { basename, relative } from "node:path";
import { redact } from "./redact.js";

type Input = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const short = (s: string, max = 72): string => {
  const one = redact(s).replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
/** A path as a person reads it: relative to the session's folder when it is inside it, else just the file name. */
const showPath = (p: string, cwd: string): string => {
  if (!p) return "";
  if (!cwd) return basename(p); // without the session's folder, never resolve against Night Shift's own folder
  const rel = relative(cwd, p);
  return rel && !rel.startsWith("..") ? rel : basename(p);
};

/** The program a command runs ("npm run ci", "git push", "curl"), never the arguments after it. */
const program = (command: string): string => {
  const words = command
    .trim()
    .split(/\s+/)
    .filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));
  const [first = "", second = ""] = words;
  return ["npm", "npx", "git", "gh", "pnpm", "yarn", "bun", "node", "python3", "make"].includes(first) &&
    /^[a-z][\w:.-]*$/.test(second)
    ? `${first} ${second}${/^(run|exec)$/.test(second) && words[2] && /^[a-z][\w:.-]*$/.test(words[2]) ? ` ${words[2]}` : ""}`
    : first;
};

const PATH_TOOLS: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  Write: "Writing",
  NotebookEdit: "Editing",
};

/** One short line saying what a tool call is doing, the way the "Now" row shows it ("Editing src/lib/x.ts"). */
export function toolSummary(tool: string, input: Input, cwd: string): string {
  const verb = PATH_TOOLS[tool];
  if (verb) return `${verb} ${showPath(text(input.file_path) || text(input.notebook_path), cwd)}`.trim();
  if (tool === "Bash" || tool === "bash")
    return short(
      text(input.description) ||
        `Running ${program(text(input.command).replace(/^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/, ""))}`,
    );
  if (tool === "Grep" || tool === "Glob") return short(`Searching for ${text(input.pattern)}`);
  if (tool === "Agent" || tool === "Task") return short(`Agent: ${text(input.description) || "working"}`);
  if (tool === "WebSearch") return short(`Searching the web: ${text(input.query)}`);
  if (tool === "WebFetch") return short(`Reading ${text(input.url)}`); // redact() drops the query string
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp)
    return `${(mcp[1] ?? "").replace(/^claude_ai_|^plugin_[^_]+_/, "").replace(/[-_]/g, " ")}: ${(mcp[2] ?? "").replace(/[-_]/g, " ")}`;
  return tool;
}
