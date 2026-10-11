import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-scratch-"));
  const issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("mockup scratch layout", () => {
  it("refuses ids that would escape the conversations dir", async () => {
    const { directionDir, harnessConfigPath, mockupScratchDir } = await import(
      "./mockup-scratch.js"
    );

    expect(() => mockupScratchDir("../../etc")).toThrow(/must be a slug/);
    expect(() => directionDir("my-conversation", "../escape")).toThrow(
      /must be a slug/,
    );
    expect(() => harnessConfigPath("../../etc")).toThrow(/must be a slug/);
  });
});
