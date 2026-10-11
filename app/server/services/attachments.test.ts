import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-attachments-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("b", {
    kind: "story",
    title: "B",
    partOf: "e",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("c", {
    kind: "task",
    title: "C",
    partOf: "b",
    order: 0,
    status: "todo",
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadAttachments() {
  return import("./attachments.js");
}

describe("listAttachments / putAttachment / getAttachment / removeAttachment (guards)", () => {
  it("refuses unsafe basenames", async () => {
    const { putAttachment, getAttachment, removeAttachment } =
      await loadAttachments();
    const bytes = Buffer.from("x");
    for (const name of ["", "..", ".", "a/b", "a\\b", "a\0b", "../x"]) {
      await expect(putAttachment("c", name, bytes)).rejects.toThrow(/unsafe/i);
      await expect(getAttachment("c", name)).rejects.toThrow(/unsafe/i);
      await expect(removeAttachment("c", name)).rejects.toThrow(/unsafe/i);
    }
  });
});
