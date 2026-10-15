import { realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import {
  PLUGIN_APP_DIR,
  isInsideDir,
  sandboxNodeModulesDir,
} from "./harness-paths.js";

/** Package specifiers only: not relative, absolute, or scheme-prefixed (`virtual:`, `node:`). */
const BARE_IMPORT_RE = /^[\w@][^:]*$/;

export type HarnessResolveRoots = {
  targetRoot: string;
  /** Conversation scratch root holding `harness.json`. Its `node_modules` is the sandbox. */
  scratchRoot: string;
};

type ImporterKind = "target" | "scratch";

/**
 * Vite takes an importer ending in `*` as a file in that directory, so a bare
 * import resolves by the node walk from there.
 */
function importerInDir(dir: string): string {
  return path.join(dir, "*");
}

/**
 * Resolve bare imports from target and scratch files through Vite's own
 * resolver, from the target's installed packages and then the sandbox. A
 * target file walks up from itself; a scratch file resolves as if imported
 * from the target root. When neither supplies the import, the build fails.
 */
export function harnessResolvePlugin(roots: HarnessResolveRoots): Plugin {
  // Vite hands importers with symlinks resolved.
  const targetRoot = realpathSync(roots.targetRoot);
  const scratchRoot = realpathSync(roots.scratchRoot);
  const sandboxNodeModules = sandboxNodeModulesDir(scratchRoot);

  /**
   * Plugin-app files are Storybook's runtime, and sandbox `node_modules`
   * files are installed packages resolving their own dependencies; both keep
   * Vite's resolution.
   */
  function importerKind(importer: string): ImporterKind | null {
    if (isInsideDir(PLUGIN_APP_DIR, importer)) return null;
    if (isInsideDir(sandboxNodeModules, importer)) return null;
    if (isInsideDir(scratchRoot, importer)) return "scratch";
    if (isInsideDir(targetRoot, importer)) return "target";
    return null;
  }

  return {
    name: "harness-resolve",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !BARE_IMPORT_RE.test(source)) return null;
      const importerPath = importer.replace(/[?#].*$/, "");
      const kind = importerKind(importerPath);
      if (kind === null) return null;

      const fromImporters = [
        kind === "target" ? importer : importerInDir(targetRoot),
        importerInDir(scratchRoot),
      ];
      for (const from of fromImporters) {
        const resolved = await this.resolve(source, from, {
          ...options,
          skipSelf: true,
        });
        if (resolved) return resolved;
      }
      this.error({
        id: importerPath,
        message: `${importerPath} imports "${source}", which neither the target nor the mockup sandbox at ${scratchRoot} supplies`,
      });
    },
  };
}
