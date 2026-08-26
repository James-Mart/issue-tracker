import path from "node:path";
import type { HarnessConfig } from "./harness-config.js";

/** Committed harness smoke story — always included when a target config is loaded. */
export const SMOKE_STORY_GLOB = "./*.stories.@(ts|tsx)";

/** Directory prefix of a glob pattern (path segment before the first wildcard). */
export function storiesGlobRoot(glob: string): string {
  const wildcardIndex = glob.search(/[*?[{]/);
  if (wildcardIndex === -1) {
    return path.dirname(glob);
  }
  const prefix = glob.slice(0, wildcardIndex).replace(/\/+$/, "");
  return prefix || path.sep;
}

export function collectFsAllowPaths(config: HarnessConfig): string[] {
  const paths = new Set<string>([config.targetRoot]);
  for (const glob of config.storiesGlobs) {
    paths.add(storiesGlobRoot(glob));
  }
  for (const entry of config.cssEntries) {
    paths.add(path.dirname(entry));
  }
  return [...paths];
}

export type HarnessStorybookOptions = {
  stories: string[];
  aliases: Record<string, string>;
  reactAliases: Record<string, string>;
  cssEntries: string[];
  fsAllow: string[];
  viteConfigPath: string | undefined;
};

/** One React resolution root so the preview and target components share an instance. */
export function buildReactAliases(reactRoot: string): Record<string, string> {
  return {
    react: path.join(reactRoot, "react"),
    "react-dom": path.join(reactRoot, "react-dom"),
    "react/jsx-runtime": path.join(reactRoot, "react/jsx-runtime"),
  };
}

/** Source for the virtual module preview.ts imports — one import per cssEntries path, in order. */
export function harnessCssModuleSource(cssEntries: string[]): string {
  return cssEntries.map((entry) => `import ${JSON.stringify(entry)};`).join("\n");
}

export const HARNESS_CSS_VIRTUAL_ID = "virtual:harness-css";

export function buildHarnessStorybookOptions(
  config: HarnessConfig,
): HarnessStorybookOptions {
  return {
    stories: [...config.storiesGlobs, SMOKE_STORY_GLOB],
    aliases: config.aliases,
    reactAliases: buildReactAliases(config.reactRoot),
    cssEntries: config.cssEntries,
    fsAllow: collectFsAllowPaths(config),
    viteConfigPath: config.viteConfigPath,
  };
}
