import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-store-replace-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("replaceFileAtomically", () => {
  it("replaces the destination and removes the temp file", async () => {
    mkdirSync(join(dir, "leaf"), { recursive: true });
    const filePath = join(dir, "leaf", "description.md");
    writeFileSync(filePath, "Old body\n");
    const { replaceFileAtomically } = await import("./issues-store-lock.js");
    replaceFileAtomically(filePath, "New body\n");
    expect(readFileSync(filePath, "utf8")).toBe("New body\n");
    expect(existsSync(`${filePath}.${process.pid}.issue-tmp`)).toBe(false);
  });

  it("leaves the previous destination in place when read opens the canonical path", async () => {
    mkdirSync(join(dir, "leaf"), { recursive: true });
    const filePath = join(dir, "leaf", "description.md");
    writeFileSync(filePath, "Published body\n");
    writeFileSync(`${filePath}.99999.issue-tmp`, "Stale partial write\n");
    const { readDescription } = await import("./issues-detail.js");
    expect(readDescription("leaf")).toBe("Published body\n");
  });
});
