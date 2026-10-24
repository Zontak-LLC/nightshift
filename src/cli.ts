#!/usr/bin/env node
// The `nightshift` command: wires the watcher to the server and the terminal. See CLAUDE.md for the layers.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server/index.js";
import { Board, repoOf } from "./store/index.js";
import { terminalPrinter } from "./terminal.js";
import { parseArgs, usage } from "./usage.js";
import { watchLogs } from "./watcher/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const command = parseArgs(process.argv.slice(2));

async function start(): Promise<void> {
  const root = process.env.NIGHTSHIFT_LOGS || join(homedir(), ".claude", "projects");
  const board = new Board();
  const server = await startServer(Number(process.env.NIGHTSHIFT_PORT) || 4400, {
    view: (project) => {
      const view = board.view(project);
      const home = homedir();
      const folder = view.folder?.startsWith(home) ? `~${view.folder.slice(home.length)}` : view.folder;
      return { ...view, folder, repo: view.folder ? repoOf(view.folder) : null };
    },
    projects: () => board.projects(),
  });
  const print = terminalPrinter();
  console.info(`Night Shift ${pkg.version} · watching ${root}\nBoard: http://localhost:${server.port}/\n`);
  const stop = watchLogs({
    root,
    onEvent: (event) => {
      board.apply(event);
      server.publish(event);
      const line = print(event);
      if (line) console.info(line);
    },
    onRun: (event) => {
      board.apply(event);
      server.publish(event);
    },
    onError: (error) => console.error(`nightshift: ${error instanceof Error ? error.message : String(error)}`),
  });
  const quit = async () => {
    stop();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

if (command.kind === "version") console.info(pkg.version);
else if (command.kind === "help") console.info(usage(pkg.version));
else if (command.kind === "start") await start();
else {
  console.error(`nightshift: unknown option ${command.arg}\n\n${usage(pkg.version)}`);
  process.exitCode = 2;
}
