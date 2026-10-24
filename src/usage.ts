/** What the command was asked to do. Kept apart from the command itself so it can be tested without starting anything. */
export type Command = { kind: "start" } | { kind: "help" } | { kind: "version" } | { kind: "unknown"; arg: string };

export function parseArgs(args: string[]): Command {
  const [first] = args;
  if (first === undefined) return { kind: "start" };
  if (first === "--help" || first === "-h") return { kind: "help" };
  if (first === "--version" || first === "-v") return { kind: "version" };
  return { kind: "unknown", arg: first };
}

export function usage(version: string): string {
  return [
    `Night Shift ${version}`,
    "A live screen for your Claude Code agents: what they are doing now and what they did overnight.",
    "",
    "Usage:",
    "  nightshift                  watch your Claude Code sessions live (the page comes next)",
    "  nightshift -v, --version    print the version",
    "  nightshift -h, --help       show this help",
    "",
    "Settings: NIGHTSHIFT_PORT (default 4400), NIGHTSHIFT_LOGS (default ~/.claude/projects),",
    "NIGHTSHIFT_DATA (where the history is kept, default ~/.nightshift), NIGHTSHIFT_KEEP_DAYS (default 30).",
    "",
    "Night Shift only reads Claude Code's log files. Nothing leaves your computer.",
  ].join("\n");
}
