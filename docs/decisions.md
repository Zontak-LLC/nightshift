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

## Where does it run?
- **On the developer's own computer** (2026-10-23).
  - **OPEN: check from a phone, away from the desk?** Yes adds a phone view and a way to reach the service from outside
    the house (changes how the server listens). No keeps localhost only.

## What does it watch?
- **Version 1: Claude Code logs only, read only** (2026-10-23).
  - Later: GitHub pull requests and CI runs (version 2).

## Language and tools (Rule 1)
- **Node.js + TypeScript** (the owner prefers Node for own projects; it fits file watching and streaming). Runner-up: Go.
- **Server-Sent Events** for live updates (one-way is all that is needed). Runner-up: WebSockets.
- **SQLite** for history (one file, searchable). Runner-up: JSON files.
- **A local web page**, plain TypeScript and CSS, no framework for v1. Runner-up: a menu-bar app (later stretch).

## Where does the code live?
- **GitHub, open source (MIT), CI on every change** (2026-10-23, the owner).
  - **OPEN: which account?** `Zontak-LLC/nightshift` or a personal one.

## How do we keep it clean? (guardrails)
- Strict TypeScript, Biome, a rules script (no ts-ignore, TODO needs a ticket, no personal paths, only `src/store/`
  writes to disk, files under 300 lines), an architecture test (layers point one way), scenario tests, one
  `npm run ci`, a fresh reviewer before each commit. (2026-10-23)
