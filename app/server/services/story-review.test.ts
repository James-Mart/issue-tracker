import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const AT = "2024-01-01T00:00:00.000Z";

describe("specReview → review migration", () => {
  let dir: string;

  function writeIssue(id: string, body: Record<string, unknown>): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
  }

  function readIssue(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-story-review-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites specReview→review once, then no-ops", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("s", {
      kind: "story",
      title: "S",
      partOf: "p",
      merged: false,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      specReview: "passed",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { list } = await import("./issues.js");
    list();
    expect(readIssue("s").review).toBe("passed");
    expect("specReview" in readIssue("s")).toBe(false);
    expect(existsSync(join(dir, ".spec-review-renamed"))).toBe(true);

    writeIssue("legacy", {
      kind: "story",
      title: "Legacy",
      partOf: "p",
      merged: false,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      specReview: "failed",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    list();
    expect(readIssue("legacy").specReview).toBe("failed");
    expect("review" in readIssue("legacy")).toBe(false);
  });

  it("no-ops when marker exists and no specReview on disk", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("s", {
      kind: "story",
      title: "S",
      partOf: "p",
      merged: false,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { ensureSpecReviewRenamed } = await import("./story-review.js");
    const first = ensureSpecReviewRenamed();
    expect(first.skipped).toBe(false);
    expect(first.updated).toEqual([]);

    writeIssue("s", { ...readIssue("s"), specReview: "passed" });
    const second = ensureSpecReviewRenamed();
    expect(second.skipped).toBe(true);
    expect(readIssue("s").specReview).toBe("passed");
    expect("review" in readIssue("s")).toBe(false);
  });
});
