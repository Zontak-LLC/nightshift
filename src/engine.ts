// The engine: the watcher feeding the history and the board. The CLI adds the server and the terminal on top.
import type { NightEvent, RunEvent } from "./parser/index.js";
import { Board, DEFAULT_KEEP_DAYS, History } from "./store/index.js";
import { watchLogs } from "./watcher/index.js";

export type EngineOptions = {
  /** Claude Code's projects folder. */
  root: string;
  /** The SQLite file, or ":memory:". */
  dbPath: string;
  keepDays?: number;
  everyMs?: number;
  /** A new event (never one seen before, never one replayed from the history). */
  onNew?: (event: NightEvent | RunEvent) => void;
  onError?: (error: unknown) => void;
};
export type Engine = { board: Board; history: History; stop: () => void };

const HOUR_MS = 3_600_000;

/**
 * Opens the history, rebuilds the board from it, then follows the logs on from where each file was left. A database
 * that cannot be opened (damaged, no rights) is reported and the board runs without a history rather than not at all.
 */
export function startEngine(options: EngineOptions): Engine {
  const { root, dbPath, keepDays = DEFAULT_KEEP_DAYS, everyMs, onNew, onError } = options;
  let history: History;
  try {
    history = new History(dbPath);
  } catch (error) {
    onError?.(
      new Error(`history unavailable (${error instanceof Error ? error.message : String(error)}); running without it`),
    );
    history = new History(":memory:");
  }
  const board = new Board();
  history.replay((event) => board.apply(event));
  history.prune(keepDays);
  const take = (event: NightEvent | RunEvent, key: string) => {
    if (!history.add(event, key)) return; // read before: the board already has it
    board.apply(event);
    onNew?.(event);
  };
  const stopWatching = watchLogs({
    root,
    ...(everyMs ? { everyMs } : {}),
    onEvent: (event, origin) => take(event, origin.key),
    onRun: (event, origin) => take(event, origin.key),
    resume: (path) => history.file(path),
    onRead: (path, mark) => history.saveFile(path, mark),
    ...(onError ? { onError } : {}),
  });
  const pruner = setInterval(() => history.prune(keepDays), HOUR_MS);
  pruner.unref();
  return {
    board,
    history,
    stop: () => {
      stopWatching();
      clearInterval(pruner);
      history.close();
    },
  };
}
