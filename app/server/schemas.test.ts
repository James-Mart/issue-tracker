import { describe, expect, it } from "vitest";
import { parseIssue } from "./schemas";

const epic = {
  id: "add-auth",
  kind: "epic",
  title: "Add authentication",
  partOf: "platform",
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

const branch = {
  id: "auth-endpoints",
  kind: "story",
  title: "Auth endpoints",
  partOf: "add-auth",
  branchName: "feat/auth",
  stackedOn: "db-schema",
  merged: false,
  createdAt: "2026-07-09T14:35:00.000Z",
  updatedAt: "2026-07-09T15:00:00.000Z",
};

const commit = {
  id: "login-route",
  kind: "task",
  title: "Add login route",
  partOf: "auth-endpoints",
  status: "in-progress",
  createdAt: "2026-07-09T14:36:00.000Z",
  updatedAt: "2026-07-09T14:50:00.000Z",
};

describe("parseIssue - legacy stored fields", () => {
  it("strips a legacy stored mergeBase on a branch (derived-only)", () => {
    const withBase = parseIssue({ ...branch, mergeBase: "main" });
    expect(withBase.ok).toBe(true);
    if (withBase.ok && withBase.issue.kind === "story") {
      expect("mergeBase" in withBase.issue).toBe(false);
    }
    const absent = parseIssue(branch);
    expect(absent.ok).toBe(true);
    if (absent.ok && absent.issue.kind === "story") {
      expect("mergeBase" in absent.issue).toBe(false);
    }
  });

  it("loads a task carrying a stored qa key by dropping it on read", () => {
    const legacy = parseIssue({ ...commit, qa: "passed" });
    expect(legacy.ok).toBe(true);
    if (legacy.ok && legacy.issue.kind === "task") {
      expect(legacy.issue.status).toBe("in-progress");
      expect("qa" in legacy.issue).toBe(false);
    }
  });
});

describe("parseIssue - malformed is rejected with a message", () => {
  it("rejects an unknown kind", () => {
    const result = parseIssue({ ...epic, kind: "milestone" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});
