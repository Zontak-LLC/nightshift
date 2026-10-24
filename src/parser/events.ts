/**
 * Night Shift's own events: what one Claude Code log line means, in a small, stable shape the rest of the app uses.
 * The raw log format belongs to Claude Code and can change; only the parser knows it.
 */
export type Base = { at: string; sessionId: string };

export type NightEvent =
  | (Base & { kind: "session.seen"; cwd: string; branch: string | null })
  | (Base & { kind: "session.title"; title: string })
  | (Base & { kind: "prompt"; text: string })
  | (Base & { kind: "tool.use"; toolUseId: string; tool: string; summary: string })
  | (Base & { kind: "tool.result"; toolUseId: string; ok: boolean })
  | (Base & { kind: "reply"; text: string })
  | (Base & { kind: "pr.link"; number: number; url: string });

export type ParseResult = { events: NightEvent[]; skipped: number };
