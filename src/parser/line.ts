import type { NightEvent, ParseResult } from "./events.js";
import { pathsOf } from "./paths.js";
import { redact } from "./redact.js";
import { toolSummary } from "./summary.js";
import { troubleOf } from "./trouble.js";
import { usageOf } from "./usage.js";

type Raw = Record<string, unknown>;
type Block = Record<string, unknown>;

/** A line bigger than this is a huge tool result nobody watches; skip it rather than parse megabytes. */
export const MAX_LINE = 2_000_000;
/** Claude Code's own bookkeeping lines: nothing a person watching needs to see. */
const QUIET = new Set([
  "attachment",
  "mode",
  "last-prompt",
  "atis-latch",
  "frame-link",
  "queue-operation",
  "file-history-snapshot",
  "system",
]);
/** User "messages" that are really slash commands, their output or system notes, not something the person asked. */
const NOT_A_PROMPT = /^\s*<(command-|local-command-|system-reminder|task-notification|user-prompt-submit)/;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const blocks = (raw: Raw): Block[] => {
  const content = (raw.message as Raw | undefined)?.content;
  return Array.isArray(content)
    ? content.filter((b): b is Block => !!b && typeof b === "object" && !Array.isArray(b))
    : [];
};
const firstLine = (s: string, max = 120): string => {
  const one = redact(s).replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
const promptOf = (text: string): string | null => (text.trim() && !NOT_A_PROMPT.test(text) ? firstLine(text) : null);

function assistantEvents(raw: Raw, at: string, sessionId: string): NightEvent[] {
  const cwd = str(raw.cwd);
  const out: NightEvent[] = [];
  for (const b of blocks(raw)) {
    const id = str(b.id);
    const name = str(b.name);
    const input = b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {};
    if (b.type === "tool_use" && id && name)
      out.push({
        kind: "tool.use",
        at,
        sessionId,
        toolUseId: id,
        tool: name,
        summary: toolSummary(name, input, cwd),
        paths: pathsOf(name, input, cwd),
      });
    else if (b.type === "text" && str(b.text).trim())
      out.push({ kind: "reply", at, sessionId, text: firstLine(str(b.text)) });
  }
  const usage = usageOf(raw, at, sessionId);
  return usage ? [...out, usage] : out;
}

function userEvents(raw: Raw, at: string, sessionId: string): NightEvent[] {
  if (raw.isMeta === true) return [];
  const content = (raw.message as Raw | undefined)?.content;
  if (typeof content === "string") {
    const text = promptOf(content);
    return text ? [{ kind: "prompt", at, sessionId, text }] : [];
  }
  const out: NightEvent[] = [];
  for (const b of blocks(raw)) {
    const toolUseId = str(b.tool_use_id);
    if (b.type === "tool_result" && toolUseId)
      out.push({ kind: "tool.result", at, sessionId, toolUseId, ok: b.is_error !== true });
    else if (b.type === "text") {
      const text = promptOf(str(b.text));
      if (text) out.push({ kind: "prompt", at, sessionId, text });
    }
  }
  return out;
}

function metaEvent(raw: Raw, type: string, at: string, sessionId: string): ParseResult {
  if (type === "ai-title") {
    const title = firstLine(str(raw.aiTitle), 80);
    return title
      ? { events: [{ kind: "session.title", at, sessionId, title }], skipped: 0 }
      : { events: [], skipped: 0 };
  }
  const number = Number(raw.prNumber);
  const url = str(raw.prUrl);
  return Number.isInteger(number) && number > 0 && url.startsWith("https://")
    ? { events: [{ kind: "pr.link", at, sessionId, number, url }], skipped: 0 }
    : { events: [], skipped: 1 };
}

function read(line: string): Raw | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Raw) : null;
  } catch {
    return null;
  }
}

/** One Claude Code log line → the Night Shift events it means. Never throws: a bad line is reported as skipped. */
export function parseLine(line: string): ParseResult {
  if (!line.trim()) return { events: [], skipped: 0 };
  const raw = line.length > MAX_LINE ? null : read(line);
  if (!raw) return { events: [], skipped: 1 };
  const type = str(raw.type);
  const sessionId = str(raw.sessionId);
  const at = str(raw.timestamp);
  if (QUIET.has(type)) return { events: [], skipped: 0 };
  if (!sessionId) return { events: [], skipped: 1 };
  if (type === "ai-title" || type === "pr-link") return metaEvent(raw, type, at, sessionId);
  if (type !== "assistant" && type !== "user") return { events: [], skipped: 1 };
  // A subagent's own conversation (a "sidechain") is not the session's main thread: its steps show; its prompt
  // becomes the agent's task (a name for it), never a prompt of the session.
  const seen: NightEvent[] = raw.cwd
    ? [{ kind: "session.seen", at, sessionId, cwd: str(raw.cwd), branch: str(raw.gitBranch) || null }]
    : [];
  // An API error line is trouble to show (the usage limit and its reset time), not a reply.
  const trouble = type === "assistant" ? troubleOf(raw, at, sessionId) : null;
  const rest = trouble
    ? [trouble]
    : type === "assistant"
      ? assistantEvents(raw, at, sessionId)
      : userEvents(raw, at, sessionId);
  const side = raw.isSidechain === true;
  const events = side ? rest.map((e) => (e.kind === "prompt" ? { ...e, kind: "agent.task" as const } : e)) : rest;
  if (side && type === "assistant" && (raw.message as Raw | undefined)?.stop_reason === "end_turn" && !trouble)
    events.push({ kind: "turn.end", at, sessionId });
  const agentId = str(raw.agentId);
  const all = [...seen, ...events];
  return { events: agentId ? all.map((e) => ({ ...e, agentId })) : all, skipped: 0 };
}

/**
 * A whole log file's text → its events in order, and how many lines could not be read. "session.seen" is kept only when
 * the folder or branch changes, so a session is announced once, not on every line.
 */
export function parseLog(text: string): ParseResult {
  const events: NightEvent[] = [];
  const lastPlace = new Map<string, string>();
  let skipped = 0;
  for (const line of text.split("\n")) {
    const r = parseLine(line);
    skipped += r.skipped;
    for (const e of r.events) {
      if (e.kind === "session.seen") {
        const place = `${e.cwd}|${e.branch ?? ""}`;
        if (lastPlace.get(e.sessionId) === place) continue;
        lastPlace.set(e.sessionId, place);
      }
      events.push(e);
    }
  }
  return { events, skipped };
}

/**
 * The small `agent-<id>.meta.json` file Claude Code keeps beside a background agent's log: it holds the short
 * description the agent was started with. `null` when it has none or cannot be read.
 */
export function parseAgentMeta(text: string, sessionId: string, agentId: string): NightEvent | null {
  const raw = read(text);
  const title = firstLine(str(raw?.description), 80);
  return title ? { kind: "agent.title", at: "", sessionId, agentId, title } : null;
}
