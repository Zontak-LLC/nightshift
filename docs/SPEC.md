# Night Shift: specification

Version 0.7 · 2026-10-24 · Owner: Denis Zontak · Status: draft, being shaped by conversation

## 1. One sentence

Night Shift is a free, open-source tool any developer runs on their own computer to see, live, what their Claude Code agents are doing right now and what they did overnight, without reading terminal logs.

## 2. Why it exists

- I do agentic programming: Claude Code works on tickets for hours, sometimes all night, often several sessions at once.
- Today the only way to know what is happening is to scroll terminal output or read raw log files. I cannot see at a glance which ticket is being worked on, what step it is at, what was finished, or what got stuck.
- The first version (built on 2026-10-23 as a private claude.ai page fed by a Python script) proved the idea: a board, a timeline and a "now working on" strip were exactly what I wanted to look at. It was polled every 30 seconds and tied to one workflow. This project makes it a real tool.
- It is also an evening hobby project. It should be fun to build and stretch me past web pages: a background service, live streaming, a local database, and later a native app.

## 3. Who it is for

- **Any developer who uses Claude Code** and lets it work for long stretches (overnight runs, several sessions at once). Each developer runs their own copy on their own computer and sees only their own work.
- **I am the first user and the only builder.** I build it for my own use first, but every choice must work for a stranger who installs it: no paths, names or settings of mine in the code.
- **No accounts and no server:** nothing to sign up for, nothing sent anywhere. Installing is one command.
- Not in version 1: a shared team view (several developers watching one board). It is an open question for later.

## 4. Rule 1: the right fit for the job

Every choice below was picked for this job, not from habit. The runner-up is named so the choice can be revisited.

| Part                  | Choice                                                                                      | Why it fits                                                                                             | Runner-up                                                   |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Background service    | Node.js 22 + TypeScript                                                                     | Good at watching files and streaming events; one language from service to screen                        | Go: leaner, but no real gain on one Mac                     |
| Live updates          | Server-Sent Events (SSE)                                                                    | Updates only flow from the service to the page, which is exactly what SSE does; simpler than WebSockets | WebSockets: two-way, not needed                             |
| History               | SQLite, one file                                                                            | Keeps every night's events, searchable, no server to run                                                | JSON files: simple but slow to search                       |
| Screen                | A local web page at `http://localhost:4400`                                                 | Opens in any browser; I already design well for the web                                                 | A menu-bar app: a later stretch                             |
| Hosting               | None: it runs on each developer's own computer                                              | Their agents and logs are there; private code and data never leave it                                   | A hosted service (needs accounts and trust; not now)        |
| Code home and install | GitHub, open source (MIT), CI on every change; published to npm so `npx nightshift` runs it | Other developers can read, trust, install and improve it                                                | A downloadable app (signing and updates are much more work) |

## 5. What it reads (the data)

- **Claude Code session logs:** one JSON-lines file per session, under `~/.claude/projects/<project-folder>/<session-id>.jsonl`. Each line is one event: a message, a tool call (read a file, edit a file, run a command), a tool result, with a timestamp, the working folder and the git branch.
- **Workflow journals:** when a multi-agent workflow runs, `.../subagents/workflows/<run-id>/journal.jsonl` records each agent: started, finished, result.
- Night Shift only **reads** these files. It never writes to them, never starts or stops an agent, and never sends anything off the Mac.

## 5b. Background agents

A session can start background agents. Their logs sit next to the session (`<session>/subagents/agent-<id>.jsonl`,
name in `agent-<id>.meta.json`). Night Shift follows them like any log. Each is a worker linked to its parent session and
filed under the project it really works in (decisions.md says how, and where it can be wrong). The board shows them
under the line, the NOW strip counts the active ones, the Terminal tab streams their steps tagged with their name, the
Timeline draws a bar each, and the start page lists projects that only helpers touched.

## 6. Version 1 scope (the MVP)

**In:**
1. **Now:** every Claude Code session active in the last 10 minutes, one row each: project, branch, what it is doing right now ("Editing src/lib/day-nav.ts", "Running npm run ci"), and how long ago. It updates live (under 2 seconds after the log changes).
2. **Session detail:** click a session to see its steps as a timeline: reads, edits, commands, test results, in order, with times.
3. **Workflow board:** when a workflow is running, its agents as cards moving through stations (queued, working, checking, done, skipped), like the 2026-10-23 assembly line.
4. **A board per project (the owner's choice, 2026-10-23):** each project has its own board at its own address
   (`http://localhost:4400/<project>`); open as many as you like, side by side in their own windows or tabs. One running
   Night Shift serves them all. **Every board says plainly which project it shows:** the GitHub repo
   (`Zontak-LLC/usehourly`, read from the project's git remote; the folder name when there is none), the folder
   (`~/Projects/usehourly`) and each session's branch, in the board's header; the browser tab is titled
   "Night Shift · usehourly" so several windows can be told apart. The start page (`http://localhost:4400/`) lists the projects with something running in
   the last 10 minutes, one click to each board; quiet projects are not listed (their runs are in History).
5. **History:** last night's runs kept in SQLite; a "Last night" view that summarises what was done: sessions, files changed, commands run, errors.
6. **One command to start, for anyone:** `npx nightshift` finds the Claude Code logs folder on its own (macOS, Linux and Windows locations), starts the service and opens the page. A first-run screen says what it found ("12 projects, 3 sessions running") and how to change it.
7. **Settings without a settings screen:** an optional `nightshift.config.json` (port, which projects to watch, which to hide) with safe defaults; the page shows where the file lives.

**Out (not in version 1, on purpose):**
- Watching GitHub pull requests and CI runs (version 2).
- Controlling agents (pausing, stopping): version 1 only watches.
- **Night run (version 2, the owner's idea, 2026-10-23):** Night Shift starts the night's work itself. **By default it
  runs all night until every ticket in the queue is done.** A developer whose account has a usage limit can set one
  (`ticketLimit` in `nightshift.config.json`, for example 5 or 10): the run then stops cleanly after that many tickets
  with a summary, and **"Start next batch"** runs the next ones. Either way, reaching the account's usage limit pauses
  the run ("Paused: usage limit") instead of failing it, and it resumes later without redoing finished tickets. Watching (version 1) comes first: a run can only be safe once it can be seen.
- Accounts, sign-in, cloud hosting, a shared team board, a phone view.
- Costs and token counts (version 2, if the logs carry them).
- The menu-bar app and the e-ink desk display (later stretches).

## 7. How it works (architecture)

```
Claude Code log files ──► Watcher ──► Parser ──► Event store (SQLite) ──► SSE stream ──► Web page
     (read only)        (file changes) (line → event)  (history + now)     (/events)     (board, timeline)
```

- **Watcher:** follows the log folders, reads only the new lines of a file that grew, survives files that are created, rotated or deleted.
- **Parser:** turns one raw log line into one Night Shift event (`session.started`, `tool.read`, `tool.edit`, `tool.command`, `tool.result`, `agent.started`, `agent.finished`, ...). Pure functions, no file access, fully tested.
- **Event store:** writes events to SQLite and keeps the current state of each session in memory.
- **Stream:** `GET /events` sends every new event to the open pages (SSE); `GET /state` returns the current state for a page that just opened.
- **Desks:** `GET /agents` (`http://127.0.0.1:4400/agents`, the port is `NIGHTSHIFT_PORT`) returns every live agent as
  JSON in board-kit's `Agents` shape (`list` of `Agent`, commit 0c60024) for Motherboard's Agents tab: role, title and
  ticket, repo, model, current step and the two before it, step count, run time and `state` (`waits` = "waits for
  you"). Read only (other methods get 405), `cache-control: no-store`, this computer only (Host check), no CORS. No
  dollar cost: `costUsd` is null. Tokens are kept per agent, but the contract has no field for them yet (decisions.md).
- **Page:** plain TypeScript and CSS (no framework needed for v1), drawn from the state plus the stream.
- **Layers only point one way:** page → stream → store → parser. The page never reads files; the parser never touches the database. An architecture test enforces it.

## 8. How it should look and feel

- **Readable for hours** (decided 2026-10-24, see `decisions.md`): dark grey-blue, soft off-white text, colour only with a
  meaning (blue live, green done, amber needs attention), sans titles and monospace machine output.
- **Laid out like the first design (the owner's pick, 2026-10-24):** a header with the status light, "Night Shift ·
  <project>", the repo, folder and branch, and the totals (done of total, merged, skipped, average ticket time,
  estimated finish, time on shift); a NOW strip (the ticket being worked on, its step and a live clock; amber with the
  trouble and its reset time when work has stopped); three tabs, remembered: **Board** (the assembly line: Queued,
  Working, Checking, Done, Skipped, each with a belt along its foot; the station at work runs its belt, stations already
  passed turn green), **Terminal** (one block per step, the running one marked) and **Timeline** (one row per hour, a
  bar per ticket, a line for now). A Key=Action line stays at the foot and the keys work (arrows move between tickets
  and stations, Enter opens, Esc closes).
- One fixed board height; a full station scrolls inside itself with "+N more"; finished cards carry a result code and
  the time they took (`MRG · 30m 00s`); a click opens the ticket in a dialog (status, summary, last steps, its pull request).
- Motion only where it explains a change (a ticket gliding to its new column, a step rolling over). Nothing loops except
  the status light's slow blink. Reduced motion turns all of it off.
- No brown, no glow, no pure black. Four colours, one meaning each: blue working, green done, amber needs you, grey queued or skipped.

## 8b. When things go wrong

The board never looks busy while nothing happens. The NOW strip turns amber and says it in words, with the next step:

| What happens                         | What the board says                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Usage limit                          | "Paused: usage limit since 21:40 · resets 22:40 (in 58 min). Nothing is lost; work continues by itself." |
| Connection lost, computer slept      | "Waiting on Claude: connection trouble since 21:40."                                                     |
| Login expired                        | "Logged out: run /login in Claude Code since 21:40."                                                     |
| A ticket with no step for 30 minutes | "Quiet since 21:40" on its card                                                                          |
| The page loses Night Shift           | The status light turns amber: "RECONNECTING…"                                                            |

A paused ticket says so on its card. Each notice clears by itself at the next real step.

## 9. How we know it works (scenarios)

Each scenario is an automated test that feeds real-shaped log lines in and checks what the page state shows.
1. **A session starts:** a new log file appears; within 2 seconds "Now" shows the project, branch and "Starting".
2. **A session works:** it reads a file, edits it, runs `npm test`; the session timeline shows Read, Edit, Command, Result in that order, with the file names and the exit status.
3. **Two projects at once:** two projects work at the same time; each board shows only its own project's sessions and
   steps, never mixed, and the start page lists both. A third project that was busy yesterday but is quiet now is not
   listed. Each board's header and tab title name its repo (or folder), so the two windows cannot be confused.
4. **A workflow runs:** a journal records 3 agents; the board shows them moving queued → working → done, and a skipped one in "skipped".
5. **A broken line:** a half-written or unknown log line is skipped and counted, never crashes the service.
6. **Restart:** stop and start Night Shift; history and current state come back from SQLite; nothing is shown twice.
7. **Last night:** after an 8-hour run, "Last night" lists the sessions, the files changed and any failed commands.
8. **Read only:** no test, and no code path, writes inside the Claude Code folder.
9. **A stranger installs it:** on a clean machine with Claude Code logs in the usual place, `npx nightshift` starts, finds the logs, and the first-run screen names what it found, with no setup.
10. **Nothing leaves the computer:** the service listens on localhost only and makes no outgoing network calls (a test fails if it tries).
11. **Background agents:** a parent session starts two helpers in other repositories and one in a worktree of its own; the
    board of each repository shows only its helpers, the parent's project keeps the worktree one, new helper files and
    appended lines show live, and a half-written last line breaks nothing.

## 10. Guardrails (quality, from the first commit)

Claude writes most of the code; these keep it from drifting into a mess on a long project.
1. Strict TypeScript; Biome as linter and formatter.
2. A rules script: no `@ts-ignore`, no `any`, no TODO without a ticket number, no file writes under the Claude Code folder, no hard-coded personal paths.
3. An architecture test that enforces the one-way layers (section 7).
4. Scenario tests (section 9), on real-shaped sample logs kept in `test/fixtures/`.
5. Small files (under about 300 lines) and small functions, enforced by the linter.
6. One gate: `npm run ci` runs all of the above; GitHub Actions runs the same command on every push.
7. A fresh reviewer (a new Claude with no memory of the change) reads every diff before it is committed.
8. `CLAUDE.md` (how the project works) and `docs/decisions.md` (what was chosen and why) are updated in the same commit as the change they describe.
9. Small tickets: one evening, one ticket, one visible win.

## 11. First week, one ticket per evening

| #   | Ticket                                                                                                 | The visible win                                                   |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | Repo, guardrails and CI, with one passing scenario test; README that says what it is and how to run it | A green check on GitHub                                           |
| 2   | Parser: log line → event, with fixtures from real logs                                                 | Tests show real sessions turned into steps                        |
| 3   | Watcher + `/events` stream                                                                             | `curl localhost:4400/events` prints steps live while Claude works |
| 4   | The "Now" page                                                                                         | A browser tab shows every running session, updating live          |
| 5   | Session timeline                                                                                       | Click a session, see its steps in order                           |
| 6   | SQLite history + restart                                                                               | Stop and start; nothing lost, nothing doubled                     |
| 7   | Workflow board                                                                                         | The assembly line, live                                           |
| 8   | `npx nightshift` for anyone: find the logs on any OS, first-run screen, publish to npm                 | A friend can run it in one command                                |

## 12. Open questions

1. Name: keep "Night Shift"? (Check the npm name `nightshift` is free; otherwise `claude-nightshift`.)
2. Port 4400, or another?
3. Should "Last night" also be sent somewhere in the morning (a notification, an email to myself), or only shown on the page?
4. Which projects to watch by default: all of them, or ask on first run?
5. A shared team board (several developers, one screen): ever, or never? It would need a server and accounts.

## 13. Change log

- 0.9 (2026-10-24): the link to Night Watch (read only): a Live site strip, a From Night Watch lane of incidents on the board of a watched project, a site light on its start page tile, and a `→ Night Watch` link (decision in decisions.md).
- 0.8 (2026-10-24): a session shows on every repository it works in (steps split by where they work), and the start page lists a fixed project list from `~/.nightshift/projects.json` (idle ones dimmer), plus recently used repos under `~/Projects`.
- 0.7 (2026-10-24): background agents (subagents) are followed and filed under the project they really work in (section 5b, scenario 11).
- 0.1 (2026-10-23): first draft from the conversation: Claude Code logs only in v1, GitHub with CI, Node.js + TypeScript, SSE, SQLite, local page, Rule 1 and the guardrails.
- 0.6 (2026-10-24): the board takes the first design's layout (header totals, NOW strip, Board, Terminal and Timeline tabs) in the readable palette (section 8).
- 0.5 (2026-10-24): the board is built and watches a real pipeline (its journal and its agents' logs); the owner chose the look (section 8).
- 0.4 (2026-10-23): a board per project at its own address, as many open at once as you like; a start page lists the active ones.
- 0.3 (2026-10-23): Night run planned for version 2: all night by default, an optional ticket limit with "Start next batch", pause on usage limit.
- 0.2 (2026-10-23): it is for any developer, not only me: install with `npx nightshift`, find the logs on any OS, a first-run screen, an optional config file, nothing leaves the computer; team board moved to the open questions.
