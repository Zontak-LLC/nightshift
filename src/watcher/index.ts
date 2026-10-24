// The watcher layer: follows Claude Code's session logs (read only) and hands each new line to the parser.

export { type FileMark, type Origin, type WatchOptions, watchLogs } from "./follow.js";
export { advance, START, startAt, type TailState } from "./tail.js";
