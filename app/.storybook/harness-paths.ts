import { realpathSync, statSync } from "node:fs";
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

/**
 * Walk directories from `start` upward. A start outside the plugin app stops
 * before that app, so the app's tsconfig and PostCSS config are not the target's.
 * `visit` returns true to stop.
 */
export function walkAncestors(start: string, visit: (dir: string) => boolean): void {
  const real = realpathSync(start);
  let dir = statSync(real).isDirectory() ? real : path.dirname(real);
  const startedInPlugin = isInsideDir(PLUGIN_APP_DIR, dir);
  for (;;) {
    if (!startedInPlugin && isInsideDir(PLUGIN_APP_DIR, dir)) return;
    if (visit(dir)) return;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** First ancestor for which `pick` returns a value. Same stop rule as `walkAncestors`. */
export function findInAncestors<T>(
  start: string,
  pick: (dir: string) => T | undefined,
): T | undefined {
  let found: T | undefined;
  walkAncestors(start, (dir) => {
    found = pick(dir);
    return found !== undefined;
  });
  return found;
}
