import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The plugin app Storybook runs from, symlinks resolved.
 * An external target never uses it as source. A target that contains it does,
 * except for `STORYBOOK_CONFIG_DIR`.
 */
export const PLUGIN_APP_DIR = realpathSync(
  fileURLToPath(new URL("..", import.meta.url)),
);

/** This harness's Storybook directory. Never a target source. */
export const STORYBOOK_CONFIG_DIR = path.join(PLUGIN_APP_DIR, ".storybook");

/** Installed packages for this plugin app. Importers here keep Vite's resolution. */
export const PLUGIN_APP_NODE_MODULES = path.join(PLUGIN_APP_DIR, "node_modules");

/** Both paths absolute, compared as given. */
export function isInsideDir(dir: string, file: string): boolean {
  const relative = path.relative(dir, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Directory `realTargetRoot` must not use as source.
 * `realTargetRoot` is already realpathed. An external target excludes the
 * whole plugin app. A target that contains the plugin app excludes only the
 * harness Storybook config directory.
 */
function excludedSourceDir(realTargetRoot: string): string {
  return isInsideDir(realTargetRoot, PLUGIN_APP_DIR) ? STORYBOOK_CONFIG_DIR : PLUGIN_APP_DIR;
}

/** `realTargetRoot` is already realpathed. */
export function isForbiddenTargetSource(realTargetRoot: string, file: string): boolean {
  return isInsideDir(excludedSourceDir(realTargetRoot), file);
}

/** Phrase for a forbidden-source error. `realTargetRoot` is already realpathed. */
export function forbiddenTargetSourcePlace(realTargetRoot: string): string {
  const dir = excludedSourceDir(realTargetRoot);
  return dir === STORYBOOK_CONFIG_DIR
    ? `the Storybook config ${dir}`
    : `the plugin app ${dir}`;
}

/** The conversation scratch root is the directory holding `harness.json`. */
export function harnessScratchRoot(harnessConfigPath: string): string {
  return path.dirname(harnessConfigPath);
}

/** The conversation sandbox's installed packages, beside `harness.json`. */
export function sandboxNodeModulesDir(scratchRoot: string): string {
  return path.join(scratchRoot, "node_modules");
}

/** Directory prefix of a glob pattern (path segment before the first wildcard). */
export function storiesGlobRoot(glob: string): string {
  const wildcardIndex = glob.search(/[*?[{]/);
  if (wildcardIndex === -1) {
    return path.dirname(glob);
  }
  const prefix = glob.slice(0, wildcardIndex).replace(/\/+$/, "");
  return prefix || path.sep;
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
