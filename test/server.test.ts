import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/server/index.js";

describe("the live stream", () => {
  it("sends each published event to a connected page, and answers health", async () => {
    const server = await startServer(0);
    try {
      expect(await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()).toEqual({ ok: true });
      const res = await fetch(`http://127.0.0.1:${server.port}/events`);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const reader = res.body?.getReader();
      await reader?.read(); // ": connected"
      server.publish({ kind: "prompt", at: "t", sessionId: "s", text: "hello" });
      const { value } = (await reader?.read()) ?? {};
      expect(new TextDecoder().decode(value)).toContain('"text":"hello"');
      await reader?.cancel();
      expect((await fetch(`http://127.0.0.1:${server.port}/nope`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("refuses a page that reached it under another name (DNS rebinding)", async () => {
    const server = await startServer(0);
    try {
      const status = (host: string) =>
        new Promise<number>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.port, path: "/health", headers: { host } }, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          });
          req.on("error", reject);
          req.end();
        });
      expect(await status(`evil.example:${server.port}`)).toBe(403);
      expect(await status(`localhost:${server.port}`)).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("forgets a page that went away and ignores events after it closed", async () => {
    const server = await startServer(0);
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${server.port}/events`, { signal: ac.signal });
    await res.body?.getReader().read();
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(() =>
      server.publish({ kind: "prompt", at: "t", sessionId: "s", text: "after the page left" }),
    ).not.toThrow();
    await server.close();
    expect(() => server.publish({ kind: "prompt", at: "t", sessionId: "s", text: "after close" })).not.toThrow();
  });
});
