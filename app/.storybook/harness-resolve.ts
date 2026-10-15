import path from "node:path";
import type { Plugin } from "vite";
import {
  BARE_IMPORT_RE,
  harnessImporterKind,
  harnessImporterPath,
  prepareHarnessRoots,
  type HarnessResolveRoots,
} from "./harness-importer.js";
import { isSharedReactImport } from "./harness-react.js";

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
  const prepared = prepareHarnessRoots(roots);

  return {
    name: "harness-resolve",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !BARE_IMPORT_RE.test(source)) return null;
      if (isSharedReactImport(source)) return null;
      const importerPath = harnessImporterPath(importer);
      const kind = harnessImporterKind(importerPath, prepared);
      if (kind === null) return null;

      const fromImporters = [
        kind === "target" ? importer : importerInDir(prepared.targetRoot),
        importerInDir(prepared.scratchRoot),
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
        message: `${importerPath} imports "${source}", which neither the target nor the mockup sandbox at ${prepared.scratchRoot} supplies`,
      });
    },
  };
}
