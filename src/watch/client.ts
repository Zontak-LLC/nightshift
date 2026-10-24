// A small client for Night Watch's live stream (`GET /events`, Server-Sent Events). It reconnects with a growing
// wait, tolerates Night Watch being off, and keeps only the newest snapshot. Read only: it never sends anything.
import { readState, type WatchSnapshot } from "./model.js";

export const DEFAULT_WATCH_URL = "http://localhost:4500";

export type WatchStatus = "connecting" | "up" | "down";
export type WatchClient = {
  status: () => WatchStatus;
  snapshot: () => WatchSnapshot;
  stop: () => void;
};
type Options = {
  url: string;
  onChange?: () => void;
  /** Waits between tries: first, then doubling up to `maxWaitMs`. */
  firstWaitMs?: number;
  maxWaitMs?: number;
  fetchImpl?: typeof fetch;
};

/** Night Watch is a local tool: an address that is not this computer is refused (it would be sent nothing, but still). */
export function localWatchUrl(raw: string | undefined, warn: (m: string) => void = () => {}): string {
  const text = raw?.trim() || DEFAULT_WATCH_URL;
  try {
    const u = new URL(text);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if ((u.protocol === "http:" || u.protocol === "https:") && local) return u.origin;
  } catch {
    // falls through to the warning
  }
  warn(`NIGHTSHIFT_NIGHTWATCH_URL must be an address on this computer (${text} ignored); using ${DEFAULT_WATCH_URL}`);
  return DEFAULT_WATCH_URL;
}

/** Pulls whole `event:`/`data:` frames out of the text so far; returns the rest. */
export function takeFrames(buffer: string): { frames: { event: string; data: string }[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: { event: string; data: string }[] = [];
  for (const part of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

/** Reads a Server-Sent Events body to its end, handing the data of each `state` frame on. */
async function readFrames(body: ReadableStream<Uint8Array>, onState: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const got = takeFrames(buffer);
    buffer = got.rest;
    for (const f of got.frames) if (f.event === "state") onState(f.data);
  }
}

export function startWatchClient(o: Options): WatchClient {
  const doFetch = o.fetchImpl ?? fetch;
  const first = o.firstWaitMs ?? 1000;
  const max = o.maxWaitMs ?? 30_000;
  let status: WatchStatus = "connecting";
  let snap: WatchSnapshot = { sites: {} };
  let stopped = false;
  let abort: AbortController | null = null;
  let timer: NodeJS.Timeout | null = null;
  const set = (s: WatchStatus) => {
    if (s === status) return;
    status = s;
    o.onChange?.();
  };

  let delay = first;
  const connect = async (): Promise<void> => {
    abort = new AbortController();
    try {
      const res = await doFetch(`${o.url}/events`, { signal: abort.signal, headers: { accept: "text/event-stream" } });
      if (!res.ok || !res.body) throw new Error(`Night Watch answered ${res.status}`);
      await readFrames(res.body, (data) => {
        let next: WatchSnapshot;
        try {
          next = readState(JSON.parse(data));
        } catch {
          return; // one damaged frame is skipped; the stream goes on
        }
        snap = next;
        delay = first; // a stream that delivers data is healthy: the next drop retries quickly
        status = "up";
        o.onChange?.();
      });
    } catch {
      // Night Watch is off or the connection dropped: fall through to "down" and try again.
    }
    if (stopped) return;
    snap = { sites: {} };
    set("down");
    timer = setTimeout(() => void connect(), delay);
    delay = Math.min(max, delay * 2);
  };
  void connect();
  return {
    status: () => status,
    snapshot: () => snap,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      abort?.abort();
    },
  };
}
