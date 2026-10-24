// The parser layer: a Claude Code log line -> Night Shift events. Pure; no file system, no network.
export type { NightEvent, ParseResult } from "./events.js";
export { parseLine, parseLog } from "./line.js";
export { toolSummary } from "./summary.js";
