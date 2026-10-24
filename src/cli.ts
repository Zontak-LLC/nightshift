#!/usr/bin/env node
// The `nightshift` command. Ticket 1: --help and --version; the watcher and the page come in tickets 3 and 4.
import { readFileSync } from "node:fs";
import { parseArgs, usage } from "./usage.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const command = parseArgs(process.argv.slice(2));

if (command.kind === "version") console.info(pkg.version);
else if (command.kind === "help") console.info(usage(pkg.version));
else {
  console.error(`nightshift: unknown option ${command.arg}\n\n${usage(pkg.version)}`);
  process.exitCode = 2;
}
