// Copied from board-kit commit 0c60024, src/contract.ts (whole file: board-kit-contract.txt). The contract wins:
// test/desks.test.ts fails when these types stop matching that copy. The sample is the shape a pipeline sends.
export type AgentState = "working" | "waits" | "done" | "idle";

export type Agent = {
  id: string;
  title: string;
  role?: string;
  ticket?: string;
  project?: string;
  model?: string;
  state?: AgentState;
  stage?: number;
  steps?: string[];
  stepCount?: number;
  costUsd?: number | null;
  minutes?: number;
  action?: "answer" | "approve";
  finishedAt?: string;
  idleMinutes?: number;
};

export type Agents = { list?: Agent[]; doneToday?: number; stepsPerHour?: number };

export const AGENTS_SAMPLE: Agents = {
  list: [
    {
      id: "a-1",
      title: "Add a coupon field",
      role: "builder",
      ticket: "R-66",
      project: "shop-app",
      model: "claude-opus-5-5",
      state: "waits",
      stage: 2,
      steps: ["Reading src/coupon.ts", "Writing src/coupon.ts", "Running npm run ci"],
      stepCount: 41,
      costUsd: null,
      minutes: 12,
      action: "answer",
    },
    { id: "a-2", title: "Docs", state: "done", costUsd: 1.2, finishedAt: "10:49" },
    { id: "a-3", title: "Quiet one", state: "idle", idleMinutes: 25 },
  ],
  doneToday: 3,
  stepsPerHour: 40,
};
