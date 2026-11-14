// Typed copy of Day Shift's `GET /api/agents` contract (Zontak-LLC/nightshift issue #14; the whole text is in
// day-shift-agents-contract.txt). The contract wins: test/day-shift-agents.test.ts fails when Lens's type or this
// sample stops matching it.
export type Agent = {
  role: string;
  worksOn: string;
  startedAt: string | null;
  limitMinutes: number | null;
};

export type Agents = { agents: Agent[] };

/** The example from the issue, as written there. */
export const AGENTS_SAMPLE: Agents = {
  agents: [
    { role: "watcher", worksOn: "usehourly logs", startedAt: "2026-10-25T03:10:00Z", limitMinutes: 30 },
    { role: "fixer", worksOn: "loader incident 12", startedAt: "2026-10-25T03:20:00Z", limitMinutes: null },
  ],
};

/** The contract's rules for each entry: text 1–200 characters, a whole limit 1–600 or null, at most 20 entries. */
export const MAX_TEXT = 200;
export const LIMIT = { min: 1, max: 600 };
export const MAX_AGENTS = 20;
