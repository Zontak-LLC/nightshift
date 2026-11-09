#!/usr/bin/env node
// Lens's `nightshift` command: wires the watcher to the server and the terminal. See CLAUDE.md for the layers.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { startEngine } from "./engine.js";
import { startMeter } from "./meter.js";
import type { NightEvent, RunEvent } from "./parser/index.js";
import { startServer } from "./server/index.js";
import { DEFAULT_KEEP_DAYS, expand, loadPinned, projectTiles, repoOf, watchSiteOf } from "./store/index.js";
import { terminalPrinter } from "./terminal.js";
import { parseArgs, startBanner, usage } from "./usage.js";
import { localWatchUrl, startWatchClient, watchOnBoard, watchOnTile } from "./watch/index.js";
import { watchdog } from "./watcher/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const command = parseArgs(process.argv.slice(2));

async function start(): Promise<void> {
  const root = process.env.NIGHTSHIFT_LOGS || join(homedir(), ".claude", "projects");
  const dataDir = process.env.NIGHTSHIFT_DATA || join(homedir(), ".nightshift");
  const keepDays = Number(process.env.NIGHTSHIFT_KEEP_DAYS) || DEFAULT_KEEP_DAYS;
  let publish: (event: NightEvent | RunEvent) => void = () => {};
  const print = terminalPrinter((id) => engine.board.agentLabel(id));
  const engine = startEngine({
    root,
    dbPath: join(dataDir, "nightshift.db"),
    keepDays,
    onNew: (event) => {
      publish(event);
      if (!("runId" in event)) {
        const line = print(event);
        if (line) console.info(line);
      }
    },
    onError: (error) => console.error(`nightshift: ${error instanceof Error ? error.message : String(error)}`),
  });
  const { board } = engine;
  const meter = startMeter(process.env.NIGHTSHIFT_USAGE || join(homedir(), ".claude", "usage-now.json"));
  const pinnedFile = join(dataDir, "projects.json");
  let lastWarning = "";
  const warn = (message: string) => {
    if (message === lastWarning) return; // the list is read on every push; say a problem once
    lastWarning = message;
    console.error(`nightshift: ${message}`);
  };
  const watchUrl = localWatchUrl(process.env.NIGHTSHIFT_NIGHTWATCH_URL, warn);
  let refresh: () => void = () => {};
  const watch = startWatchClient({ url: watchUrl, onChange: () => refresh() });
  const tiles = () => {
    const pinned = loadPinned(pinnedFile, warn);
    return projectTiles(board.projects(), pinned, { home: homedir(), nowMs: Date.now() }).map((t) => ({
      ...t,
      watch: watchOnTile(t.watchSite, watch.status(), watch.snapshot()),
    }));
  };
  const server = await startServer(Number(process.env.NIGHTSHIFT_PORT) || 4400, {
    watchUrl,
    view: (project) => {
      const view = board.view(project);
      const home = homedir();
      const folder = view.folder?.startsWith(home) ? `~${view.folder.slice(home.length)}` : view.folder;
      const pinned = loadPinned(pinnedFile, warn);
      const name = pinned.find((p) => basename(expand(p.path, home)) === project)?.name ?? project;
      const site = watchSiteOf(pinned, project, home);
      return {
        ...view,
        name,
        folder,
        repo: view.folder ? repoOf(view.folder) : null,
        meter: meter.current(),
        watch: watchOnBoard(site, watch.status(), watch.snapshot()),
      };
    },
    projects: tiles,
    agents: () => board.desks(Date.now()),
    health: () => engine.health(),
  });
  publish = server.publish;
  refresh = server.refresh;
  setInterval(server.refresh, 30_000).unref(); // the meter changes without any event
  console.info(
    startBanner({ version: pkg.version, root, db: join(dataDir, "nightshift.db"), keepDays, port: server.port }),
  );
  const quit = async (code = 0) => {
    stopWatchdog();
    engine.stop();
    meter.stop();
    watch.stop();
    await Promise.race([server.close(), new Promise((r) => setTimeout(r, 5_000))]); // a stuck Lens must still exit
    process.exit(code);
  };
  // A Lens that stopped reading cannot heal itself: say so and exit 1, and the service starts a fresh one.
  const stopWatchdog = watchdog(
    () => engine.health(),
    (health) => {
      console.error(
        `nightshift: no line read since ${health.lastLineAt ?? "the start"} while logs changed (${health.lastChangeAt}); exiting so the service starts Lens again`,
      );
      void quit(1);
    },
  );
  process.on("SIGINT", () => void quit());
  process.on("SIGTERM", () => void quit());
}

if (command.kind === "version") console.info(pkg.version);
else if (command.kind === "help") console.info(usage(pkg.version));
else if (command.kind === "start") await start();
else {
  console.error(`nightshift: unknown option ${command.arg}\n\n${usage(pkg.version)}`);
  process.exitCode = 2;
}
