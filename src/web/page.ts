import { CLIENT } from "./client.js";
import { STYLE } from "./style.js";

/** The one page Night Shift serves: the start page at "/" and a project's board at "/<project>" (the script decides). */
export function boardPage(watchUrl = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Night Shift</title>
<meta name="nightwatch-url" content="${watchUrl.replace(/[^\w:/.[\]-]/g, "")}">
<style>${STYLE}</style>
</head>
<body>
<main class="wrap" id="app"><p class="empty">Connecting to Night Shift…</p></main>
<script>${CLIENT}</script>
</body>
</html>`;
}
