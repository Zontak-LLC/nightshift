/**
 * The Night Watch parts of the page, as pure functions that are tested here AND sent to the browser as their own
 * source (the same trick as shift.ts, so each one stands alone: no imports, no outside values).
 */
export type WatchIn = {
  siteId: string;
  status: string;
  site: {
    name: string;
    light: string;
    open: number;
    release: { sha: string; ago: string | null; verdict: string | null; level: string } | null;
  } | null;
} | null;

/** The words of the "Live site" strip: its light, the headline, the incident count and the release line. */
export function watchStrip(w: WatchIn): { light: string; headline: string; open: string; release: string } | null {
  if (!w) return null;
  if (w.status !== "up") {
    return {
      light: "off",
      headline: w.status === "connecting" ? "Night Watch: connecting…" : "Night Watch: not running",
      open: "",
      release: "",
    };
  }
  if (!w.site) {
    return { light: "off", headline: "Night Watch does not list the site “" + w.siteId + "”", open: "", release: "" };
  }
  const s = w.site;
  const word =
    s.light === "ok"
      ? "All clear"
      : s.light === "warn"
        ? "Needs a look"
        : s.light === "bad"
          ? "Problem"
          : "Waiting for data";
  const rel = s.release;
  return {
    light: s.light,
    headline: s.name + ": " + word,
    open: s.open === 0 ? "No open incidents" : s.open + (s.open === 1 ? " open incident" : " open incidents"),
    release: rel
      ? "Last release " + rel.sha + (rel.ago ? " · " + rel.ago : "") + (rel.verdict ? " · " + rel.verdict : "")
      : "No release seen yet",
  };
}

/** "3 min ago", "2 h ago", "5 d ago"; empty when the time is missing or in the future. */
export function ageText(iso: string | null, nowMs: number): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t) || t > nowMs + 60000) return "";
  const m = Math.floor(Math.max(0, nowMs - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 1440) return Math.floor(m / 60) + " h ago";
  return Math.floor(m / 1440) + " d ago";
}

export const WATCH_VIEW = [watchStrip, ageText].map((f) => f.toString()).join("\n");
