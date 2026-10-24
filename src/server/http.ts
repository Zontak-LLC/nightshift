import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { NightEvent } from "../parser/index.js";

export type NightServer = { port: number; publish: (event: NightEvent) => void; close: () => Promise<void> };

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
export function startServer(port: number): Promise<NightServer> {
  const clients = new Set<ServerResponse>();
  let actualPort = port;
  let closed = false;
  const drop = (res: ServerResponse) => {
    clients.delete(res);
    if (!res.writableEnded) res.end();
  };
  const server = createServer((req, res) => {
    res.on("error", () => drop(res)); // a page that went away mid-write is simply forgotten
    if (!fromThisComputer(req, actualPort)) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Night Shift only answers this computer");
      return;
    }
    if (req.url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      res.on("close", () => clients.delete(res));
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  });
  const publish = (event: NightEvent) => {
    if (closed) return;
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
            for (const res of clients) drop(res);
            server.close(() => done());
            server.closeAllConnections(); // idle keep-alive sockets would hold the close (and Ctrl+C) for seconds
          }),
      });
    });
  });
}
