import { afterEach, describe, expect, it } from "vitest";
import { readState, startWatchClient, watchOnBoard } from "../src/watch/index.js";
import { watchStrip } from "../src/web/watch-view.js";
import { fakeNightWatch, incident, state, until } from "./watch-fixtures.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

describe("Night Watch's incidents become tickets on the project board", () => {
  it("shows an open incident with its advice, then moves it to Done as 'healed by' when it resolves", async () => {
    const nw = await fakeNightWatch();
    cleanup.push(() => nw.close());
    const client = startWatchClient({ url: `http://127.0.0.1:${nw.port}`, firstWaitMs: 20 });
    cleanup.push(() => client.stop());
    await new Promise((r) => setTimeout(r, 60));
    nw.send(state([incident({})]));
    await until(() => client.status() === "up" && !!client.snapshot().sites.loader);

    const live = client.snapshot().sites.loader;
    expect(live).toMatchObject({ name: "Loader", light: "bad", open: 1 });
    expect(live?.open_tickets[0]).toMatchObject({
      title: "Error: connect ECONNREFUSED 10.0.4.12:5432",
      severity: "critical",
      count: 3,
      advice: "Check that PostgreSQL is running.",
      healedBy: null,
    });
    expect(live?.release).toEqual({
      sha: "9b06e7c",
      ago: "1h 28m ago",
      verdict: "Release looks healthy after 15 min",
      level: "ok",
    });
    expect(client.snapshot().sites.usehourly).toMatchObject({ light: "ok", open: 0, release: null });

    const healed = incident({
      status: "resolved",
      resolvedAt: "2026-10-24T06:00:00Z",
      heal: { attempts: [{ action: "restart-backend", verdict: "healed" }], issues: [{ title: "Fix the pool" }] },
    });
    nw.send(state([healed]));
    await until(() => client.snapshot().sites.loader?.open === 0);
    const after = client.snapshot().sites.loader;
    expect(after?.open_tickets).toEqual([]);
    expect(after?.done_tickets[0]).toMatchObject({ healedBy: "healed by restart backend", issueTitle: "Fix the pool" });
    // A resolved incident with no fix attempt cleared by itself.
    nw.send(state([incident({ status: "resolved", resolvedAt: "2026-10-24T06:00:00Z" })]));
    await until(() => client.snapshot().sites.loader?.done_tickets[0]?.healedBy === "cleared by itself");
  });

  it("keeps incidents of one site off the other site's board", () => {
    const snap = readState(state([incident({}), incident({ id: "i2", site: "usehourly", title: "Worker error" })]));
    expect(snap.sites.loader?.open_tickets.map((t) => t.id)).toEqual(["i1"]);
    expect(snap.sites.usehourly?.open_tickets.map((t) => t.id)).toEqual(["i2"]);
  });
});

describe("Night Watch goes away and comes back", () => {
  it("says it is not running when nothing answers, then connects by itself once it starts", async () => {
    const probe = await fakeNightWatch();
    const port = probe.port;
    await probe.close(); // the port is now free: nobody answers
    const changes: string[] = [];
    const client = startWatchClient({
      url: `http://127.0.0.1:${port}`,
      firstWaitMs: 20,
      maxWaitMs: 40,
      onChange: () => changes.push(client.status()),
    });
    cleanup.push(() => client.stop());
    await until(() => client.status() === "down");
    const down = watchOnBoard("loader", client.status(), client.snapshot());
    expect(watchStrip(JSON.parse(JSON.stringify(down)))?.headline).toBe("Night Watch: not running");

    const nw = await fakeNightWatch(port);
    cleanup.push(() => nw.close());
    await until(() => nw.port === port);
    await new Promise((r) => setTimeout(r, 120)); // let it reconnect
    nw.send(state([incident({})]));
    await until(() => client.status() === "up" && client.snapshot().sites.loader?.open === 1);
  });

  it("reconnects after the stream drops, and shows 'not running' in between", async () => {
    const nw = await fakeNightWatch();
    cleanup.push(() => nw.close());
    const client = startWatchClient({ url: `http://127.0.0.1:${nw.port}`, firstWaitMs: 20, maxWaitMs: 40 });
    cleanup.push(() => client.stop());
    await new Promise((r) => setTimeout(r, 60));
    nw.send(state([incident({})]));
    await until(() => client.status() === "up");
    nw.dropAll();
    await until(() => client.status() === "down");
    expect(client.snapshot().sites).toEqual({}); // old news is not shown as live
    await new Promise((r) => setTimeout(r, 120));
    nw.send(state([incident({ id: "i9" })]));
    await until(() => client.snapshot().sites.loader?.open_tickets[0]?.id === "i9");
    expect(client.status()).toBe("up");
  });

  it("skips a damaged frame and keeps the stream", async () => {
    const nw = await fakeNightWatch();
    cleanup.push(() => nw.close());
    const client = startWatchClient({ url: `http://127.0.0.1:${nw.port}`, firstWaitMs: 20 });
    cleanup.push(() => client.stop());
    await new Promise((r) => setTimeout(r, 60));
    nw.send("not an object");
    nw.send(state([incident({})]));
    await until(() => client.snapshot().sites.loader?.open === 1);
  });
});
