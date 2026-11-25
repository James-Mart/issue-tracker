import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isForbiddenTargetSource, sandboxNodeModulesDir } from "./harness-paths.js";

/** Packages that must resolve as one installed copy for the preview and the target. */
export const REACT_PACKAGES = ["react", "react-dom"] as const;

/** True for `react`, `react-dom`, and their subpaths. Those stay on the React aliases. */
export function isSharedReactImport(source: string): boolean {
  return REACT_PACKAGES.some(
    (name) => source === name || source.startsWith(`${name}/`),
  );
}

/** One React resolution root so the preview and target components share an instance. */
export function buildReactAliases(reactRoot: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of REACT_PACKAGES) {
    aliases[name] = path.join(reactRoot, name);
  }
  aliases["react/jsx-runtime"] = path.join(reactRoot, "react/jsx-runtime");
  return aliases;
}

/**
 * `node_modules` that holds an installed `react` and `react-dom`, or null
 * when either package is missing or is forbidden target source.
 */
function installedReactRoot(modulesDir: string, targetRoot: string): string | null {
  for (const name of REACT_PACKAGES) {
    const pkgDir = path.join(modulesDir, name);
    if (!existsSync(path.join(pkgDir, "package.json"))) return null;
    if (isForbiddenTargetSource(targetRoot, realpathSync(pkgDir))) return null;
  }
  return modulesDir;
}

/**
 * Nearest installed React a component in `start` would resolve by walking
 * up through `node_modules`. An external target skips the plugin app's copy.
 * A target that contains the plugin app uses that copy — it is the target's.
 */
function reactRootFrom(start: string, targetRoot: string): string | null {
  const real = realpathSync(start);
  let dir = statSync(real).isDirectory() ? real : path.dirname(real);
  for (;;) {
    if (isForbiddenTargetSource(targetRoot, dir)) return null;
    const found = installedReactRoot(path.join(dir, "node_modules"), targetRoot);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Node_modules directory for the one React the harness aliases.
 * An installed copy under an authored alias directory wins, then one under
 * the target root, then the mockup sandbox's node_modules.
 */
export function resolveReactRoot(input: {
  aliases: Record<string, string>;
  targetRoot: string;
  scratchRoot: string;
}): string | null {
  const targetRoot = realpathSync(input.targetRoot);
  for (const aliasPath of Object.values(input.aliases)) {
    const found = reactRootFrom(aliasPath, targetRoot);
    if (found) return found;
  }
  const fromTarget = reactRootFrom(targetRoot, targetRoot);
  if (fromTarget) return fromTarget;
  return installedReactRoot(sandboxNodeModulesDir(input.scratchRoot), targetRoot);
}
