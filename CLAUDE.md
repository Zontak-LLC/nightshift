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
- `src/store/`: SQLite history and the current state. The ONLY place that writes to disk.
- `src/server/`: `/events` (Server-Sent Events, one `event: <kind>` frame per event), `/health`, later `/state`; binds
  127.0.0.1 only and answers only a `Host` of `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), no CORS;
  a page that stops reading is dropped past 1 MB waiting. `res.write()` there is a network write, which the
  disk-write rule allows. The terminal view prints control characters from logs as `�` (no escape injection).
- `src/web/`: the page, sent as text by the server (`page.ts`, `style.ts`, `client-start.ts` + `client-end.ts` = one
  script). It asks the server for nothing: `/events?project=<name>` pushes the whole board (`event: board`), `?project=`
  the project list. Every value from the logs is set with `textContent`. No web fonts or other outside loads.
- Pipelines: the watcher also follows `<session>/subagents/workflows/<run>/journal.jsonl` (read whole: the run's ticket
  list, parsed by `parser/journal.ts`) and each `agent-*.jsonl` (its steps carry `agentId`). `store/board.ts` (`Board`)
  turns them into stations: a checking step (`npm run ci`, playwright, ...) means Checking; a result means Done or
  Skipped (`skipped`, `blocked`, ...). The CLI adds the repo name (`store/repo.ts`, from `.git/config`) and shows the
  home folder as `~`.
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
