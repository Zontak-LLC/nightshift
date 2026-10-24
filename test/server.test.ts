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
      expect((await fetch(`http://127.0.0.1:${server.port}/no/such/page`)).status).toBe(404);
      // A path the URL parser refuses ("//") is a plain 400, never a crash of the whole tool.
      const raw = await new Promise<number>((resolve, reject) => {
        const req = request(
          { host: "127.0.0.1", port: server.port, path: "//", headers: { host: `127.0.0.1:${server.port}` } },
          (r) => {
            r.resume();
            resolve(r.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(raw).toBe(400);
      expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(200); // still up
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

  it("serves the board page, and pushes each open board its project's state when something changes", async () => {
    let version = 1;
    const server = await startServer(0, {
      view: (project) => ({ project, version }),
      projects: () => [{ project: "demo-app" }],
    });
    try {
      const page = await (await fetch(`http://127.0.0.1:${server.port}/demo-app`)).text();
      expect(page).toContain("<title>Night Shift</title>");
      // The page loads nothing from the internet: no script, style, font or image from another host.
      expect(page).not.toMatch(/(?:src|href)=["']?https?:|url\(["']?https?:|@import/);
      const res = await fetch(`http://127.0.0.1:${server.port}/events?project=demo-app`);
      const reader = res.body?.getReader();
      const decode = new TextDecoder();
      let text = "";
      const until = async (want: string) => {
        while (!text.includes(want)) text += decode.decode((await reader?.read())?.value);
      };
      await until('"version":1');
      expect(text).toContain("event: board");
      version = 2;
      server.publish({ kind: "prompt", at: "t", sessionId: "s", text: "something changed" });
      await until('"version":2');
      const start = await fetch(`http://127.0.0.1:${server.port}/events?project=`);
      const first = decode.decode((await start.body?.getReader().read())?.value);
      expect(first).toContain(": connected");
      await reader?.cancel();
    } finally {
      await server.close();
    }
  });
});
