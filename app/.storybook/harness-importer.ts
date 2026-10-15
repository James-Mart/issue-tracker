import { realpathSync } from "node:fs";
import { PLUGIN_APP_DIR, isInsideDir, sandboxNodeModulesDir } from "./harness-paths.js";

/** Package specifiers only: not relative, absolute, or scheme-prefixed (`virtual:`, `node:`). */
export const BARE_IMPORT_RE = /^[\w@][^:]*$/;

/** Vite importers may carry a query or hash; path checks use the file path. */
export function harnessImporterPath(importer: string): string {
  return importer.replace(/[?#].*$/, "");
}

export type HarnessResolveRoots = {
  targetRoot: string;
  /** Conversation scratch root holding `harness.json`. Its `node_modules` is the sandbox. */
  scratchRoot: string;
};

export type ImporterKind = "target" | "scratch";

export type PreparedHarnessRoots = {
  targetRoot: string;
  scratchRoot: string;
  sandboxNodeModules: string;
};

/** Real paths Vite will hand back as importers, plus the sandbox's `node_modules`. */
export function prepareHarnessRoots(roots: HarnessResolveRoots): PreparedHarnessRoots {
  const targetRoot = realpathSync(roots.targetRoot);
  const scratchRoot = realpathSync(roots.scratchRoot);
  return {
    targetRoot,
    scratchRoot,
    sandboxNodeModules: sandboxNodeModulesDir(scratchRoot),
  };
}

/**
 * Plugin-app files are Storybook's runtime, and sandbox `node_modules`
 * files are installed packages resolving their own dependencies; both keep
 * Vite's resolution.
 */
export function harnessImporterKind(
  importer: string,
  roots: PreparedHarnessRoots,
): ImporterKind | null {
  if (isInsideDir(PLUGIN_APP_DIR, importer)) return null;
  if (isInsideDir(roots.sandboxNodeModules, importer)) return null;
  if (isInsideDir(roots.scratchRoot, importer)) return "scratch";
  if (isInsideDir(roots.targetRoot, importer)) return "target";
  return null;
}
