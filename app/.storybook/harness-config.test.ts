import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadHarnessConfig } from "./harness-config.js";
import { PLUGIN_APP_DIR } from "./harness-paths.js";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it("allows a plugin-app source alias when the target contains that app", () => {
  root = mkdtempSync(path.join(tmpdir(), "issue-tracker-harness-config-"));
  const source = path.join(PLUGIN_APP_DIR, "src");
  const configPath = path.join(root, "harness.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      targetRoot: path.dirname(PLUGIN_APP_DIR),
      cssEntries: [],
      aliases: { "@ui": source },
      storiesGlobs: ["stories"],
    }),
  );
  expect(loadHarnessConfig(configPath).aliases["@ui"]).toBe(source);
});
