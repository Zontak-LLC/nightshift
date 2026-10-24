import type { NightEvent } from "./events.js";
import { redact } from "./redact.js";

/**
 * A line Claude Code writes when the API refused or broke off (`isApiErrorMessage: true`): the usage limit, a lost
 * connection or sleep, an expired login. Read from the structured fields first (`error`, `quotaLimits.resetsAt`), the
 * sentence only for the person reading the board. Learned from real logs on 2026-10-24 (see docs/decisions.md).
 */
export type TroubleReason = "usage_limit" | "connection" | "login" | "api";

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);

const REASONS: Record<string, TroubleReason> = {
  rate_limit: "usage_limit",
  server_error: "connection",
  authentication_failed: "login",
};

/** The reset time, as an ISO date, from either place Claude Code puts it (Unix seconds). */
function resetsAtOf(raw: Raw): string | null {
  const quota = obj(raw.quotaLimits);
  const info = obj(obj(raw.apiErrorParams)?.rate_limit_info);
  const seconds = [quota?.resetsAt, info?.resetsAt].find((v) => typeof v === "number" && Number.isFinite(v));
  if (typeof seconds !== "number" || seconds <= 0 || seconds > 1e11) return null;
  return new Date(seconds * 1000).toISOString();
}

function textOf(raw: Raw): string {
  const content = obj(raw.message)?.content;
  const parts = Array.isArray(content) ? content.map((b) => str(obj(b)?.text)) : [str(content)];
  return redact(parts.join(" ").replace(/\s+/g, " ").trim()).slice(0, 200);
}

/** The trouble this line reports, or null when it is not an API error line. */
export function troubleOf(raw: Raw, at: string, sessionId: string): NightEvent | null {
  if (raw.isApiErrorMessage !== true) return null;
  const quota = obj(raw.quotaLimits);
  return {
    kind: "session.trouble",
    at,
    sessionId,
    reason: REASONS[str(raw.error)] ?? "api",
    resetsAt: resetsAtOf(raw),
    limitType: str(quota?.rateLimitType).slice(0, 40) || null,
    text: textOf(raw),
  };
}
