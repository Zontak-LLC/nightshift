// What Night Shift shows of Night Watch (the sister project that watches the live sites). Pure functions: they take
// whatever the stream sent (unknown), keep what is usable, and never throw. Night Watch's shapes may change; a field
// that is missing or has the wrong type is simply left out.

export type Light = "ok" | "warn" | "bad" | "idle";

/** One Night Watch incident, as a ticket on a project board. */
export type WatchTicket = {
  id: string;
  title: string;
  severity: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  resolvedAt: string | null;
  /** The AI's recommended fix, in one line (its summary, else the first step). */
  advice: string | null;
  /** The title of the GitHub issue draft, when Night Watch made one. */
  issueTitle: string | null;
  /** "healed by restart the back end" / "cleared by itself", for a resolved one. */
  healedBy: string | null;
};

export type Release = { sha: string; ago: string | null; verdict: string | null; level: Light };

export type SiteView = {
  id: string;
  name: string;
  light: Light;
  open: number;
  release: Release | null;
  open_tickets: WatchTicket[];
  done_tickets: WatchTicket[];
};

export type WatchSnapshot = { sites: Record<string, SiteView> };

/** How many resolved incidents the board keeps in Done. */
export const DONE_SHOWN = 5;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const oneLine = (s: string, max = 200): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const LEVEL: Record<string, Light> = { ok: "ok", warn: "warn", problem: "bad", bad: "bad", idle: "idle" };
const RANK: Record<Light, number> = { idle: 0, ok: 1, warn: 2, bad: 3 };

/** The worst tile level of a site. Idle tiles (not connected yet) do not count against it; no tiles at all = idle. */
export function worstLight(levels: unknown[]): Light {
  let worst: Light = "idle";
  for (const raw of levels) {
    const l = LEVEL[String(raw)];
    if (l && RANK[l] > RANK[worst]) worst = l;
  }
  return worst;
}

function adviceOf(triage: unknown, fix: unknown): string | null {
  const f = obj(fix);
  const why = f ? str(f.why) : null;
  const action = f ? str(f.action) : null;
  if (action && action !== "none") return oneLine(`${action.replace(/-/g, " ")}${why ? `: ${why}` : ""}`);
  const t = obj(triage);
  const steps = t ? list(t.steps) : [];
  const first = typeof steps[0] === "string" ? str(steps[0]) : null;
  const summary = t ? str(t.summary) : null;
  return first ? oneLine(first) : summary ? oneLine(summary) : null;
}

function healedBy(heal: Obj | null): string {
  const attempts = heal ? list(heal.attempts) : [];
  for (const a of attempts) {
    const o = obj(a);
    if (o && o.verdict === "healed") {
      const what = str(o.action)?.replace(/-/g, " ");
      return what ? `healed by ${what}` : "healed";
    }
  }
  return "cleared by itself";
}

export function ticketOf(raw: unknown): WatchTicket | null {
  const i = obj(raw);
  const id = i ? str(i.id) : null;
  if (!i || !id) return null;
  const heal = obj(i.heal);
  const issue = obj(list(heal?.issues)[0]);
  const resolved = i.status === "resolved";
  return {
    id,
    title: oneLine(str(i.title) ?? "(no title)", 160),
    severity: str(i.severity) ?? "unknown",
    count: Math.max(1, num(i.count, 1)),
    firstAt: str(i.firstAt),
    lastAt: str(i.lastAt),
    resolvedAt: str(i.resolvedAt),
    advice: adviceOf(i.triage, heal?.fix),
    issueTitle: issue ? str(issue.title) : null,
    healedBy: resolved ? healedBy(heal) : null,
  };
}

function releaseOf(boxes: Obj[]): Release | null {
  const box = boxes.find((b) => b.id === "deploys");
  const sha = box ? str(box.figure) : null;
  if (!box || !sha || sha === "—") return null;
  const label = str(box.figureLabel);
  const ago = label?.split("·")[1]?.trim() ?? null;
  return { sha, ago, verdict: str(box.reason), level: LEVEL[String(box.level)] ?? "idle" };
}

/** The sites in one `state` event. Anything unreadable gives an empty snapshot, never an error. */
export function readState(data: unknown): WatchSnapshot {
  const state = obj(data);
  const sites: Record<string, SiteView> = {};
  if (!state) return { sites };
  const boxes = list(state.boxes).flatMap((b) => {
    const o = obj(b);
    return o ? [o] : [];
  });
  const incidents = list(state.incidents).flatMap((x) => {
    const o = obj(x);
    const t = ticketOf(x);
    return o && t ? [{ site: str(o.site), status: o.status, t }] : [];
  });
  for (const raw of list(state.sites)) {
    const s = obj(raw);
    const id = s ? str(s.id) : null;
    if (!s || !id) continue;
    const mine = boxes.filter((b) => b.site === id);
    const own = incidents.filter((x) => x.site === id);
    const open = own.filter((x) => x.status === "open").map((x) => x.t);
    const done = own
      .filter((x) => x.status === "resolved")
      .map((x) => x.t)
      .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))
      .slice(0, DONE_SHOWN);
    sites[id] = {
      id,
      name: str(s.name) ?? id,
      light: worstLight(mine.map((b) => b.level)),
      open: open.length,
      release: releaseOf(mine),
      open_tickets: open.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")),
      done_tickets: done,
    };
  }
  return { sites };
}
