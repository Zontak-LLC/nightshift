/**
 * The board's styles (ticket 6, the owner's pick, 2026-10-24): the first design's layout (a header of totals, a NOW
 * strip, tabs for Board, Terminal and Timeline, the board as an assembly line with a belt under each station) in the
 * palette built to be looked at for hours: a dark grey-blue page, never pure black; soft off-white text, never pure
 * white; thin, quiet lines. Four colours, each with one meaning: blue = working, green = done, amber = needs you or
 * trouble, grey = queued or skipped. Fonts already on the computer only: the page fetches nothing from the internet.
 */
export const STYLE = `
:root {
  --bg: #16181d; --panel: #1a1d23; --raise: #22262e; --term: #14161a; --line: #2b3038; --line-strong: #3a404a;
  --fg: #d4d7dd; --strong: #eceef2; --muted: #8b919c; --faint: #6b717c;
  --live: #7aa2f7; --live-soft: rgba(122,162,247,.14);
  --done: #8cc89b; --warn: #e5b567; --warn-soft: rgba(229,181,103,.12);
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 14px/1.5 var(--sans); padding: 18px 16px 20px; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
.wrap { max-width: 1440px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
h1, h2, h3, h4 { margin: 0; }
a { color: var(--live); }
:focus-visible { outline: 2px solid var(--live); outline-offset: 2px; }
.eyebrow { font: 600 10px var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }

/* The header: the light, the name and where it runs on the left; the totals and the connection on the right. */
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 20px; }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand h1 { font: 700 clamp(1.25rem, 3vw, 1.6rem)/1.1 var(--sans); color: var(--strong); letter-spacing: -.01em; }
.where { margin-top: 3px; font: 12.5px var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.stats { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; }
.stat { display: flex; flex-direction: column; gap: 1px; }
.stat b { font: 600 15px var(--mono); color: var(--strong); font-variant-numeric: tabular-nums; }
.conn { display: inline-flex; align-items: center; gap: 8px; padding: 5px 11px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); font: 600 11px var(--mono); letter-spacing: .12em; color: var(--live); }
.conn.off { color: var(--warn); }
/* A status light: one short blink every 3 seconds while live; steady amber while reconnecting. */
.led { width: 9px; height: 9px; border-radius: 50%; background: var(--live); flex: none; animation: led 3s ease-in-out infinite; }
.conn .led { width: 8px; height: 8px; }
.conn.off .led, .top.off .brand .led { background: var(--warn); animation: none; }
@keyframes led { 0%, 80%, 100% { opacity: .35; } 88% { opacity: 1; } }

/* NOW: the one thing running, on every tab. Amber when work has stopped. */
.nowbar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--live); min-width: 0; }
.nowbar.idle { border-left-color: var(--line-strong); }
.nowbar.alert { border-left-color: var(--warn); background: var(--warn-soft); }
.nowbar .tag { font: 700 11px var(--mono); letter-spacing: .12em; color: var(--live); flex: none; }
.nowbar.idle .tag { color: var(--muted); }
.nowbar.alert .tag, .nowbar.alert .what { color: var(--warn); }
.nowbar .what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--strong); }
.nowbar .num { color: var(--live); font-family: var(--mono); }
.nowbar .meta { margin-left: auto; display: flex; gap: 14px; flex: none; font: 13px var(--mono); color: var(--muted); }
.nowbar .meta b { color: var(--strong); font-weight: 600; font-variant-numeric: tabular-nums; }
@media (max-width: 640px) { .nowbar { flex-wrap: wrap; } .nowbar .what { white-space: normal; } .nowbar .meta { margin-left: 0; } }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.tabs button { all: unset; cursor: pointer; padding: 8px 14px; font: 600 13px var(--sans); color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button[aria-selected="true"] { color: var(--strong); border-bottom-color: var(--live); }
.tabs button:focus-visible { outline: 2px solid var(--live); outline-offset: 2px; border-radius: 4px; }
.panel[hidden] { display: none !important; }

/* Board: the assembly line. Equal stations; a full one scrolls inside itself; the belt runs along each foot. */
.floor { display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); gap: 10px; overflow-x: auto; height: clamp(380px, calc(100dvh - 250px), 760px); }
.col { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 10px 8px 22px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
.col h2 { display: flex; justify-content: space-between; gap: 8px; padding: 0 4px 7px; margin-bottom: 6px; border-bottom: 1px solid var(--line); font: 600 11px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.count { color: var(--faint); font-variant-numeric: tabular-nums; }
.count.roll { animation: roll .4s ease-out; }
.col.here { border-color: var(--live); } .col.here h2 { color: var(--live); }
.col.passed h2 { color: var(--done); }
.belt { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 4px; border-radius: 2px; background: var(--raise); }
.col.passed .belt { background: rgba(140,200,155,.45); }
.col.here .belt { background: repeating-linear-gradient(-45deg, var(--live) 0 6px, var(--raise) 6px 12px); background-size: 17px 17px; animation: belt .7s linear infinite; }
.col.here.paused, .col.here.paused h2 { border-color: var(--warn); color: var(--warn); }
.col.here.paused .belt { background: var(--warn); animation: none; opacity: .6; }
@keyframes belt { to { background-position: 17px 0; } }
.list { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 6px; padding-bottom: 6px; }
.list::-webkit-scrollbar { display: none; }
.col.more .list { mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent); }
.more-tag { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); font: 11px var(--mono); color: var(--muted); background: var(--raise); border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; pointer-events: none; }

/* Ticket cards: a coloured edge says where each one stands; the one being worked on is bigger and has a clock. */
.card { position: relative; display: grid; gap: 3px; padding: 8px 9px; border-radius: 6px; background: var(--raise); border: 1px solid var(--line); border-left: 3px solid var(--line-strong); cursor: pointer; flex: none; font-size: 12.5px; min-width: 0; }
.card:hover { border-color: var(--line-strong); }
.card:focus-visible { outline: 2px solid var(--live); outline-offset: 1px; }
.card .top { display: flex; justify-content: space-between; gap: 6px; font: 600 11px var(--mono); color: var(--muted); }
.card .name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3; color: var(--fg); }
.card .step, .card .clock { display: none; }
.card.done { border-left-color: var(--done); }
.card.skipped { opacity: .75; }
.card.working, .card.checking { background: var(--live-soft); border-color: var(--live); padding: 11px; animation: hum 2.8s ease-in-out infinite; }
.card.working .top, .card.checking .top { color: var(--live); }
.card.working .name, .card.checking .name { -webkit-line-clamp: 4; font-size: 13.5px; color: var(--strong); }
.card.working .clock, .card.checking .clock { display: block; font: 600 15px var(--mono); color: var(--strong); font-variant-numeric: tabular-nums; }
.card.working .step, .card.checking .step { display: block; font: 12px var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .step.in { animation: tickIn .3s ease-out; }
.card.quiet { border-color: var(--warn); background: var(--warn-soft); animation: none; }
.card.quiet .top, .card.quiet .step { color: var(--warn); }
@keyframes hum { 50% { box-shadow: 0 0 0 2px rgba(122,162,247,.3); } }

/* Terminal: one block per step, newest at the foot, the running one marked. */
.window { display: flex; flex-direction: column; min-height: 460px; height: clamp(460px, calc(100dvh - 250px), 760px); border-radius: 8px; border: 1px solid var(--line); background: var(--term); overflow: hidden; }
.titlebar { display: flex; align-items: center; gap: 10px; padding: 0 12px; height: 38px; flex: none; background: var(--panel); border-bottom: 1px solid var(--line); overflow: hidden; }
.wtab { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 5px; font: 500 12px var(--mono); color: var(--muted); white-space: nowrap; }
.wtab.on { background: var(--raise); color: var(--strong); }
.wtab .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live); }
.titlebar .clock { margin-left: auto; font: 12px var(--mono); color: var(--faint); }
.blocks { flex: 1; overflow-y: auto; padding: 4px 0; }
.banner { padding: 12px 20px; font: 13px/1.6 var(--mono); color: var(--muted); }
.banner b { color: var(--strong); }
.agents { margin-top: 14px; padding: 12px 14px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
.agents h2 { font: 600 11px var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.agents h2 .count { margin-left: 10px; color: var(--live); }
.agent { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-top: 1px solid var(--line); min-width: 0; font-size: 13px; }
.agent .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); flex: none; }
.agent.live .dot { background: var(--live); }
.agent b { color: var(--strong); font-weight: 600; flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent .step { color: var(--muted); font-family: var(--mono); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent .when { margin-left: auto; color: var(--faint); font: 11.5px var(--mono); flex: none; }
.blk { position: relative; padding: 9px 18px 9px 22px; border-top: 1px solid var(--panel); font: 13px/1.6 var(--mono); }
.blk.run { background: var(--live-soft); }
.blk.run::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--live); }
.blk .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; color: var(--faint); }
.blk .prompt { display: flex; gap: 8px; min-width: 0; color: var(--strong); }
.blk .cwd { color: var(--muted); flex: none; } .blk .br { color: var(--live); flex: none; } .blk .car { color: var(--faint); flex: none; }
.blk .cmd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ok { color: var(--done); } .spin { color: var(--live); }
.inputbar { flex: none; display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-top: 1px solid var(--line); background: var(--panel); font: 13px var(--mono); color: var(--muted); min-width: 0; }
.inputbar .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.inputbar .chip { margin-left: auto; padding: 3px 9px; border-radius: 4px; background: var(--raise); font-size: 11.5px; white-space: nowrap; }
.cursor { flex: none; width: 8px; height: 16px; background: var(--fg); animation: blink 1.05s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* Timeline: one row per hour; each ticket a bar; a line for now. */
.timeline { display: flex; flex-direction: column; gap: 14px; padding: 16px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }
.timeline h3 { font-size: 1rem; color: var(--strong); }
.tl-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.tl-sum { display: flex; flex-wrap: wrap; gap: 6px 22px; font: 13px var(--mono); color: var(--muted); }
.tl-sum b { color: var(--strong); font-weight: 600; }
.hours { display: grid; gap: 6px; }
.hr { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; align-items: center; }
.hr > span { font: 500 11px var(--mono); color: var(--faint); text-align: right; }
.hr.head > div { display: grid; grid-template-columns: repeat(4, 1fr); font: 10px var(--mono); color: var(--faint); }
.row { position: relative; height: 30px; border-radius: 4px; background: var(--term); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; }
.row::before { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(25% - 1px), var(--raise) calc(25% - 1px) 25%); }
.bar { position: absolute; top: 4px; bottom: 4px; min-width: 3px; border-radius: 3px; padding: 0 7px; display: flex; align-items: center; font: 600 11px var(--mono); color: var(--term); white-space: nowrap; overflow: hidden; cursor: pointer; }
.bar.done { background: var(--done); } .bar.skip { background: var(--line-strong); color: var(--fg); }
.bar.live { background: repeating-linear-gradient(-45deg, var(--live) 0 6px, #5a7cc0 6px 12px); background-size: 17px 17px; animation: belt .7s linear infinite; }
.nowline { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--strong); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font: 11.5px var(--mono); color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }

/* A ticket opened: what it is, where it stands, its last steps and its pull request. */
dialog { border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--fg); padding: 0; width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); }
dialog::backdrop { background: rgba(10,11,14,.72); }
.dlg { padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 10px; }
.dlg h3 { font-size: 1.2rem; color: var(--strong); line-height: 1.3; }
.dlg p { margin: 0; }
.dlg .close { all: unset; cursor: pointer; align-self: flex-end; font: 600 12px var(--mono); color: var(--muted); padding: 5px 10px; border-radius: 6px; border: 1px solid var(--line); }
.dlg .close:focus-visible { outline: 2px solid var(--live); }
.dlg ol { margin: 0; padding-left: 1.2em; font: 12px var(--mono); color: var(--muted); display: grid; gap: 3px; }
.pill { display: inline-block; font: 600 10.5px var(--mono); padding: 2px 8px; border-radius: 999px; background: var(--raise); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.pill.done { color: var(--done); } .pill.live { color: var(--live); } .pill.warn { color: var(--warn); }

/* The key bar and the start page. */
.keys { display: flex; flex-wrap: wrap; gap: 6px 22px; align-items: center; font: 12px var(--mono); color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; }
.keys b { font: 600 11px var(--mono); color: var(--fg); background: var(--raise); border: 1px solid var(--line-strong); border-radius: 4px; padding: 1px 6px; }
.keys-note { margin-left: auto; }
.empty { color: var(--muted); padding: 24px; border: 1px dashed var(--line); border-radius: 8px; }
.projects { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.project { display: grid; gap: 4px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; text-decoration: none; color: var(--fg); }
.project:hover { border-color: var(--live); }
.project b { font: 600 17px var(--sans); color: var(--strong); }
.project span { font: 12.5px var(--mono); color: var(--muted); }

@media (max-width: 1000px) { .floor { grid-template-columns: repeat(5, minmax(200px, 1fr)); } }
@media (max-width: 560px) {
  .floor { grid-template-columns: minmax(0, 1fr); height: auto; overflow: visible; }
  .col { min-height: 0; } .list { max-height: 50vh; }
  .stats { gap: 6px 14px; }
}
@keyframes roll { from { transform: translateY(-50%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tickIn { from { transform: translateY(80%); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;
