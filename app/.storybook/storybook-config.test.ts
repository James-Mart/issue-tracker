import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadHarnessConfig } from "./harness-config.js";
import {
  SMOKE_STORY_GLOB,
  buildHarnessStorybookOptions,
  collectFsAllowPaths,
} from "./storybook-config.js";

let rootDir: string;
let configPath: string;

function writeConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config), "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "storybook-config-"));
  configPath = join(rootDir, "harness.json");
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function validConfig(overrides: Record<string, unknown> = {}) {
  const targetRoot = join(rootDir, "target");
  const reactRoot = join(rootDir, "react-node_modules");
  const cssEntry = join(rootDir, "styles", "app.css");
  const aliasDir = join(rootDir, "alias");
  const storiesDir = join(rootDir, "stories");
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(reactRoot, { recursive: true });
  mkdirSync(aliasDir, { recursive: true });
  mkdirSync(storiesDir, { recursive: true });
  mkdirSync(join(rootDir, "styles"), { recursive: true });
  writeFileSync(cssEntry, "body {}", "utf8");

  return {
    targetRoot,
    reactRoot,
    cssEntries: [cssEntry],
    aliases: { "@target": aliasDir },
    storiesGlobs: [join(storiesDir, "**", "*.stories.tsx")],
    ...overrides,
  };
}

describe("buildHarnessStorybookOptions", () => {
  it("derives story globs, aliases, and fs.allow paths from a configuration fixture", () => {
    writeConfig(validConfig());
    const harness = loadHarnessConfig(configPath);
    const options = buildHarnessStorybookOptions(harness);

    expect(options.stories).toEqual([
      join(rootDir, "stories", "**", "*.stories.tsx"),
      SMOKE_STORY_GLOB,
    ]);
    expect(options.aliases).toEqual({ "@target": join(rootDir, "alias") });

    const fsAllow = collectFsAllowPaths(harness);
    expect(fsAllow).toContain(join(rootDir, "target"));
    expect(fsAllow).toContain(join(rootDir, "stories"));
    expect(fsAllow).toContain(join(rootDir, "styles"));
    expect(options.fsAllow).toEqual(fsAllow);
  });
});
