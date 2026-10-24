import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Night Watch: it streams `event: state` frames shaped like the real board state.
export const incident = (o: Record<string, unknown>) => ({
  id: "i1",
  site: "loader",
  title: "Error: connect ECONNREFUSED 10.0.4.12:5432",
  severity: "critical",
  status: "open",
  count: 3,
  firstAt: "2026-10-24T05:44:00Z",
  lastAt: "2026-10-24T05:44:05Z",
  resolvedAt: null,
  triage: { summary: "The back end cannot reach its database.", steps: ["Check that PostgreSQL is running."] },
  heal: { fix: null, attempts: [], issues: [], exhausted: false },
  ...o,
});
export const state = (incidents: unknown[], over: Record<string, unknown> = {}) => ({
  sites: [
    { id: "loader", name: "Loader" },
    { id: "usehourly", name: "UseHourly" },
  ],
  boxes: [
    { id: "website", level: "ok", site: "loader" },
    { id: "logs", level: "problem", site: "loader" },
    {
      id: "deploys",
      level: "ok",
      site: "loader",
      figure: "9b06e7c",
      figureLabel: "last release · 1h 28m ago",
      reason: "Release looks healthy after 15 min",
    },
    { id: "website", level: "ok", site: "usehourly" },
    { id: "deploys", level: "idle", site: "usehourly", figure: "—", reason: "Not connected" },
  ],
  incidents,
  ...over,
});

export type Fake = { port: number; send: (data: unknown) => void; dropAll: () => void; close: () => Promise<void> };
export async function fakeNightWatch(port = 0): Promise<Fake> {
  const open = new Set<ServerResponse>();
  const server: Server = createServer((req, res) => {
    if (req.url !== "/events") return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": connected\n\n");
    open.add(res);
    res.on("close", () => open.delete(res));
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    send: (data) => {
      for (const r of open) r.write(`event: state\ndata: ${JSON.stringify(data)}\n\n`);
    },
    dropAll: () => {
      for (const r of open) r.destroy();
    },
    close: () =>
      new Promise((done) => {
        for (const r of open) r.destroy();
        server.close(() => done());
      }),
  };
}

export const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 15));
  }
};
