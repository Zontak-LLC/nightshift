# Night Shift

A live screen for Claude Code agents. Read `docs/SPEC.md` (what and why) and `docs/decisions.md` (the decision tree)
before changing anything; update both in the same commit when a choice changes.

## Layout (the layers only point one way: watcher -> parser -> store -> server -> web)

- `src/parser/`: a Claude Code log line -> a Night Shift event. Pure functions; no file system, no network.
- `src/watcher/`: follows the log folders and hands new lines to the parser. Read only.
- `src/store/`: SQLite history and the current state. The ONLY place that writes to disk.
- `src/server/`: `/events` (Server-Sent Events) and `/state`, on localhost only.
- `src/web/`: the page. Plain TypeScript and CSS, no framework.
- `src/cli.ts` wires them together; `test/` holds the scenario tests and `test/fixtures/` real-shaped sample logs.

## Rules (checked by `npm run ci`, which CI runs on every push)

- `scripts/check-rules.mjs`: no `@ts-ignore`, TODO needs a ticket (`TODO(#12)`), no personal paths, no `.only`, no
  eval, only `src/store/` writes to disk, files under 300 lines. Exempt a line with `rules-ok: <reason>`.
- `test/architecture.test.ts`: the layer rule above, and the parser never imports fs or the network.
- Biome (no `any`, no `!`, complexity 20, no unused code), strict TypeScript, coverage floor in `vitest.config.ts`
  (only ever raise it).
- Tests are scenarios (a developer does X, the screen shows Y), fed with real-shaped logs.
- A fresh reviewer reads each diff before it is committed. One ticket per evening, one visible win.
- Node 22 or newer. Commands: `npm run ci`, `npm run dev`, `npm test`.
