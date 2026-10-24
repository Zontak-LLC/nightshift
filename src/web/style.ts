/**
 * The board's styles. Built to be looked at for hours (the owner, 2026-10-24): a dark grey-blue page, never pure black
 * (bright letters on pure black blur at the edges); soft off-white text, about 12:1, never pure white; a quieter grey
 * for secondary text; thin, quiet lines; colour only where it means something (blue = live, green = done, amber = needs
 * attention). A clean sans for titles, monospace only for machine output (steps, numbers, codes). Function first: the
 * layout is the Norton Commander one (framed areas, titles in the frame, a key bar), nothing is decoration.
 * Fonts already on the computer only: the page fetches nothing from the internet.
 */
export const STYLE = `
:root {
  --bg: #16181d; --panel: #1a1d23; --raise: #22262e; --line: #2b3038; --line-strong: #3a404a;
  --fg: #d4d7dd; --strong: #eceef2; --muted: #8b919c;
  --live: #7aa2f7; --live-soft: rgba(122,162,247,.14);
  --done: #8cc89b; --warn: #e5b567;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 14px/1.5 var(--sans); padding: 16px 20px 20px; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 1600px; margin: 0 auto; display: grid; gap: 14px; }
h1, h2 { margin: 0; font-weight: 600; }
a { color: var(--live); }
:focus-visible { outline: 2px solid var(--live); outline-offset: 2px; }

/* The status line. */
.status { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: baseline; gap: 6px 18px; }
.status .where { grid-column: 1 / -1; }
.field b { font: 600 10.5px var(--sans); letter-spacing: .12em; color: var(--muted); margin-right: 2px; }
.field { color: var(--fg); }
.date { font: 13px var(--sans); color: var(--muted); }
.message { font: 13px var(--mono); color: var(--fg); padding: 2px 2px 0; }
.message.alert { color: var(--warn); font-weight: 600; }
.status-left { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; min-width: 0; }
.status-right { display: flex; align-items: center; gap: 18px; }
.brand { font: 600 13px var(--sans); letter-spacing: .14em; color: var(--muted); }
.proj { font: 600 17px var(--sans); color: var(--strong); }
.where { display: flex; flex-wrap: wrap; gap: 4px 22px; color: var(--muted); font: 12.5px var(--mono); }
.conn { display: inline-flex; align-items: center; gap: 8px; font: 600 11px var(--sans); letter-spacing: .14em; color: var(--muted); }
.conn.off { color: var(--warn); }
.status .clock { font: 600 15px var(--mono); color: var(--strong); font-variant-numeric: tabular-nums; }
/* A status light: one short blink every 3 seconds while live; steady amber while reconnecting. */
.led { width: 8px; height: 8px; border-radius: 50%; background: var(--live); opacity: .35; animation: led 3s ease-in-out infinite; }
.conn.off .led { background: var(--warn); opacity: 1; animation: none; }
@keyframes led { 0%, 86%, 100% { opacity: .35; } 90% { opacity: 1; } }

/* Framed areas with the title set in the frame, like Norton Commander. */
.frame, .col { position: relative; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
.frame-title, .col h2 { position: absolute; top: -0.75em; left: 14px; background: var(--bg); padding: 0 8px;
  font: 600 11px var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.night { padding: 14px 16px 8px; display: grid; gap: 8px; }
.facts { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 4px 16px; }
.meter { font: 13px var(--mono); color: var(--live); white-space: pre; overflow: hidden; min-width: 0; }
.so-far { font: 12.5px var(--mono); color: var(--muted); }
.track { position: relative; height: 16px; }
.rail, .fill { position: absolute; left: 0; top: 7px; height: 2px; border-radius: 2px; }
.rail { right: 0; background: var(--line); }
.fill { background: var(--live); transition: width .9s ease; }
.tick { position: absolute; top: 5px; width: 1px; height: 6px; background: var(--line-strong); }
.landed { position: absolute; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--done); transform: translateX(-4px); }
.landed.pop { animation: pop .4s ease-out; }
.hours { position: relative; height: 14px; font: 11px var(--mono); color: var(--muted); }
.hours span { position: absolute; transform: translateX(-50%); white-space: nowrap; }

.now { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); padding: 6px 0; }
.agent { padding: 8px 16px; min-width: 0; }
.agent + .agent { border-left: 1px solid var(--line); }
.agent .who { font: 600 11px var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agent .what { font: 14px var(--mono); color: var(--strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* The board: five framed columns of one fixed height; a full column scrolls inside itself. */
.board { display: grid; grid-template-columns: repeat(5, minmax(200px, 1fr)); gap: 12px; padding-top: 8px; overflow-x: auto;
  height: clamp(380px, calc(100dvh - 370px), 760px); }
.col { padding: 16px 8px 0; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.col h2 { display: flex; gap: 8px; }
.count { color: var(--fg); font-variant-numeric: tabular-nums; }
.count.roll { animation: roll .4s ease-out; }
.list { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; padding-bottom: 10px; display: flex; flex-direction: column; gap: 2px; }
.list::-webkit-scrollbar { display: none; }
.col.more .list { mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent); }
.more-tag { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); font: 11px var(--mono); color: var(--muted);
  background: var(--raise); border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; pointer-events: none; }

/* Tickets. In progress: a full card. Queued, done, skipped: one line [mark + number] [title] [code]. */
.card { position: relative; display: grid; gap: 4px; padding: 8px 10px; border-radius: 5px; border: 1px solid transparent; cursor: pointer; flex: none; }
.card:hover { background: var(--raise); }
.card:focus-visible { outline: none; border-color: var(--live); }
.card .top { display: flex; align-items: center; gap: 6px; font: 12px var(--mono); color: var(--muted); }
.card .name { color: var(--strong); font-size: 14px; line-height: 1.4; }
.card .step { font: 12.5px var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .step.in { animation: tickIn .3s ease-out; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
.card.working, .card.checking { background: var(--raise); border-color: var(--line); margin-bottom: 6px; }
.card.working .dot { background: var(--live); animation: breathe 2.8s ease-in-out infinite; }
.card.checking .dot { background: var(--warn); }
.card.checking .step { color: var(--warn); }
.card.quiet .dot { background: var(--muted); animation: none; }
.card.quiet .step { color: var(--warn); }
.card.done .dot, .card.skipped .dot { display: none; }
.check { width: 14px; height: 14px; flex: none; }
.check path { fill: none; stroke: var(--done); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 20; }
.check.draw path { animation: draw .5s ease forwards; stroke-dashoffset: 20; }
.card.queued, .card.done, .card.skipped { grid-template-columns: auto minmax(0,1fr) auto; align-items: center; column-gap: 8px; padding: 5px 8px; }
.card.queued > .top, .card.done > .top, .card.skipped > .top { grid-column: 1; grid-row: 1; }
.card.queued > .name, .card.done > .name, .card.skipped > .name { grid-column: 2; grid-row: 1; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); }
.card.queued .step, .card.done .step, .card.skipped .step { display: none; }
.card .code { grid-column: 3; grid-row: 1; font: 11px var(--mono); color: var(--muted); }
.card.working .code, .card.checking .code { display: none; }
.card.skipped > .name { color: var(--muted); }
.card.open { background: var(--raise); border-color: var(--line-strong); }
.card.open > .name { white-space: normal; color: var(--strong); }
.detail { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s ease; grid-column: 1 / -1; grid-row: 2; }
.card.open .detail { grid-template-rows: 1fr; }
.detail-in { overflow: hidden; min-height: 0; }
.detail-in > div { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--line); display: grid; gap: 4px; font-size: 13px; color: var(--fg); }
.detail-in b { color: var(--strong); font-weight: 600; }
.detail-in ol { margin: 0; padding-left: 18px; font: 12px var(--mono); color: var(--muted); }
.detail-in li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* The key bar. */
.keys { display: flex; flex-wrap: wrap; gap: 6px 22px; align-items: center; font: 12px var(--mono); color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; }
.keys b { font: 600 11px var(--mono); color: var(--fg); background: var(--raise); border: 1px solid var(--line-strong); border-radius: 4px; padding: 1px 6px; }
.keys-note { margin-left: auto; }

/* The start page. */
.empty { color: var(--muted); padding: 24px; border: 1px dashed var(--line); border-radius: 6px; }
.projects { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.project { display: grid; gap: 4px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; text-decoration: none; color: var(--fg); }
.project:hover { border-color: var(--live); }
.project b { font: 600 17px var(--sans); color: var(--strong); }
.project span { font: 12.5px var(--mono); color: var(--muted); }
.head h1:not(.brand) { font-size: 22px; }

@keyframes roll { from { transform: translateY(-50%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tickIn { from { transform: translateY(80%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes breathe { 0%,100% { box-shadow: 0 0 0 0 var(--live-soft); } 50% { box-shadow: 0 0 0 4px var(--live-soft); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes pop { from { transform: translateX(-4px) scale(.4); opacity: 0; } to { transform: translateX(-4px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
