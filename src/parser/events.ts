/**
 * Night Shift's own events: what one Claude Code log line means, in a small, stable shape the rest of the app uses.
 * The raw log format belongs to Claude Code and can change; only the parser knows it.
 */
/** `agentId` is set on steps a subagent took (a workflow's ticket agent), so its steps can be told from the main thread's. */
export type Base = { at: string; sessionId: string; agentId?: string };

export type NightEvent =
  | (Base & { kind: "session.seen"; cwd: string; branch: string | null })
  | (Base & { kind: "session.title"; title: string })
  | (Base & { kind: "prompt"; text: string })
  | (Base & { kind: "tool.use"; toolUseId: string; tool: string; summary: string; paths?: string[] })
  | (Base & { kind: "tool.result"; toolUseId: string; ok: boolean })
  | (Base & { kind: "reply"; text: string })
  /** A background agent's task: the first line of the prompt it was given. */
  | (Base & { kind: "agent.task"; text: string })
  /** A background agent's name, from the small file Claude Code keeps beside its log. */
  | (Base & { kind: "agent.title"; title: string })
  /** An agent's turn ended with an answer (not a tool call): it is done until its next step. */
  | (Base & { kind: "turn.end" })
  | (Base & { kind: "pr.link"; number: number; url: string })
  /** The tokens one assistant message used, and its model; the same `messageId` again replaces it (parser/usage.ts). */
  | (Base & {
      kind: "turn.usage";
      messageId: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    })
  /** The API refused or broke off: a usage limit (with its reset time), a lost connection, an expired login. */
  | (Base & {
      kind: "session.trouble";
      reason: "usage_limit" | "connection" | "login" | "api";
      resetsAt: string | null;
      limitType: string | null;
      text: string;
    });

export type ParseResult = { events: NightEvent[]; skipped: number };
