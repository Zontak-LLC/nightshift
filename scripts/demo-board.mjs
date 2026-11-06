// Starts Lens on invented demo data, for the README screenshot: `node scripts/demo-board.mjs`, then open
// http://localhost:4400 (or NIGHTSHIFT_PORT). It never reads ~/.claude: the logs are copies of test/fixtures (the
// projects "demo-app" and "shop-app", under /work) with their times moved into the last hour so the board looks alive,
// in temporary NIGHTSHIFT_LOGS and NIGHTSHIFT_DATA folders that are removed when it stops (Ctrl-C).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const FIXTURES = join(REPO, "test", "fixtures");
const STAMP = /"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g;
const base = mkdtempSync(join(tmpdir(), "lens-demo-"));
const logs = join(base, "logs");
const data = join(base, "data");

/** Copies a group of fixtures, moving every time in them by one offset so the group's newest time is `endsAgoMs` ago. */
function copyShifted(files, endsAgoMs) {
  const texts = files.map(([from]) => readFileSync(join(FIXTURES, from), "utf8"));
  const newest = Math.max(...texts.flatMap((t) => [...t.matchAll(STAMP)].map((m) => Date.parse(m[1]))));
  const offset = Date.now() - endsAgoMs - newest;
  files.forEach(([, to], i) => {
    mkdirSync(join(logs, to, ".."), { recursive: true });
    const text = texts[i].replace(STAMP, (_, at) => `"${new Date(Date.parse(at) + offset).toISOString()}"`);
    writeFileSync(join(logs, to), text);
  });
}

copyShifted([["session-basic.jsonl", "-work-demo-app/s-demo-1.jsonl"]], 12 * 60_000);
const sub = "-work-shop-app/s-desk-1/subagents";
copyShifted(
  [
    ["desks/session.jsonl", "-work-shop-app/s-desk-1.jsonl"],
    ["desks/agent-bg1.jsonl", `${sub}/agent-bg1.jsonl`],
    ["desks/agent-bg1.meta.json", `${sub}/agent-bg1.meta.json`],
    ["desks/journal.jsonl", `${sub}/workflows/run-1/journal.jsonl`],
    ["desks/agent-pipe7.jsonl", `${sub}/workflows/run-1/agent-pipe7.jsonl`],
  ],
  60_000,
);
mkdirSync(data, { recursive: true });
const pinned = [
  { path: "/work/demo-app", name: "Demo App" },
  { path: "/work/shop-app", name: "Shop App" },
];
writeFileSync(join(data, "projects.json"), `${JSON.stringify(pinned, null, 2)}\n`);
const usage = join(base, "usage-now.json");
const resetsAt = Math.round(Date.now() / 1000) + 2 * 3600;
const meter = { five_hour: 31, seven_day: 52, five_hour_resets_at: resetsAt, updated: new Date().toISOString() };
writeFileSync(usage, JSON.stringify(meter));

const lens = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "cli.ts")], {
  cwd: REPO,
  stdio: "inherit",
  env: { ...process.env, NIGHTSHIFT_LOGS: logs, NIGHTSHIFT_DATA: data, NIGHTSHIFT_USAGE: usage },
});
const cleanUp = () => rmSync(base, { recursive: true, force: true });
lens.on("exit", (code) => {
  cleanUp();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => lens.kill(signal));
