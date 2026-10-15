import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The plugin app Storybook runs from, symlinks resolved. Never a source for
 * target or scratch imports.
 */
export const PLUGIN_APP_DIR = realpathSync(
  fileURLToPath(new URL("..", import.meta.url)),
);

/** Both paths absolute, compared as given. */
export function isInsideDir(dir: string, file: string): boolean {
  const relative = path.relative(dir, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** The conversation scratch root is the directory holding `harness.json`. */
export function harnessScratchRoot(harnessConfigPath: string): string {
  return path.dirname(harnessConfigPath);
}

/** The conversation sandbox's installed packages, beside `harness.json`. */
export function sandboxNodeModulesDir(scratchRoot: string): string {
  return path.join(scratchRoot, "node_modules");
}
