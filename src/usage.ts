/** What the command was asked to do. Kept apart from the command itself so it can be tested without starting anything. */
export type Command = { kind: "help" } | { kind: "version" } | { kind: "unknown"; arg: string };

export function parseArgs(args: string[]): Command {
  const [first] = args;
  if (first === undefined || first === "--help" || first === "-h") return { kind: "help" };
  if (first === "--version" || first === "-v") return { kind: "version" };
  return { kind: "unknown", arg: first };
}

export function usage(version: string): string {
  return [
    `Night Shift ${version}`,
    "A live screen for your Claude Code agents: what they are doing now and what they did overnight.",
    "",
    "Usage:",
    "  nightshift                  start the service and open the page (coming soon)",
    "  nightshift -v, --version    print the version",
    "  nightshift -h, --help       show this help",
    "",
    "Night Shift only reads Claude Code's log files. Nothing leaves your computer.",
  ].join("\n");
}
