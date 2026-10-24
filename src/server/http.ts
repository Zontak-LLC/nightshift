import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { NightEvent, RunEvent } from "../parser/index.js";
import { boardPage } from "../web/index.js";

export type NightServer = {
  port: number;
  /** Streams one event to plain `/events` listeners and refreshes the boards that are open. */
  publish: (event: NightEvent | RunEvent) => void;
  close: () => Promise<void>;
};

/** Where the boards come from (the store, wired in by the CLI). */
export type BoardSource = { view: (project: string) => unknown; projects: () => unknown };

/** Boards are pushed at most this often, so a burst of log lines is one redraw. */
const PUSH_EVERY_MS = 300;

/** A page that stops reading is dropped once this much is waiting for it, so it cannot fill the memory. */
const MAX_BUFFERED = 1_000_000;

/**
 * The page asked for this computer by name. Binding to 127.0.0.1 keeps the network out, but a web page can still
 * point its own domain at 127.0.0.1 (DNS rebinding) and read the stream of prompts; its requests carry its own Host.
 */
function fromThisComputer(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
 * The local server: `/events` streams every new event to the open pages (Server-Sent Events), `/health` answers ok.
 * It listens on 127.0.0.1 only and answers only requests addressed to this computer. No CORS headers on purpose.
 */
export function startServer(port: number, source?: BoardSource): Promise<NightServer> {
  const clients = new Set<ServerResponse>();
  /** Pages showing a board ("" = the start page), and what each was last sent. */
  const pages = new Map<ServerResponse, { project: string; sent: string }>();
  let pushTimer: NodeJS.Timeout | null = null;
  let actualPort = port;
  let closed = false;
  const drop = (res: ServerResponse) => {
    clients.delete(res);
    pages.delete(res);
    if (!res.writableEnded) res.end();
  };
  const server = createServer((req, res) => {
    res.on("error", () => drop(res)); // a page that went away mid-write is simply forgotten
    if (!fromThisComputer(req, actualPort)) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Night Shift only answers this computer");
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400, { "content-type": "text/plain" }).end("Bad request"); // e.g. "//": never let it reach the handler
      return;
    }
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const project = url.searchParams.get("project");
      if (project !== null && source) {
        pages.set(res, { project, sent: "" });
        pushTo(res);
      } else clients.add(res);
      res.on("close", () => drop(res));
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (req.method === "GET" && /^\/[^/]*$/.test(url.pathname) && url.pathname !== "/favicon.ico") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(boardPage());
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  });
  /** Sends a page its board (or the project list) when it differs from what that page has. */
  const pushTo = (res: ServerResponse) => {
    const page = pages.get(res);
    if (!page || !source) return;
    const kind = page.project ? "board" : "projects";
    const data = JSON.stringify(page.project ? source.view(page.project) : source.projects());
    if (data === page.sent) return;
    page.sent = data;
    if (res.writableLength > MAX_BUFFERED) drop(res);
    else res.write(`event: ${kind}\ndata: ${data}\n\n`);
  };
  const schedulePush = () => {
    if (pushTimer || closed) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      for (const res of pages.keys()) pushTo(res);
    }, PUSH_EVERY_MS);
  };
  const publish = (event: NightEvent | RunEvent) => {
    if (closed) return;
    schedulePush();
    const frame = `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      if (res.writableLength > MAX_BUFFERED) drop(res);
      else res.write(frame);
    }
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actualPort,
        publish,
        close: () =>
          new Promise((done) => {
            closed = true;
            if (pushTimer) clearTimeout(pushTimer);
            for (const res of [...clients, ...pages.keys()]) drop(res);
            server.close(() => done());
            server.closeAllConnections(); // idle keep-alive sockets would hold the close (and Ctrl+C) for seconds
          }),
      });
    });
  });
}
