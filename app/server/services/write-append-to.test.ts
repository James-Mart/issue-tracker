import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-write-append-to-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
  writeIssue("open-story", {
    kind: "story",
    title: "Open",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

describe("idea appendTo cleanup", () => {
  it("clears appendTo on surviving Ideas when the target Story is deleted", async () => {
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 1,
      appendTo: "open-story",
      createdAt: AT,
      updatedAt: AT,
    });
    const { remove, list } = await loadService();
    const result = await remove("open-story");
    expect(result.droppedAppendTo).toEqual([{ id: "capture" }]);

    const after = list();
    expect(after.problems).toEqual([]);
    const idea = after.issues.find((i) => i.id === "capture");
    expect(idea && idea.kind === "idea" ? idea.appendTo : "unexpected").toBeUndefined();
    expect(
      "appendTo" in JSON.parse(readFileSync(join(dir, "capture", "issue.json"), "utf8")),
    ).toBe(false);
  });
});
