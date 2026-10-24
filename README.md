# Night Shift

A live screen for your Claude Code agents: what they are doing right now, and what they did overnight.

Night Shift runs on your own computer and only **reads** Claude Code's log files. It has no accounts, no server and no
telemetry: nothing leaves your computer.

> Status: early. Ticket 1 of the first week (the frame and the checks). See [docs/SPEC.md](docs/SPEC.md).

## Try it

```bash
npx nightshift --help
```

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
