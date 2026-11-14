import type { Desk, Seated } from "./desks.js";

/**
 * Forge's Agents tile (Forge was Day Shift; Zontak-LLC/nightshift issue #14, copied to
 * test/fixtures/day-shift-agents-contract.txt): `GET /api/agents` lists the running agents in Forge's own shape. This
 * file is the only place that knows it.
 */
export type DayShiftAgent = {
  role: string;
  worksOn: string;
  startedAt: string | null;
  limitMinutes: number | null;
};
export type DayShiftAgents = { agents: DayShiftAgent[] };

/** Forge keeps at most 20 agents. */
const KEPT = 20;
/** `role` and `worksOn` are at most 200 characters each. */
const MAX_TEXT = 200;
/**
 * Minutes before Forge marks a pipeline agent stuck: long checks like `npm run ci` are normal for them (the owner's
 * decision, see decisions.md). Main sessions and background agents send null, so Forge's own 15 minutes apply.
 */
const PIPELINE_LIMIT_MINUTES = 30;

/** Single spaces, at most 200 characters (cut last, never inside a character pair), never empty. */
function shortText(text: string, empty: string): string {
  const cut = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT)
    .replace(/[\uD800-\uDBFF]$/, "");
  return cut || empty;
}

/** `<project>: <ticket> <title>`. The desk's title already shows the home folder as `~`. */
const worksOnOf = (d: Desk) => shortText(`${d.project ?? ""}: ${d.ticket ? `${d.ticket} ` : ""}${d.title}`, "agent");

function isoOrNull(at: string): string | null {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The running desks (working or waiting) in `seatedOf`'s order, idle ones dropped before the cut to 20. */
export function runningAgents(seated: Seated[]): DayShiftAgents {
  const running = seated.filter((s) => s.desk.state === "working" || s.desk.state === "waits").slice(0, KEPT);
  return {
    agents: running.map(({ desk, lastAt }) => ({
      role: shortText(desk.role ?? "", "agent"),
      worksOn: worksOnOf(desk),
      startedAt: isoOrNull(lastAt),
      limitMinutes: desk.role === "pipeline agent" ? PIPELINE_LIMIT_MINUTES : null,
    })),
  };
}
