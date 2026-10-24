import { basename } from "node:path";
import type { NightEvent } from "./parser/index.js";

/**
 * The terminal view of the live stream (ticket 3's visible win): one short line per step, "usehourly  Editing x.ts".
 * Pure: it remembers each session's project from its "session.seen" event and returns the line to print, or null.
 * Claude Code writes a session's title and pull-request link into the log again from time to time, so each is printed
 * only when it is new for that session.
 */
export function terminalPrinter(): (event: NightEvent) => string | null {
  const line = lineFor();
  // Log text (a prompt, a title, a file name) may hold escape codes that would steer the terminal: print them inert.
  return (event) => {
    const out = line(event);
    return out === null ? null : out.replace(CONTROL, "�");
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

function lineFor(): (event: NightEvent) => string | null {
  const projectOf = new Map<string, string>();
  const titleOf = new Map<string, string>();
  const prsSeen = new Set<string>();
  return (event) => {
    if (event.kind === "session.seen") {
      const name = basename(event.cwd) || event.cwd;
      const isNew = projectOf.get(event.sessionId) !== name;
      projectOf.set(event.sessionId, name);
      return isNew ? `${name.padEnd(18)} ● session on ${event.branch ?? "no branch"}` : null;
    }
    const project = (projectOf.get(event.sessionId) ?? "?").padEnd(18);
    const time = clock(event.at);
    switch (event.kind) {
      case "tool.use":
        return `${time}  ${project} ${event.summary}`;
      case "tool.result":
        return event.ok ? null : `${time}  ${project} ✕ that step failed`;
      case "prompt":
        return `${time}  ${project} ▸ asked: ${event.text}`;
      case "session.title":
        if (titleOf.get(event.sessionId) === event.title) return null;
        titleOf.set(event.sessionId, event.title);
        return `${time}  ${project} ★ ${event.title}`;
      case "pr.link": {
        const key = `${event.sessionId}#${event.number}`;
        if (prsSeen.has(key)) return null;
        prsSeen.add(key);
        return `${time}  ${project} ⇪ pull request #${event.number}`;
      }
      default:
        return null;
    }
  };
}

/** The event's time on this computer's clock, "21:04:07"; blank when the log line had none. */
function clock(at: string): string {
  const d = new Date(at);
  if (!at || Number.isNaN(d.getTime())) return "        ";
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
