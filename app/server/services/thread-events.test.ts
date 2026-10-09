import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
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
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-thread-events-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", createdAt: AT, updatedAt: AT });
  writeIssue("s", {
    kind: "story",
    title: "Story",
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

async function load() {
  const issues = await import("./issues.js");
  const events = await import("./thread-events.js");
  return { ...issues, ...events };
}

function logLines(id: string): unknown[] {
  return readFileSync(join(dir, id, "comments.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

describe("appendThreadEvent", () => {
  it("lets an agent resolve only with a reply, and never unresolve", async () => {
    const { appendComment, appendThreadEvent } = await load();
    const root = await appendComment("s", { role: "human", body: "root" });

    await expect(
      appendThreadEvent("s", root.id, {
        event: "resolved",
        by: { role: "implementor" },
      }),
    ).rejects.toThrow(/requires a reply body/);
    await expect(
      appendThreadEvent("s", root.id, {
        event: "unresolved",
        by: { role: "implementor" },
        body: "nope",
      }),
    ).rejects.toThrow(/cannot unresolve/);
    expect(logLines("s")).toHaveLength(1);

    const resolved = await appendThreadEvent("s", root.id, {
      event: "resolved",
      by: { role: "implementor" },
      body: "guard added in diff-fetch.ts",
    });
    expect(resolved.thread.state).toBe("resolved");
    expect(resolved.reply?.role).toBe("implementor");
  });
});
