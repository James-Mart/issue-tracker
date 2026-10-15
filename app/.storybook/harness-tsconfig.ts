import { existsSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";
import {
  harnessImporterKind,
  harnessImporterPath,
  prepareHarnessRoots,
  type HarnessResolveRoots,
} from "./harness-importer.js";
import { PLUGIN_APP_DIR, findInAncestors, isInsideDir } from "./harness-paths.js";

/** One `paths` entry from a target tsconfig, with targets resolved from its baseUrl. */
export type TsconfigPath = {
  pattern: string;
  targets: string[];
  configFile: string;
};

/** `paths` patterns and Vite alias keys compare as the text before a trailing wildcard. */
function aliasPrefix(pattern: string): string {
  if (pattern.endsWith("/*")) return pattern.slice(0, -2);
  if (pattern.endsWith("/")) return pattern.slice(0, -1);
  return pattern;
}

function nearestTsconfig(start: string): string | undefined {
  return findInAncestors(start, (dir) => {
    const candidate = path.join(dir, "tsconfig.json");
    return existsSync(candidate) ? candidate : undefined;
  });
}

/** Diagnostic 18003 is "no inputs were found", which a paths-only tsconfig raises. */
const NO_INPUTS = 18003;

function readTsconfigPaths(configFile: string): TsconfigPath[] {
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  if (read.error) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, "\n");
    throw new Error(`${configFile}: ${message}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configFile),
    undefined,
    configFile,
  );
  const fatal = parsed.errors.find(
    (error) => error.category === ts.DiagnosticCategory.Error && error.code !== NO_INPUTS,
  );
  if (fatal) {
    const message = ts.flattenDiagnosticMessageText(fatal.messageText, "\n");
    throw new Error(`${configFile}: ${message}`);
  }
  const paths = parsed.options.paths;
  if (!paths) return [];
  const baseUrl = parsed.options.baseUrl ?? path.dirname(configFile);
  return Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets: targets.map((target) => path.resolve(baseUrl, target)),
    configFile,
  }));
}

function sameTargets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((target, index) => target === right[index]);
}

/** Path text before a `paths` wildcard, with a trailing slash removed. */
function concretePathPrefix(target: string): string {
  const star = target.indexOf("*");
  return (star === -1 ? target : target.slice(0, star)).replace(/\/+$/, "");
}

function assertOutsidePluginApp(mapping: TsconfigPath): void {
  for (const target of mapping.targets) {
    const concrete = concretePathPrefix(target);
    if (concrete.length === 0) continue;
    if (isInsideDir(PLUGIN_APP_DIR, concrete)) {
      throw new Error(
        `tsconfig paths for ${JSON.stringify(mapping.pattern)} in ${mapping.configFile} point inside the plugin app ${PLUGIN_APP_DIR}`,
      );
    }
  }
}

/** Directory Vite may read for one `paths` target. */
function fsAllowDirectory(target: string): string | undefined {
  const concrete = concretePathPrefix(target);
  if (concrete.length > 0 && existsSync(concrete)) {
    return statSync(concrete).isDirectory() ? concrete : path.dirname(concrete);
  }
  const parent = path.dirname(concrete.length > 0 ? concrete : target);
  return existsSync(parent) ? parent : undefined;
}

/**
 * Aliases from `paths` in the nearest tsconfig at or above each authored alias
 * directory and the target root. An authored alias drops a derived pattern
 * with the same prefix. Two tsconfigs that map one pattern differently fail.
 */
export function deriveTsconfigPaths(input: {
  aliasDirs: readonly string[];
  targetRoot: string;
  authoredAliases: Record<string, string>;
}): { paths: TsconfigPath[]; fsAllow: string[] } {
  const authored = new Set(Object.keys(input.authoredAliases).map((key) => aliasPrefix(key)));
  const configFiles = new Set<string>();
  for (const start of [...input.aliasDirs, input.targetRoot]) {
    const found = nearestTsconfig(start);
    if (found !== undefined) configFiles.add(found);
  }

  const byPattern = new Map<string, TsconfigPath>();
  for (const configFile of configFiles) {
    for (const mapping of readTsconfigPaths(configFile)) {
      if (authored.has(aliasPrefix(mapping.pattern))) continue;
      assertOutsidePluginApp(mapping);
      const existing = byPattern.get(mapping.pattern);
      if (existing && !sameTargets(existing.targets, mapping.targets)) {
        throw new Error(
          `tsconfig paths for ${JSON.stringify(mapping.pattern)} differ: ${existing.configFile} and ${configFile}`,
        );
      }
      if (!existing) byPattern.set(mapping.pattern, mapping);
    }
  }

  const paths = [...byPattern.values()];
  const fsAllow = new Set<string>();
  for (const mapping of paths) {
    for (const target of mapping.targets) {
      const dir = fsAllowDirectory(target);
      if (dir !== undefined) fsAllow.add(dir);
    }
  }
  return { paths, fsAllow: [...fsAllow] };
}

function specificity(pattern: string): number {
  const star = pattern.indexOf("*");
  return star === -1 ? pattern.length + 1 : star;
}

/** The `*` capture, or "" for an exact pattern. Undefined when `source` does not match. */
function capture(pattern: string, source: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star === -1) return source === pattern ? "" : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return undefined;
  if (source.length < prefix.length + suffix.length) return undefined;
  return source.slice(prefix.length, source.length - suffix.length);
}

function substitute(target: string, pattern: string, captured: string): string {
  return pattern.includes("*") ? target.replaceAll("*", captured) : target;
}

/**
 * Resolves ids that match a derived tsconfig path. Authored aliases are Vite
 * aliases and run first, so an import they claim never reaches here.
 */
export function harnessTsconfigPlugin(
  paths: readonly TsconfigPath[],
  roots: HarnessResolveRoots,
): Plugin {
  const prepared = prepareHarnessRoots(roots);
  const ordered = [...paths].sort((a, b) => specificity(b.pattern) - specificity(a.pattern));

  return {
    name: "harness-tsconfig-paths",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || ordered.length === 0) return null;
      const importerPath = harnessImporterPath(importer);
      if (importerPath.split(path.sep).includes("node_modules")) return null;
      if (harnessImporterKind(importerPath, prepared) === null) return null;

      let captured = "";
      const matched = ordered.find((mapping) => {
        const value = capture(mapping.pattern, source);
        if (value === undefined) return false;
        captured = value;
        return true;
      });
      if (!matched) return null;
      for (const target of matched.targets) {
        const candidate = substitute(target, matched.pattern, captured);
        const resolved = await this.resolve(candidate, importer, {
          ...options,
          skipSelf: true,
        });
        if (resolved) return resolved;
      }
      this.error({
        id: importerPath,
        message: `${importerPath} imports "${source}", which matches ${matched.pattern} in ${matched.configFile}, but none of its targets resolved`,
      });
    },
  };
}
