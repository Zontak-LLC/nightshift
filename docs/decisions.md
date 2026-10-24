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

## How does the board look? (2026-10-24, the owner, after trying several)

- **Readable for hours:** a dark grey-blue page (`#16181d`), never pure black; soft off-white text (`#d4d7dd`, about 12:1),
  never pure white; a quieter grey for secondary text; thin quiet lines. Colour only with a meaning: blue = live,
  green = done, amber = needs attention. Sans for titles, monospace only for machine output.
  - Ruled out: phosphor green on black (tiring after a while), lavender on charcoal with gaps between boxes (busy),
    glow and scan lines (decoration).
- **Layout like CICS and Norton Commander:** a top line (title, date, time, status light), labelled fields (REPO, FOLDER,
  BRANCH), framed areas with the title in the frame, a plain-words message line, a Key=Action line. Function first:
  anything that is only decoration is dropped.
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
