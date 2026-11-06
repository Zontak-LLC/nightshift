// Adds a `watchSite` to the lines of a projects.json that have none, for the folders named on the command line:
//   node scripts/fill-watch-sites.mjs ~/.nightshift/projects.json my-app=my-site other-app=other-site
// Made for the move to empty defaults (2026-11-06): a list that relied on the old built-in sites keeps its links.
// It backs the file up first (<file>.bak-<YYYY-MM-DD>), prints it before and after, never drops or reorders a line,
// and keeps every watchSite that is already there (also ""). A second run changes nothing.
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";

const [file, ...pairs] = process.argv.slice(2);
const shown = (path) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);
const fail = (message) => {
  console.error(`fill-watch-sites: ${message}`);
  process.exit(1);
};

if (!file || !pairs.length) fail("usage: fill-watch-sites.mjs <file> <folder=site>...");
const sites = new Map();
for (const pair of pairs) {
  const [folder, site, ...rest] = pair.split("=");
  if (!folder || !site || rest.length) fail(`"${pair}" is not folder=site`);
  sites.set(folder, site);
}
if (!existsSync(file)) fail(`${shown(file)} is missing; nothing changed`);

const before = readFileSync(file, "utf8");
let list;
try {
  list = JSON.parse(before);
} catch (error) {
  fail(`${shown(file)} is not JSON (${error.message}); nothing changed`);
}
if (!Array.isArray(list)) fail(`${shown(file)} is not a list; nothing changed`);

const today = new Date();
const stamp = [today.getFullYear(), today.getMonth() + 1, today.getDate()].map((n) => String(n).padStart(2, "0"));
const backup = `${file}.bak-${stamp.join("-")}`;
if (existsSync(backup)) console.info(`Backup: ${shown(backup)} (already there from earlier today, kept)`);
else {
  copyFileSync(file, backup, constants.COPYFILE_EXCL);
  console.info(`Backup: ${shown(backup)}`);
}
console.info(`Before (${shown(file)}):\n${before.trimEnd()}`);

const added = [];
for (const line of list) {
  if (!line || typeof line !== "object" || typeof line.path !== "string") continue;
  const folder = basename(line.path.replace(/\/+$/, ""));
  if (sites.has(folder) && line.watchSite === undefined) {
    line.watchSite = sites.get(folder);
    added.push(`${folder}=${line.watchSite}`);
  }
}
if (added.length) writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
console.info(`After:\n${readFileSync(file, "utf8").trimEnd()}`);
console.info(added.length ? `Added: ${added.join(", ")}` : "Nothing to add; the file is unchanged.");
