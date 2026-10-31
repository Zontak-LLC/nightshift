import type { NightEvent } from "./events.js";

/**
 * The tokens one assistant message used (`message.usage`) and the model that wrote it. Claude Code writes one message
 * over several lines (one per content block), each with the same `message.id` and a copy of `usage`; the store keeps
 * the last line per id, so a message counts once. Tokens only, never dollars (the owner is on a flat plan; decisions.md).
 */
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** The usage event of an assistant line, or null when it has none (an old log, a synthetic error line). */
export function usageOf(raw: Raw, at: string, sessionId: string): NightEvent | null {
  const message = obj(raw.message);
  const usage = obj(message?.usage);
  const messageId = typeof message?.id === "string" ? message.id.slice(0, 120) : "";
  const model = typeof message?.model === "string" ? message.model.slice(0, 80) : "";
  if (!usage || !messageId || !model || model.startsWith("<")) return null; // "<synthetic>": Claude Code's own notes
  return {
    kind: "turn.usage",
    at,
    sessionId,
    messageId,
    model,
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cacheReadTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
  };
}
