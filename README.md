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

Settings: `NIGHTSHIFT_PORT` (default 4400), `NIGHTSHIFT_LOGS` (default `~/.claude/projects`), `NIGHTSHIFT_DATA`
(where the history is kept, default `~/.nightshift`) and `NIGHTSHIFT_KEEP_DAYS` (default 30). The service listens
on 127.0.0.1 only.

## Usage meter

The header shows two small meters read from `~/.claude/usage-now.json` (change the place with `NIGHTSHIFT_USAGE`),
looked at every 30 seconds: `5 h  31% · resets 06:40` and `Week 52%`, ten segments each, amber from 75% and red from
90%. They turn grey and say "stale" when the file is older than 15 minutes, and they are hidden when the file is
missing. The file is `{"five_hour": 31, "seven_day": 52, "five_hour_resets_at": <unix seconds>, "updated": "<ISO time>"}`.
Times show in the browser's local time.

## History

Night Shift keeps what it saw in one SQLite file (`~/.nightshift/nightshift.db`). Stop and start it: the board comes
back as it was, each log file is read on from where it stopped (a file that was replaced or cut short is read again from
its top), and no step is shown or stored twice. Sessions that have been quiet for more than 30 days are removed, once an
hour. The file holds your prompts' first lines and tool summaries: it stays on your computer, and the folder is private
to you.

## Run it in the background

```bash
nohup npx tsx src/cli.ts > /tmp/nightshift.log 2>&1 &    # start (from this folder)
curl -s localhost:4400/health                              # {"ok":true}
pkill -f "tsx src/cli.ts"                                  # stop (it saves its place and closes the file)
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

## Background agents

Claude Code runs helpers ("subagents") in the background. Night Shift follows their logs too
(`<session>/subagents/agent-*.jsonl`, with the name from `agent-*.meta.json`). Each helper is filed under the project
it **really works in**, not the folder its parent session started in: the git repository most of its tool calls touch
(`cd`, `git -C`, file paths). A linked worktree counts as its main repository and is marked "(worktree)". With no
clear repository it stays under its parent's project. The board shows them under the line, the NOW strip says
"3 agents working", the Terminal tab streams their steps tagged with the agent's name, and the Timeline draws a bar
for each. The start page lists projects that only helpers touched.

### Projects

A session is filed by where its steps work, not only by the folder it started in: a session started in `usehourly` that edits files in `magsmith` shows on the `magsmith` board too (steps split per repository; a step that names no folder stays at home). The start page shows a fixed list from `~/.nightshift/projects.json`, created on first run:

```json
[{ "path": "~/Projects/magsmith", "name": "Loader" }, { "path": "~/Projects/usehourly", "name": "UseHourly" }]
```

`name` is what the tile and the board title say; the board address uses the folder name. Idle projects stay on the page, dimmer. Git repos directly under `~/Projects` with Claude activity in the last 30 days are added by themselves; add `{ "path": "~/Projects/x", "hide": true }` to remove one. A damaged file falls back to the defaults and says so in the log.

MIT licence.
