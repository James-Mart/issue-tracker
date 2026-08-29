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
// The same walk also fails when a client module can reach a banned package
// (today: `zod`). Validation belongs on the server; the only client modules
// permitted to pull in the schema library are the project-field validators
// listed in `zodAllowlistFor` below.
//
// This check walks the value-import graph from every `src/**` file and fails if
// any of them can reach a module importing a browser-incompatible builtin or a
// banned package. Type-only imports (`import type ...` and inline `import {
// type ... }`) are ignored: they are erased at build.
//
// Run: `npm run lint:boundary` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface AppRoots {
  srcDir: string;
  serverDir: string;
}

function appRoots(appDir: string): AppRoots {
  return {
    srcDir: resolve(appDir, "src"),
    serverDir: resolve(appDir, "server"),
  };
}

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

const BANNED_PACKAGES = new Set(["zod"]);

// Personas and inspiration-apps validators are the only client modules that
// may reach zod — they validate text a human typed on project routes and stay
// off other routes because global chrome does not import them.
function zodAllowlistFor(srcDir: string): Set<string> {
  return new Set([
    resolve(srcDir, "features/issues/lib/personas.ts"),
    resolve(srcDir, "features/issues/lib/inspiration-apps.ts"),
  ]);
}

const isBannedBuiltin = (spec: string) =>
  BANNED_BUILTINS.has(spec.replace(/^node:/, ""));

const isBannedPackage = (spec: string) =>
  BANNED_PACKAGES.has(spec.replace(/^node:/, ""));

export type ClientBoundaryViolation = {
  file: string;
  chain: string[];
};

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

// Resolve an import specifier to an on-disk source file, a banned-package
// sentinel, or null when it is an external package outside the banned set.
function resolveImportTarget(
  spec: string,
  fromFile: string,
  roots: AppRoots,
): string | null {
  if (isBannedPackage(spec)) return `package:${spec.replace(/^node:/, "")}`;

  let base: string;
  if (spec.startsWith("@server/")) base = resolve(roots.serverDir, spec.slice(8));
  else if (spec.startsWith("@/")) base = resolve(roots.srcDir, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;

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

function isTypeOnlyImportStatement(source: string, matchIndex: number): boolean {
  const semi = source.indexOf(";", matchIndex);
  const statement = source.slice(matchIndex, semi === -1 ? undefined : semi + 1);
  if (/^\s*import\s+type\s/m.test(statement)) return true;

  const brace = statement.match(/\{([\s\S]*?)\}/);
  if (!brace) return false;

  const specifiers = brace[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    specifiers.length > 0 && specifiers.every((part) => /^type\s/.test(part))
  );
}

interface ModuleInfo {
  valueImports: string[]; // resolved local files reached via value imports
  bannedBuiltins: string[]; // browser-incompatible builtins imported directly
  bannedPackages: string[]; // banned bare package specifiers imported directly
}

function analyzeModule(
  file: string,
  cache: Map<string, ModuleInfo>,
  roots: AppRoots,
): ModuleInfo {
  const cached = cache.get(file);
  if (cached) return cached;
  const info: ModuleInfo = {
    valueImports: [],
    bannedBuiltins: [],
    bannedPackages: [],
  };
  cache.set(file, info); // set before recursion to tolerate cycles

  const src = readFileSync(file, "utf8");
  // `import ... from "x"` / `export ... from "x"`, plus side-effect `import "x"`.
  const re =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const typeOnly = Boolean(m[1]) || isTypeOnlyImportStatement(src, m.index);
    const spec = m[2];
    if (typeOnly) continue; // erased at build; cannot pull code into the bundle
    if (isBannedBuiltin(spec)) {
      info.bannedBuiltins.push(spec);
      continue;
    }
    const target = resolveImportTarget(spec, file, roots);
    if (target?.startsWith("package:")) {
      info.bannedPackages.push(target.slice("package:".length));
      continue;
    }
    if (target) info.valueImports.push(target);
  }
  return info;
}

// Depth-first search for a value-import path from `file` to a module that
// imports a banned builtin or package. Returns the chain (inclusive) or null.
function findBannedChain(
  file: string,
  cache: Map<string, ModuleInfo>,
  roots: AppRoots,
  zodAllowlist: Set<string>,
): string[] | null {
  const seen = new Set<string>();
  const stack: string[] = [];

  const dfs = (f: string): string[] | null => {
    if (zodAllowlist.has(f)) return null;
    if (seen.has(f)) return null;
    seen.add(f);
    stack.push(f);
    const info = analyzeModule(f, cache, roots);
    if (info.bannedBuiltins.length > 0) {
      return [...stack, `builtin:${info.bannedBuiltins.join(",")}`];
    }
    if (info.bannedPackages.length > 0) {
      return [...stack, `package:${info.bannedPackages.join(",")}`];
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

export function collectClientBoundaryViolations(
  appDir: string = APP_DIR,
): ClientBoundaryViolation[] {
  const roots = appRoots(appDir);
  const zodAllowlist = zodAllowlistFor(roots.srcDir);
  const cache = new Map<string, ModuleInfo>();
  const violations: ClientBoundaryViolation[] = [];

  for (const file of walk(roots.srcDir)) {
    const chain = findBannedChain(file, cache, roots, zodAllowlist);
    if (chain) violations.push({ file, chain });
  }

  return violations.map(({ file, chain }) => ({
    file: relative(appDir, file),
    chain: chain.map((entry) =>
      entry.startsWith("builtin:") || entry.startsWith("package:")
        ? entry
        : relative(appDir, entry),
    ),
  }));
}

function runCli(appDir: string): void {
  const rel = (f: string) => relative(appDir, f);
  const violations = collectClientBoundaryViolations(appDir).map((v) => ({
    file: resolve(appDir, v.file),
    chain: v.chain,
  }));

  if (violations.length === 0) {
    console.log(
      "client-boundary: OK — no src/** file value-imports a browser-incompatible module or banned package.",
    );
    process.exit(0);
  }

  console.error(
    `client-boundary: ${violations.length} client file(s) reach a browser-incompatible (Node builtin) module or banned package via value imports.\n` +
      "Client code must only `import type` from such modules, or the shared value must move to a client-safe module. Only the personas and inspiration-apps validators may reach zod.\n",
  );
  for (const { file, chain } of violations) {
    const pretty = chain
      .map((c) =>
        c.startsWith("builtin:") || c.startsWith("package:")
          ? `[${c}]`
          : c,
      )
      .join("\n    -> ");
    console.error(`  ${rel(file)}\n    -> ${pretty}\n`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runCli(APP_DIR);
}
