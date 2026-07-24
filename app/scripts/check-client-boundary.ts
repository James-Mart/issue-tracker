#!/usr/bin/env -S npx tsx
// Static import-boundary lint.
//
// The client bundle (`src/**`) runs in the browser, where Vite externalizes
// Node builtins like `fs`. If a client module *value*-imports a server module
// that (directly or transitively) pulls in such a builtin, the browser throws
// while evaluating the module and the whole app fails to mount — a failure that
// Node-side unit tests never see (see git log: "Keep merge-base display
// constants out of the client bundle").
//
// This check walks the value-import graph from every `src/**` file and fails if
// any of them can reach a module importing a browser-incompatible builtin.
// Type-only imports (`import type ...`) are ignored: they are erased at build.
//
// Run: `npm run lint:boundary` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = resolve(APP_DIR, "src");
const SERVER_DIR = resolve(APP_DIR, "server");

// Node builtins Vite externalizes for the browser. A client-reachable module
// importing any of these is the bug this lint exists to prevent.
const BANNED_BUILTINS = new Set([
  "fs",
  "fs/promises",
  "path",
  "os",
  "net",
  "http",
  "https",
  "crypto",
  "child_process",
  "stream",
  "zlib",
]);
const isBanned = (spec: string) =>
  BANNED_BUILTINS.has(spec.replace(/^node:/, ""));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Resolve an import specifier to an on-disk source file, or null when it is an
// external package / bare builtin (i.e. not part of this app's own graph).
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@server/")) base = resolve(SERVER_DIR, spec.slice(8));
  else if (spec.startsWith("@/")) base = resolve(SRC_DIR, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // external package or builtin

  const stripped = base.replace(/\.js$/, ""); // server uses ESM `.js` specifiers
  const candidates = [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    resolve(stripped, "index.ts"),
    resolve(stripped, "index.tsx"),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* not this candidate */
    }
  }
  return null;
}

interface ModuleInfo {
  valueImports: string[]; // resolved local files reached via value imports
  bannedBuiltins: string[]; // browser-incompatible builtins imported directly
}

const cache = new Map<string, ModuleInfo>();

function analyze(file: string): ModuleInfo {
  const cached = cache.get(file);
  if (cached) return cached;
  const info: ModuleInfo = { valueImports: [], bannedBuiltins: [] };
  cache.set(file, info); // set before recursion to tolerate cycles

  const src = readFileSync(file, "utf8");
  // `import ... from "x"` / `export ... from "x"`, plus side-effect `import "x"`.
  const re =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const typeOnly = Boolean(m[1]);
    const spec = m[2];
    if (typeOnly) continue; // erased at build; cannot pull code into the bundle
    if (isBanned(spec)) {
      info.bannedBuiltins.push(spec);
      continue;
    }
    const target = resolveLocal(spec, file);
    if (target) info.valueImports.push(target);
  }
  return info;
}

// Depth-first search for a value-import path from `file` to a module that
// imports a banned builtin. Returns the chain (inclusive) or null.
function findBannedChain(file: string): string[] | null {
  const seen = new Set<string>();
  const stack: string[] = [];

  const dfs = (f: string): string[] | null => {
    if (seen.has(f)) return null;
    seen.add(f);
    stack.push(f);
    const info = analyze(f);
    if (info.bannedBuiltins.length > 0) {
      return [...stack, `builtin:${info.bannedBuiltins.join(",")}`];
    }
    for (const dep of info.valueImports) {
      const hit = dfs(dep);
      if (hit) return hit;
    }
    stack.pop();
    return null;
  };

  return dfs(file);
}

const rel = (f: string) => relative(APP_DIR, f);

const violations: { file: string; chain: string[] }[] = [];
for (const file of walk(SRC_DIR)) {
  const chain = findBannedChain(file);
  if (chain) violations.push({ file, chain });
}

if (violations.length === 0) {
  console.log(
    "client-boundary: OK — no src/** file value-imports a browser-incompatible module.",
  );
  process.exit(0);
}

console.error(
  `client-boundary: ${violations.length} client file(s) reach a browser-incompatible (Node builtin) module via value imports.\n` +
    "Client code must only `import type` from such modules, or the shared value must move to a client-safe module.\n",
);
for (const { file, chain } of violations) {
  const pretty = chain
    .map((c) => (c.startsWith("builtin:") ? `[${c}]` : rel(c)))
    .join("\n    -> ");
  console.error(`  ${rel(file)}\n    -> ${pretty}\n`);
}
process.exit(1);
