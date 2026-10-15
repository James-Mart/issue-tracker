import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../../cli-story-worktree.test-fixtures.js";
import { assertPluginAppManifestClean } from "./mockup-app-manifest.js";

let dir: string;

function initPluginCheckout(): string {
  const repo = mkdtempSync(join(dir, "plugin-"));
  git(repo, ["init", "-b", "main"]);
  const app = join(repo, "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package.json"), '{"name":"app"}\n');
  writeFileSync(join(app, "package-lock.json"), '{"lockfileVersion":3}\n');
  git(repo, ["add", "app"]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-manifest-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("assertPluginAppManifestClean", () => {
  it("names dirty files and points at mockup-deps", async () => {
    const checkout = initPluginCheckout();
    writeFileSync(
      join(checkout, "app", "package.json"),
      '{"name":"app","dependencies":{"left-pad":"1.0.0"}}\n',
    );
    await expect(assertPluginAppManifestClean(checkout)).rejects.toThrow(
      /package\.json.*mockup-deps/s,
    );
  });
});
