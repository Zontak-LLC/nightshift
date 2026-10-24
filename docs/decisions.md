# Night Shift: the decision tree

Every choice that shapes the project, as a tree: a question, the branch taken, why, and what it ruled out. A branch
marked **OPEN** waits for an answer; answering it can change the branches under it. Claude adds a node whenever a choice
is made, in the same commit as the change. Rule 1 applies to every node: the right fit for the job, not habit.

## Who is it for?

- **Any developer who runs Claude Code** (2026-10-23, the owner). Each runs it on their own computer.
  - → No accounts, no server, nothing leaves the computer.
  - → Install is one command: `npx nightshift` (the npm name is free, checked 2026-10-23).
  - → No personal paths or settings in the code (a rules check enforces it).
  - **OPEN: a shared team board?** Yes would need a server and accounts; no keeps it local forever.

## How are several projects shown?

- **A board per project, at its own address; open several at once** (2026-10-23, the owner). One service serves them
  all; a start page lists the projects active in the last 10 minutes. Ruled out: one combined board (crowded with many
  projects).

## Where does it run?

- **On the developer's own computer** (2026-10-23).
  - **OPEN: check from a phone, away from the desk?** Yes adds a phone view and a way to reach the service from outside
    the house (changes how the server listens). No keeps localhost only.

## What does it watch?

- **Version 1: Claude Code logs only, read only** (2026-10-23).
  - Later: GitHub pull requests and CI runs (version 2).
- **Version 2: Night run**, Night Shift starts the work itself (2026-10-23, the owner). **Default: all night until the
  queue is done.** Optional `ticketLimit` (5, 10, ...) for accounts with usage limits, then "Start next batch". Reaching a
  usage limit pauses, never fails, and resumes without redoing finished tickets.
  - **OPEN: in version 1 instead?** Recommended no: watching must be reliable before Night Shift starts anything.

## Language and tools (Rule 1)

- **Node.js + TypeScript** (the owner prefers Node for own projects; it fits file watching and streaming). Runner-up: Go.
- **Server-Sent Events** for live updates (one-way is all that is needed). Runner-up: WebSockets.
- **SQLite** for history (one file, searchable). Runner-up: JSON files.
  - **History = the event log (ticket 6, 2026-10-24).** The board is built from events alone, so the file stores the events
    (idempotent by file + inode + epoch + line end) and each file's offset; sessions, background agents, steps and
    tickets are rebuilt by replay, not kept in tables of their own that could drift from the events. Retention removes
    whole sessions quiet for 30 days (`NIGHTSHIFT_KEEP_DAYS`). If the file cannot be opened, Night Shift runs without
    history and says so.
- **A local web page**, plain TypeScript and CSS, no framework for v1. Runner-up: a menu-bar app (later stretch).

## Where does the code live?

- **GitHub, open source (MIT), CI on every change** (2026-10-23, the owner).
  - **Zontak-LLC/nightshift**, public (2026-10-23, the owner): next to UseHourly and Club ADHD, same CI and Dependabot habits.
  - **CI: GitHub Actions only, no CircleCI** (2026-10-23): nothing to deploy (it runs on each developer's computer), no
    secrets, free for public repos. npm publishing later from GitHub Actions with trusted publishing (no stored token).

## How does the board look? (2026-10-24, the owner, after trying several)

- **Readable for hours:** a dark grey-blue page (`#16181d`), never pure black; soft off-white text (`#d4d7dd`, about 12:1),
  never pure white; a quieter grey for secondary text; thin quiet lines. Colour only with a meaning: blue = live,
  green = done, amber = needs attention. Sans for titles, monospace only for machine output.
  - Ruled out: phosphor green on black (tiring after a while), lavender on charcoal with gaps between boxes (busy),
    glow and scan lines (decoration).
- **Layout: the first design, in this palette (2026-10-24, the owner: "less boring", "looks more unique"):** a header
  of totals, a NOW strip, and tabs for Board (the assembly line with a belt under each station), Terminal and Timeline.
  It replaced the CICS / Norton Commander layout (framed areas with titles in the frame, a message line); its Key=Action
  line stayed. The first design's eight status colours were cut to four, each with one meaning.
- **The arithmetic is shared, not copied:** totals, the finish estimate and the timeline's hour rows live in
  `src/web/shift.ts`, are tested there, and are sent to the page as their own source text (`Function.prototype.toString`),
  so the browser runs the tested code. `tsx` (`npm run dev`) wraps named arrows in `__name(...)`; a one-line no-op
  stand-in sent before them makes that harmless.
- **Fonts on the computer only:** the page loads nothing from the internet (no web fonts), so nothing leaves it.
- **The page asks for nothing:** the server pushes each open board its whole state over the stream (at most every 300 ms),
  so a reconnecting page is at once up to date, and the web layer never calls `fetch`.

## How do we know work has stopped? (ticket 5, 2026-10-24)

- **From Claude Code's own error lines**, read in the user's real logs: an assistant line with `isApiErrorMessage: true`
  and a structured `error` field. `rate_limit` (HTTP 429) = the usage limit, with `quotaLimits.resetsAt` (Unix seconds)
  and `rateLimitType` (for example `five_hour`); `server_error` = a lost connection or the computer slept;
  `authentication_failed` = the login expired. The sentence ("You've hit your session limit · resets 8:40pm") is only
  shown, never parsed. Ruled out: guessing from silence alone (a quiet ticket still shows "Quiet since" after 30 min).
- **A pause lasts until the next real step** of that session or agent, so the board clears by itself when work resumes.

## How do we keep it clean? (guardrails)

- Strict TypeScript, Biome, a rules script (no ts-ignore, TODO needs a ticket, no personal paths, only `src/store/`
  writes to disk, files under 300 lines), an architecture test (layers point one way), scenario tests, one
  `npm run ci`, a fresh reviewer before each commit. (2026-10-23)

## How are background agents shown? (ticket 7, 2026-10-24)

- **Each background agent is a "worker", linked to its parent session** (2026-10-24, the owner found that the board
  showed only the main session). Its log is `<session>/subagents/agent-<id>.jsonl`; the small `agent-<id>.meta.json`
  beside it holds the description it was started with, which is its name. With no description the name is the first
  line of its task prompt. Pipeline agents (a workflow's tickets) keep their own path through the run; every other agent
  id is a worker.
- **Its project comes from where it works, not where it started.** A subagent's lines carry the parent's `cwd`, so that
  says nothing. Instead the parser lists the paths each tool call touches (`parser/paths.ts`: file tools' paths, a
  command's `cd` targets, `git -C` folders, any absolute or `~/` path in the command). The store maps each to its git
  repository (`store/root.ts`: walk up to the folder with `.git`) and the worker's project is the repository with the
  most calls (a tie goes to the first seen). A path under `.claude/worktrees/<x>` or a `.git` file pointing at
  `<main>/.git/worktrees/<x>` counts as the main repository, marked "(worktree)". With no votes it falls back to the
  parent session's folder.
  - **Limits (said plainly):** a command that never names a folder (`npm test` after an earlier `cd` in another
    call) gives no vote; read-only looks at a path outside any repo (`/tmp`, `~/.claude`) give none; the home folder
    never counts as a repo, so a dotfiles repository cannot take over; the project name is the folder name, so two
    repositories with the same folder name share a board; a short agent that only searches the web stays under its
    parent. The project can change while the agent works, as the votes change.
- **Working or finished:** an agent is "working" until its turn ends with an answer (`stop_reason: end_turn`) or it has
  been quiet for 10 minutes. Agents quiet for 6 hours leave the board. Old agent files quiet at start are not read, so
  history is not shown as live.
