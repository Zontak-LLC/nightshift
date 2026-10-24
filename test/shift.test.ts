import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { boardPage } from "../src/web/index.js";
import {
  agentSegments,
  agentsWorking,
  durationText,
  finishEstimate,
  hourRows,
  SHIFT,
  type ShiftColumns,
  type ShiftTicket,
  segmentsOf,
  shiftTotals,
} from "../src/web/shift.js";

const at = (hhmm: string) => `2026-10-24T${hhmm}:00.000Z`;
const ticket = (
  number: number,
  station: string,
  from?: string,
  to?: string,
  status: string | null = null,
): ShiftTicket => ({
  number,
  title: `Ticket ${number}`,
  station,
  status,
  startedAt: from ? at(from) : null,
  finishedAt: to ? at(to) : null,
});
const empty = (): ShiftColumns => ({ queued: [], working: [], checking: [], done: [], skipped: [] });

describe("a night's run, in numbers", () => {
  // Started 01:00. Two merged (20 and 40 minutes), one skipped after 10, one working since 02:10, two waiting.
  const night: ShiftColumns = {
    queued: [ticket(7, "queued"), ticket(8, "queued")],
    working: [ticket(6, "working", "02:10", "02:25")],
    checking: [],
    done: [ticket(3, "done", "01:00", "01:20", "merged"), ticket(4, "done", "01:20", "02:00", "plan-posted")],
    skipped: [ticket(5, "skipped", "02:00", "02:10")],
  };

  it("counts what is finished, what is left, the average and the longest", () => {
    const t = shiftTotals(night);
    expect(t).toMatchObject({ done: 2, skipped: 1, merged: 1, total: 6, left: 3 });
    expect(t.avgMs).toBe(((20 + 40 + 10) / 3) * 60_000);
    expect(t.longest).toEqual({ number: 4, ms: 40 * 60_000 });
  });

  it("estimates the finish at the average pace, and says nothing without a pace or with nothing left", () => {
    const now = Date.parse(at("02:30"));
    expect(finishEstimate(30 * 60_000, 3, now)).toBe(now + 90 * 60_000);
    expect(finishEstimate(null, 3, now)).toBeNull();
    expect(finishEstimate(30 * 60_000, 0, now)).toBeNull();
    expect(shiftTotals(empty())).toMatchObject({ total: 0, avgMs: null, longest: null });
  });

  it("writes durations the way the board shows them", () => {
    expect(durationText(7 * 60_000 + 12_000)).toBe("7m 12s");
    expect(durationText(65 * 60_000)).toBe("1h 05m");
    expect(durationText(null)).toBe("–");
    expect(durationText(-5)).toBe("–");
  });

  it("lays the run out by the hour: finished tickets end where they finished, the working one runs to now", () => {
    const now = Date.parse(at("02:30"));
    const segs = segmentsOf(night, now);
    expect(segs.map((s) => [s.num, s.kind])).toEqual([
      [3, "done"],
      [4, "done"],
      [5, "skip"],
      [6, "live"],
    ]);
    expect(segs.at(-1)?.to).toBe(now); // working: until now, not until its last step
    const rows = hourRows(Date.parse(at("01:00")), now, segs);
    expect(rows.map((r) => new Date(r.at).toISOString().slice(11, 16))).toEqual(["01:00", "02:00"]);
    // #4 runs 01:20 to 02:00: two thirds of the first hour, labelled where it starts.
    const four = rows[0]?.bars.find((b) => b.num === 4);
    expect(four).toMatchObject({ first: true });
    expect(four?.left).toBeCloseTo(33.33, 1);
    expect(four?.width).toBeCloseTo(66.67, 1);
    expect(rows[0]?.nowAt).toBeNull();
    expect(rows[1]?.nowAt).toBe(50);
  });

  it("keeps a bar that crosses the hour in both rows, labelled only in the first", () => {
    const now = Date.parse(at("03:10"));
    const rows = hourRows(Date.parse(at("02:40")), now, [
      { num: 9, label: "#9", kind: "live", from: Date.parse(at("02:40")), to: now },
    ]);
    expect(rows.map((r) => r.bars.map((b) => [b.first, Math.round(b.width)]))).toEqual([[[true, 33]], [[false, 17]]]);
  });

  it("shows at most the newest 24 hours, and one empty row before anything ran", () => {
    const now = Date.parse("2026-10-26T05:30:00.000Z");
    expect(hourRows(Date.parse(at("00:00")), now, [])).toHaveLength(24);
    expect(hourRows(now, now, [])).toHaveLength(1);
    expect(segmentsOf({ ...empty(), queued: [ticket(1, "queued")] }, now)).toEqual([]);
  });
});

describe("the page", () => {
  it("is one script that compiles, carries the tested arithmetic and the three views", () => {
    const page = boardPage();
    const script = /<script>([\s\S]*)<\/script>/.exec(page)?.[1] ?? "";
    expect(() => new Script(script)).not.toThrow();
    expect(script).toContain("function hourRows(");
    expect(script.indexOf("var __name")).toBeLessThan(script.indexOf("function shiftTotals("));
    for (const view of ["Board", "Terminal", "Timeline"]) expect(script).toContain(`"${view}"`);
  });

  it("sends the arithmetic as source that gives the same answers in the browser as in these tests", () => {
    const now = Date.parse(at("03:10"));
    const segs = [{ num: 9, label: "#9", kind: "live", from: Date.parse(at("02:40")), to: now }];
    const sent = runInNewContext(
      `${SHIFT}; JSON.stringify([hourRows(${segs[0]?.from}, ${now}, ${JSON.stringify(segs)}), durationText(65 * 60000)])`,
    );
    expect(JSON.parse(sent)).toEqual([hourRows(Date.parse(at("02:40")), now, segs), "1h 05m"]);
  });
});

describe("background agents on the board", () => {
  const agent = (name: string, active: boolean, from: string | null, last: string) => ({
    name,
    active,
    startedAt: from ? at(from) : null,
    lastAt: at(last),
  });
  it("says how many agents are working, in words", () => {
    expect(agentsWorking([])).toBe("");
    expect(agentsWorking([agent("a", false, "01:00", "01:10")])).toBe("");
    expect(agentsWorking([agent("a", true, "01:00", "01:10")])).toBe("1 agent working");
    expect(agentsWorking([agent("a", true, "01:00", "01:10"), agent("b", true, "01:00", "01:10")])).toBe(
      "2 agents working",
    );
  });
  it("draws a working agent up to now and a finished one up to its last step, and skips one that never stepped", () => {
    const now = Date.parse(at("02:00"));
    const segs = agentSegments(
      [
        agent("live", true, "01:00", "01:50"),
        agent("done", false, "01:10", "01:20"),
        agent("none", false, null, "01:00"),
      ],
      now,
    );
    expect(segs).toEqual([
      { num: -1, label: "live", kind: "live", from: Date.parse(at("01:00")), to: now },
      { num: -2, label: "done", kind: "done", from: Date.parse(at("01:10")), to: Date.parse(at("01:20")) },
    ]);
  });
});
