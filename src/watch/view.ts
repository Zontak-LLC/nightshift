// What a board or a tile receives about Night Watch: plain data the page draws. No site for the project = null.
import type { WatchStatus } from "./client.js";
import type { Light, SiteView, WatchSnapshot } from "./model.js";

export type WatchOnBoard = {
  /** The Night Watch site id this project is linked to. */
  siteId: string;
  /** "up" = the stream is live; anything else = Night Watch is not running (shown as such). */
  status: WatchStatus;
  /** The site's state; null when Night Watch is down or does not list this site. */
  site: SiteView | null;
};
export type WatchOnTile = {
  siteId: string;
  status: WatchStatus;
  light: Light | null;
  open: number;
  /** The same small shape a board gets, so one function draws the light for both. */
  site: { name: string; light: Light; open: number; release: null } | null;
};

export function watchOnBoard(siteId: string | null, status: WatchStatus, snap: WatchSnapshot): WatchOnBoard | null {
  if (!siteId) return null;
  return { siteId, status, site: status === "up" ? (snap.sites[siteId] ?? null) : null };
}

export function watchOnTile(siteId: string | null, status: WatchStatus, snap: WatchSnapshot): WatchOnTile | null {
  const b = watchOnBoard(siteId, status, snap);
  if (!b) return null;
  const site = b.site && { name: b.site.name, light: b.site.light, open: b.site.open, release: null };
  return { siteId: b.siteId, status, light: b.site?.light ?? null, open: b.site?.open ?? 0, site };
}
