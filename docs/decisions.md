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
- **A local web page**, plain TypeScript and CSS, no framework for v1. Runner-up: a menu-bar app (later stretch).

## Where does the code live?

- **GitHub, open source (MIT), CI on every change** (2026-10-23, the owner).
  - **Zontak-LLC/nightshift**, public (2026-10-23, the owner): next to UseHourly and Club ADHD, same CI and Dependabot habits.
  - **CI: GitHub Actions only, no CircleCI** (2026-10-23): nothing to deploy (it runs on each developer's computer), no
    secrets, free for public repos. npm publishing later from GitHub Actions with trusted publishing (no stored token).

## How do we keep it clean? (guardrails)

- Strict TypeScript, Biome, a rules script (no ts-ignore, TODO needs a ticket, no personal paths, only `src/store/`
  writes to disk, files under 300 lines), an architecture test (layers point one way), scenario tests, one
  `npm run ci`, a fresh reviewer before each commit. (2026-10-23)
