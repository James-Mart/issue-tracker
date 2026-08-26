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

let rootDir: string;
let configPath: string;

function writeConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(config), "utf8");
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "harness-config-"));
  configPath = join(rootDir, "harness.json");
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function validConfig(overrides: Record<string, unknown> = {}) {
  const targetRoot = join(rootDir, "target");
  const reactRoot = join(rootDir, "react-node_modules");
  const cssEntry = join(rootDir, "styles.css");
  const aliasDir = join(rootDir, "alias");
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(reactRoot, { recursive: true });
  mkdirSync(aliasDir, { recursive: true });
  writeFileSync(cssEntry, "body {}", "utf8");

  return {
    targetRoot,
    reactRoot,
    cssEntries: [cssEntry],
    aliases: { "@target": aliasDir },
    storiesGlobs: [join(rootDir, "stories", "**", "*.stories.tsx")],
    ...overrides,
  };
}

describe("loadHarnessConfig", () => {
  it("parses a valid configuration", () => {
    writeConfig(validConfig());
    const config = loadHarnessConfig(configPath);
    expect(config.targetRoot).toBe(join(rootDir, "target"));
    expect(config.reactRoot).toBe(join(rootDir, "react-node_modules"));
    expect(config.cssEntries).toHaveLength(1);
    expect(config.aliases["@target"]).toBe(join(rootDir, "alias"));
    expect(config.storiesGlobs).toHaveLength(1);
  });

  it("throws naming a missing required field", () => {
    writeConfig(validConfig({ targetRoot: undefined }));
    expect(() => loadHarnessConfig(configPath)).toThrow(/targetRoot/);
  });

  it("throws naming a relative path field", () => {
    writeConfig(validConfig({ targetRoot: "relative/target" }));
    expect(() => loadHarnessConfig(configPath)).toThrow(
      /targetRoot: relative\/target/,
    );
  });

  it("throws naming an absolute path that does not exist", () => {
    writeConfig(validConfig({ targetRoot: "/tmp/harness-config-missing-target" }));
    expect(() => loadHarnessConfig(configPath)).toThrow(
      /targetRoot: \/tmp\/harness-config-missing-target/,
    );
  });
});
