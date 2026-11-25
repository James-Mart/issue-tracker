import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import Module, { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcssrc from "postcss-load-config";
import type { ProcessOptions } from "postcss";
import { BARE_IMPORT_RE } from "./harness-importer.js";
import { findInAncestors, isForbiddenTargetSource } from "./harness-paths.js";

const TAILWIND_HELPER = fileURLToPath(new URL("./harness-tailwind.cjs", import.meta.url));

/**
 * postcss-load-config's search order. That package does not export the list.
 * Discovery stays here so entries that disagree fail before a config is loaded.
 */
const POSTCSS_SEARCH_PLACES = [
  "package.json",
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.mts",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
] as const;

const TAILWIND_CONFIG_FILES = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.cts",
  "tailwind.config.mts",
] as const;

type ResolveFilename = (
  request: string,
  parent: NodeJS.Module | null | undefined,
  isMain: boolean,
  options?: { paths?: string[] },
) => string;

const moduleInternals = Module as typeof Module & {
  _resolveFilename: ResolveFilename;
  _nodeModulePaths: (from: string) => string[];
};

function parentModule(fromFile: string): NodeJS.Module {
  const parent = new Module(fromFile);
  parent.filename = fromFile;
  parent.paths = moduleInternals._nodeModulePaths(path.dirname(fromFile));
  return parent;
}

function missingPlugin(specifier: string, configFile: string, scratchRoot: string): Error {
  return new Error(
    `${configFile} loads PostCSS plugin ${JSON.stringify(specifier)}, which neither the target nor the mockup sandbox at ${scratchRoot} supplies`,
  );
}

/** An allowed install of `specifier` from `parentFile`, or undefined when that parent does not supply one. */
function resolveAllowedPackage(
  specifier: string,
  parentFile: string,
  realTargetRoot: string,
  original: ResolveFilename,
): string | undefined {
  try {
    const resolved = original.call(Module, specifier, parentModule(parentFile), false);
    if (!isForbiddenTargetSource(realTargetRoot, realpathSync(resolved))) return resolved;
    return undefined;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "MODULE_NOT_FOUND") throw err;
    return undefined;
  }
}

function resolvePackage(
  specifier: string,
  configFile: string,
  scratchRoot: string,
  realTargetRoot: string,
  original: ResolveFilename,
): string {
  const fromConfig = resolveAllowedPackage(specifier, configFile, realTargetRoot, original);
  if (fromConfig !== undefined) return fromConfig;
  const fromScratch = resolveAllowedPackage(
    specifier,
    path.join(scratchRoot, "package.json"),
    realTargetRoot,
    original,
  );
  if (fromScratch !== undefined) return fromScratch;
  throw missingPlugin(specifier, configFile, scratchRoot);
}

function packageDeclaresPostcss(file: string): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${file}: ${message}`);
  }
  if (typeof raw !== "object" || raw === null) return false;
  return Object.hasOwn(raw, "postcss") && (raw as { postcss?: unknown }).postcss != null;
}

function configInDir(dir: string, places: readonly string[]): string | undefined {
  for (const place of places) {
    const candidate = path.join(dir, place);
    if (!existsSync(candidate)) continue;
    if (place === "package.json") {
      if (packageDeclaresPostcss(candidate)) return candidate;
      continue;
    }
    // postcss-load-config ignores an empty search place and keeps walking.
    if (readFileSync(candidate, "utf8").trim() === "") continue;
    return candidate;
  }
  return undefined;
}

function nearestConfig(start: string, places: readonly string[]): string | undefined {
  return findInAncestors(start, (dir) => configInDir(dir, places));
}

function filePathFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const clean = url.split("?")[0] ?? url;
  if (!clean.startsWith("file:")) return undefined;
  return fileURLToPath(clean);
}

function sameFile(left: string, right: string): boolean {
  return realpathSync(left) === realpathSync(right);
}

function tailwindWrapperFile(
  realEntry: string,
  nearest: string | undefined,
  configDir: string,
): string {
  const key = createHash("sha256")
    .update(JSON.stringify({ realEntry, nearest, configDir }))
    .digest("hex")
    .slice(0, 16);
  const dir = path.join(tmpdir(), "issue-tracker-harness-tailwind");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.cjs`);
  const source = `module.exports = require(${JSON.stringify(TAILWIND_HELPER)}).createWrappedTailwind(${JSON.stringify(
    { realEntry, nearest: nearest ?? null, configDir },
  )});\n`;
  writeFileSync(file, source);
  return file;
}

type ResolveSession = {
  configFile: string;
  scratchRoot: string;
  targetRoot: string;
  nearestTailwind: string | undefined;
  original: ResolveFilename;
};

function resolvedSpecifier(session: ResolveSession, specifier: string): string {
  const resolved = resolvePackage(
    specifier,
    session.configFile,
    session.scratchRoot,
    session.targetRoot,
    session.original,
  );
  if (specifier !== "tailwindcss") return resolved;
  return tailwindWrapperFile(
    resolved,
    session.nearestTailwind,
    path.dirname(session.configFile),
  );
}

async function withPluginResolve<T>(
  configFile: string,
  scratchRoot: string,
  targetRoot: string,
  load: () => Promise<T>,
): Promise<T> {
  const session: ResolveSession = {
    configFile: realpathSync(configFile),
    scratchRoot: realpathSync(scratchRoot),
    targetRoot: realpathSync(targetRoot),
    nearestTailwind: nearestConfig(configFile, TAILWIND_CONFIG_FILES),
    original: moduleInternals._resolveFilename,
  };
  moduleInternals._resolveFilename = function (request, parent, isMain, options) {
    const parentFile = parent?.filename;
    if (
      parentFile !== undefined &&
      BARE_IMPORT_RE.test(request) &&
      sameFile(parentFile, session.configFile)
    ) {
      return resolvedSpecifier(session, request);
    }
    return session.original.call(this, request, parent, isMain, options);
  };
  let hooks: ReturnType<typeof registerHooks> | undefined;
  try {
    hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const parentFile = filePathFromUrl(context.parentURL);
        if (
          parentFile === undefined ||
          !BARE_IMPORT_RE.test(specifier) ||
          !sameFile(parentFile, session.configFile)
        ) {
          return nextResolve(specifier, context);
        }
        return {
          url: pathToFileURL(resolvedSpecifier(session, specifier)).href,
          shortCircuit: true,
        };
      },
    });
    return await load();
  } finally {
    hooks?.deregister();
    moduleInternals._resolveFilename = session.original;
  }
}

/**
 * The PostCSS config shared by every CSS entry, or undefined when none of
 * them has one. Entries that reach different configs fail, naming each.
 */
export function resolveTargetPostcssConfig(cssEntries: readonly string[]): string | undefined {
  const groups = new Map<string, string[]>();
  for (const entry of cssEntries) {
    const configFile = nearestConfig(entry, POSTCSS_SEARCH_PLACES);
    const key = configFile ?? "none";
    const entries = groups.get(key);
    if (entries) entries.push(entry);
    else groups.set(key, [entry]);
  }
  if (groups.size === 0) return undefined;
  if (groups.size > 1) {
    const described = [...groups].map(([configFile, entries]) => {
      const label = configFile === "none" ? "none" : configFile;
      return `${label} (${entries.join(", ")})`;
    });
    throw new Error(
      `cssEntries reach different PostCSS configs: ${described.join(" and ")}`,
    );
  }
  const [only] = [...groups.keys()];
  return only === "none" ? undefined : only;
}

export type HarnessPostcss = ProcessOptions & {
  plugins: postcssrc.ResultPlugin[];
};

/**
 * Plugins for Vite's `css.postcss`. No target config is an empty list so Vite
 * does not search from the plugin app and run that app's pipeline.
 * Plugin packages resolve from the target, then the sandbox. A package inside
 * the plugin app is the target's when `targetRoot` contains that app.
 */
export async function loadHarnessPostcss(
  configFile: string | undefined,
  scratchRoot: string,
  targetRoot: string,
): Promise<HarnessPostcss> {
  if (configFile === undefined) return { plugins: [] };
  const result = await withPluginResolve(configFile, scratchRoot, targetRoot, () =>
    postcssrc({}, path.dirname(configFile)),
  );
  if (!sameFile(result.file, configFile)) {
    throw new Error(`PostCSS config at ${configFile} loaded ${result.file} instead`);
  }
  // postcss-load-config copies its search context onto the options. `cwd` is
  // process.cwd() — the plugin app while Storybook runs — and would send
  // Tailwind's content and config lookup there.
  const { cwd: _cwd, env: _env, ...options } = result.options as ProcessOptions & {
    cwd?: unknown;
    env?: unknown;
  };
  return { ...options, plugins: result.plugins };
}
