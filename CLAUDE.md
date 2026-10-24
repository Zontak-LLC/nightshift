# Night Shift

A live screen for Claude Code agents. Read `docs/SPEC.md` (what and why) and `docs/decisions.md` (the decision tree)
before changing anything; update both in the same commit when a choice changes.

## Layout (the layers only point one way: watcher -> parser -> store -> server -> web)

- `src/parser/`: a Claude Code log line -> a Night Shift event. Pure functions; no file system, no network.
- `src/watcher/`: follows the log folders and hands new lines to the parser. Read only. Polls once a second
  (`tail.ts` works in BYTES and decodes only whole lines, so a read that ends inside a character never corrupts it;
  `follow.ts` walks `<root>/<project>/*.jsonl` and starts over when a file is replaced (new inode) or shrinks).
  On start, files quiet for 10 minutes are followed from their end (old history is not "now"); recent ones are read
  (the last 256 KB of a big one); a file that appears later is read from its start.
- `src/store/`: the board (state from events) and `history.ts`, the SQLite history (`node:sqlite`): every event under a
  key `<file>#<inode>.<epoch>@<line end>.<n>` (`INSERT OR IGNORE`, so a line read twice is stored once and not
  applied twice), plus each file's saved offset. The ONLY place that writes to disk. `src/engine.ts` wires it: replay
  the stored events into the `Board`, prune (30 days, whole sessions, hourly), then `watchLogs` with `resume` and `onRead`.
  A file that was replaced (new inode) or cut short gets a new `epoch`, so its lines are new, not repeats.
- `src/server/`: `/events` (Server-Sent Events, one `event: <kind>` frame per event), `/health`, later `/state`; binds
  127.0.0.1 only and answers only a `Host` of `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), no CORS;
  a page that stops reading is dropped past 1 MB waiting. `res.write()` there is a network write, which the
  disk-write rule allows. The terminal view prints control characters from logs as `�` (no escape injection).
- `src/web/`: the page, sent as text by the server (`page.ts`, `style.ts`; one script = `client-start.ts` + `shift.ts`
  (pure arithmetic, tested, sent as its own source) + `client-board.ts` + `client-end.ts`). Tabs: Board, Terminal, Timeline. It asks the server for nothing: `/events?project=<name>` pushes the whole board (`event: board`), `?project=`
  the project list. Every value from the logs is set with `textContent`. No web fonts or other outside loads.
- Pipelines: the watcher also follows `<session>/subagents/workflows/<run>/journal.jsonl` (read whole: the run's ticket
  list, parsed by `parser/journal.ts`) and each `agent-*.jsonl` (its steps carry `agentId`). `store/board.ts` (`Board`)
  turns them into stations: a checking step (`npm run ci`, playwright, ...) means Checking; a result means Done or
  Skipped (`skipped`, `blocked`, ...). The CLI adds the repo name (`store/repo.ts`, from `.git/config`) and shows the
  home folder as `~`.
- Background agents (ticket 7): the watcher also follows `<session>/subagents/agent-*.jsonl` and reads each
  `agent-*.meta.json` (its description; `parseAgentMeta`). The parser adds `paths` to `tool.use` (`parser/paths.ts`),
  `agent.task`, `agent.title` and `turn.end`. `store/workers.ts` keeps one worker per agent id that is not a pipeline
  agent and files it by the repository most of its paths belong to (`store/root.ts`, worktree = its main repo); `Board`
  exposes `view().agents`, `projects()[].agents` and `agentLabel()` (the terminal's tag). See decisions.md.
- Projects everywhere (ticket 8): `store/places.ts` files each main-session step by the repositories its paths belong to
  (a session shows on every repo it works in); `store/pinned.ts` reads `~/.nightshift/projects.json` and builds the start
  page tiles (pinned always, recent repos under `~/Projects` added, idle dimmer). See decisions.md.
- Trouble (ticket 5): `parser/trouble.ts` turns Claude Code's `isApiErrorMessage` lines into `session.trouble` (reason,
  `resetsAt`, limit type); the board keeps it on the session or the agent's ticket until the next real step and lists it
  as `alerts` in the view; the page's NOW strip shows the newest one in amber; a late step of a finished ticket only fills in its times.
- Usage meter: `src/meter.ts` reads `~/.claude/usage-now.json` (`parseMeter`, `startMeter` polls every 30 s; read
  only); the CLI adds it to each board payload as `meter`; `meterView` in `web/shift.ts` (tested, sent to the page)
  makes the segments, levels (amber 75, red 90) and the stale flag (15 min); `server.refresh()` re-pushes every 30 s.
- Night Watch link: `src/watch/` follows the sister project's `/events` (read only, localhost only, reconnects; `model.ts` reads its state defensively) and `view.ts` builds the board/tile payload; `store/pinned.ts` maps a project to a site (`watchSite`); the page parts are `web/client-watch.ts` and the tested `web/watch-view.ts`. See decisions.md.
- `src/cli.ts` wires them together (`src/terminal.ts` is the terminal view: one line per step, titles and pull
  requests printed once per session, local time); `test/` holds the scenario tests and `test/fixtures/` real-shaped sample logs.

## Rules (checked by `npm run ci`, which CI runs on every push)

- `scripts/check-rules.mjs`: no `@ts-ignore`, TODO needs a ticket (`TODO(#12)`), no personal paths, no `.only`, no
  eval, only `src/store/` writes to disk, files under 300 lines. Exempt a line with `rules-ok: <reason>`.
- `test/architecture.test.ts`: the layer rule above, and the parser never imports fs or the network.
- Biome (no `any`, no `!`, complexity 20, no unused code), strict TypeScript, coverage floor in `vitest.config.ts`
  (only ever raise it).
- Tests are scenarios (a developer does X, the screen shows Y), fed with real-shaped logs.
- A fresh reviewer reads each diff before it is committed. One ticket per evening, one visible win.
- Node 22 or newer. Commands: `npm run ci`, `npm run dev`, `npm test`.
