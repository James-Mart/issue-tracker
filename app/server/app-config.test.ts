import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readAppConfig, writeBackupConfig } from "./app-config.js";
import { appConfigPath, refreshStorePathsFromEnv } from "./config.js";

let storeRoots: string[] = [];
let savedIssuesDir: string | undefined;

afterEach(() => {
  if (savedIssuesDir === undefined) {
    delete process.env.ISSUES_DIR;
  } else {
    process.env.ISSUES_DIR = savedIssuesDir;
  }
  savedIssuesDir = undefined;
  refreshStorePathsFromEnv();
  for (const root of storeRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  storeRoots = [];
});

function tempAppConfigPath(): string {
  const root = mkdtempSync(join(tmpdir(), "app-config-"));
  storeRoots.push(root);
  const issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  savedIssuesDir = process.env.ISSUES_DIR;
  process.env.ISSUES_DIR = issuesDir;
  refreshStorePathsFromEnv();
  return appConfigPath;
}

describe("writeBackupConfig", () => {
  it("preserves an unrelated top-level key", () => {
    const path = tempAppConfigPath();
    writeFileSync(
      path,
      `${JSON.stringify({ futureSection: { keep: true } }, null, 2)}\n`,
    );
    writeBackupConfig(
      { remote: null, enabled: false },
      { configPath: path },
    );
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk).toEqual({
      futureSection: { keep: true },
      backup: { remote: null, enabled: false },
    });
    expect(readAppConfig({ configPath: path })).toEqual(onDisk);
  });
});
