# Night Shift

A live screen for your Claude Code agents: what they are doing right now, and what they did overnight.

Night Shift runs on your own computer and only **reads** Claude Code's log files. It has no accounts, no server and no
telemetry: nothing leaves your computer.

> Status: early. Ticket 3 of the first week: it watches your sessions live in the terminal and as a stream. The
> page comes next. See [docs/SPEC.md](docs/SPEC.md).

## Try it

```bash
npx nightshift            # watch: one line per step, from every Claude Code session on this computer
curl -N localhost:4400/events   # the same steps as a live stream (Server-Sent Events)
```

```
21:04:07  demo-app           Editing src/login.ts
21:04:12  demo-app           Running npm test
21:04:31  demo-app           ⇪ pull request #42
```

Settings: `NIGHTSHIFT_PORT` (default 4400) and `NIGHTSHIFT_LOGS` (default `~/.claude/projects`). The service listens
on 127.0.0.1 only.

## Work on it

```bash
npm install
npm run ci      # everything CI runs: rules, lint, types, tests with coverage
npm run dev     # the command, restarting on every change
```

- [docs/SPEC.md](docs/SPEC.md): what it is, what is in and out, and the scenarios that prove it.
- [docs/decisions.md](docs/decisions.md): the decision tree, every choice and why.
- [CLAUDE.md](CLAUDE.md): how the code is laid out and the rules it keeps.

MIT licence.
