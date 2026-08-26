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
  fsAllow: string[];
  viteConfigPath: string | undefined;
};

export function buildHarnessStorybookOptions(
  config: HarnessConfig,
): HarnessStorybookOptions {
  return {
    stories: [...config.storiesGlobs, SMOKE_STORY_GLOB],
    aliases: config.aliases,
    fsAllow: collectFsAllowPaths(config),
    viteConfigPath: config.viteConfigPath,
  };
}
