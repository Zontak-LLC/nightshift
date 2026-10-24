import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { parseMeter, readMeter, startMeter } from "../src/meter.js";
import { boardPage } from "../src/web/index.js";
import { meterView, SHIFT } from "../src/web/shift.js";

const NOW = Date.parse("2026-10-24T06:00:00Z");
const file = (o: Record<string, unknown>) => JSON.stringify({ five_hour: 31, seven_day: 52, ...o });

describe("reading the usage file", () => {
  it("reads the two percentages, the reset time and when it was written", () => {
    const text = file({ five_hour_resets_at: 1792838400, updated: "2026-10-24T05:58:00Z" });
    expect(parseMeter(text)).toEqual({
      five_hour: 31,
      seven_day: 52,
      five_hour_resets_at: 1792838400,
      updated: "2026-10-24T05:58:00Z",
    });
  });

  it("keeps what is usable and clamps what is not sensible", () => {
    expect(parseMeter(file({ five_hour: 140, seven_day: -3 }))).toMatchObject({ five_hour: 100, seven_day: 0 });
    expect(parseMeter(file({ five_hour: "lots" }))).toMatchObject({ five_hour: null, seven_day: 52 });
    expect(parseMeter(file({ updated: "yesterday-ish" }))).toMatchObject({ updated: null });
  });

  it.each(["", "not json", "[]", "null", "42", "{}", '{"five_hour":"x"}'])("shows nothing for %j", (text) => {
    expect(parseMeter(text)).toBeNull();
  });
});

describe("the meters in the header", () => {
  const bars = (o: Record<string, unknown>, now = NOW) => meterView(parseMeter(file(o)), now);

  it("draws 10 segments per meter and labels them 5 h and Week", () => {
    const v = bars({ five_hour_resets_at: NOW / 1000 + 2400, updated: new Date(NOW - 60_000).toISOString() });
    expect(v?.stale).toBe(false);
    expect(v?.bars).toEqual([
      { label: "5 h", pct: 31, on: 3, level: "ok", resetsAt: NOW + 2400_000 },
      { label: "Week", pct: 52, on: 5, level: "ok", resetsAt: null },
    ]);
  });

  it.each([
    [74, "ok"],
    [75, "amber"],
    [89, "amber"],
    [90, "red"],
    [100, "red"],
  ])("a meter at %i%% is %s (amber from 75, red from 90)", (pct, level) => {
    expect(
      bars({ five_hour: pct, seven_day: pct, updated: new Date(NOW).toISOString() })?.bars.map((b) => b.level),
    ).toEqual([level, level]);
  });

  it("goes stale after 15 minutes, or when the file does not say when it was written", () => {
    const at = (min: number) => bars({ updated: new Date(NOW - min * 60_000).toISOString() })?.stale;
    expect([at(14), at(15), at(16)]).toEqual([false, false, true]);
    expect(bars({})?.stale).toBe(true);
  });

  it("leaves out a reset time that has passed, and a meter the file does not have", () => {
    expect(bars({ five_hour_resets_at: NOW / 1000 - 5 })?.bars[0]?.resetsAt).toBeNull();
    expect(bars({ five_hour: null })?.bars.map((b) => b.label)).toEqual(["Week"]);
    expect(meterView(null, NOW)).toBeNull();
  });

  it("is the same code in the page as here", () => {
    const m = parseMeter(file({ updated: new Date(NOW).toISOString() }));
    const inPage = runInNewContext(`${SHIFT}; JSON.stringify(meterView(${JSON.stringify(m)}, ${NOW}))`);
    expect(JSON.parse(inPage)).toEqual(meterView(m, NOW));
    expect(boardPage()).toContain("renderMeters");
  });
});

describe("a developer's usage file changes while Night Shift runs", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is hidden while the file is missing, shows once it exists, and follows its changes", async () => {
    dir = mkdtempSync(join(tmpdir(), "nightshift-meter-"));
    const path = join(dir, "usage-now.json");
    expect(readMeter(path)).toBeNull();
    const meter = startMeter(path, 30);
    expect(meter.current()).toBeNull();
    writeFileSync(path, file({ five_hour: 80 }));
    await new Promise((r) => setTimeout(r, 120));
    expect(meter.current()?.five_hour).toBe(80);
    writeFileSync(path, "{ half written");
    await new Promise((r) => setTimeout(r, 120));
    expect(meter.current()).toBeNull();
    meter.stop();
  });
});
