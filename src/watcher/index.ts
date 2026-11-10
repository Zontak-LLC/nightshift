// The watcher layer: follows Claude Code's session logs (read only) and hands each new line to the parser.

export { type LogFile, logFiles, newestChange } from "./files.js";
export { type FileMark, type Origin, type WatchOptions, watchLogs } from "./follow.js";
export { type Health, healthOf, STALE_MS, watchdog } from "./health.js";
export { advance, START, startAt, type TailState } from "./tail.js";
