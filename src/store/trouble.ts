import type { NightEvent } from "../parser/index.js";

/** Work stopped by the API: shown until the next real step clears it (ticket 5). */
export type Trouble = {
  reason: "usage_limit" | "connection" | "login" | "api";
  since: string;
  resetsAt: string | null;
  text: string;
};
/** One thing stopped, for the message line: who, why, since when, and when a usage limit resets. */
export type Alert = Trouble & { who: string };
export type TroubleEvent = Extract<NightEvent, { kind: "session.trouble" }>;

export const troubleFrom = (e: TroubleEvent): Trouble => ({
  reason: e.reason,
  since: e.at,
  resetsAt: e.resetsAt,
  text: e.text,
});

type Paused = { number: number; station: string; agentId: string | null; trouble: Trouble | null };

/**
 * An agent's trouble pauses its ticket, if the ticket is still being worked and still belongs to that agent (after a
 * restart, a late error from the earlier agent must not pause the new one's work).
 */
export function pauseTicket(t: Paused | undefined, e: TroubleEvent): boolean {
  if (!t || (t.station !== "working" && t.station !== "checking" && t.station !== "queued")) return false;
  if (t.agentId && e.agentId && t.agentId !== e.agentId) return false;
  t.trouble = troubleFrom(e);
  return true;
}

/** Everything stopped right now: the sessions' trouble and the tickets still in progress that are paused, newest first. */
export function alertsOf(
  sessions: { title: string | null; trouble: Trouble | null }[],
  tickets: Iterable<Paused>,
): Alert[] {
  const out: Alert[] = [];
  for (const s of sessions) if (s.trouble) out.push({ who: s.title ?? "Session", ...s.trouble });
  for (const t of tickets) {
    if (t.trouble && (t.station === "working" || t.station === "checking"))
      out.push({ who: `#${t.number}`, ...t.trouble });
  }
  return out.sort((a, b) => b.since.localeCompare(a.since));
}
