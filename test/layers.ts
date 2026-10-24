import { dirname, posix } from "node:path";

/**
 * The layer rule (SPEC section 7): watcher -> parser -> store -> server -> web, each layer importing only those listed.
 * A pure function over { path, text } so test/architecture.test.ts can feed it real files AND deliberately bad ones.
 */
export const LAYERS: Record<string, string[]> = {
  parser: [],
  watcher: ["parser"],
  store: ["parser"],
  server: ["store", "parser", "web"],
  web: [],
};

/** Node modules a pure layer may use. Anything else (fs, net, http, child_process, sqlite, ...) is not pure. */
const PURE_NODE = new Set(["node:path", "path"]);
const PURE_LAYERS = new Set(["parser", "web"]);

const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\(\s*)["']([^"']+)["']/g;

/** Every import in a file, with comments removed so a word in a comment is never read as an import. */
export function importsOf(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? "");
}

/** The top-level folder under src/ that a relative import points at ("parser", "cli.js", ...). */
function targetTop(fromFile: string, spec: string): string | null {
  const resolved = posix.normalize(posix.join(dirname(fromFile).split("\\").join("/"), spec));
  const m = /^src\/([^/]+)/.exec(resolved);
  return m?.[1] ?? null;
}

/** What is wrong with one import of a file in `layer`, or null when it is fine. */
function checkImport(path: string, layer: string, spec: string): string | null {
  const allowed = LAYERS[layer] ?? [];
  if (spec.startsWith(".")) {
    const top = targetTop(path, spec);
    if (!top || top === layer || allowed.includes(top)) return null;
    return `${path} imports ${spec} (${layer} may use: ${allowed.join(", ") || "nothing"})`;
  }
  return PURE_LAYERS.has(layer) && !PURE_NODE.has(spec) ? `${path} imports ${spec} (${layer} must stay pure)` : null;
}

export function layerViolations(files: { path: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { path, text } of files) {
    const layer = /^src\/([^/]+)\//.exec(path)?.[1];
    if (!layer || !(layer in LAYERS)) continue;
    for (const spec of importsOf(text)) {
      const problem = checkImport(path, layer, spec);
      if (problem) out.push(problem);
    }
    if (PURE_LAYERS.has(layer) && /\bfetch\s*\(/.test(text)) out.push(`${path} calls fetch (${layer} must stay pure)`);
  }
  return out;
}
