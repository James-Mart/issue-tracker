import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLauncherSessions } from "./queue-launcher.test-helpers.js";

const AT = "2026-07-09T14:00:00.000Z";

let rootDir: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readIssue(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(issuesDir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-placement-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(join(issuesDir, ".release-migrated"), "");
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Feature outline",
    partOf: "p",
    bodyVersion: 2,
    executionGate: false,
    codeApprovalRequired: false,
    order: 1,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeFileSync(join(issuesDir, "spec", "description.md"), "version two\n");
  writeIssue("root", {
    kind: "epic",
    title: "Root",
    partOf: "p",
    sourceOutline: { outline: "spec", version: 1 },
    blockedBy: [],
    order: 2,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(rootDir, { recursive: true, force: true });
});

async function load() {
  const chain = await import("./placement-chain.js");
  const issues = await import("./issues.js");
  const conversations = await import("./conversations.js");
  const launch = await import("../../src/features/issues/lib/outline-planning-launch.js");
  const transcript = await import("./conversation-transcript-seq.js");
  const fake = fakeLauncherSessions();
  const sessions = { ...fake.sessions, isBusy: () => false };
  return { ...chain, ...issues, ...conversations, ...launch, ...transcript, sessions };
}

describe("classifyPlacementRun", () => {
  it("runs polish after the reconciler and releases when polish finishes", async () => {
    const {
      startRootPlacement,
      classifyPlacementRun,
      listConversations,
      transcriptPathOf,
      outlinePolishSessionMessage,
      update,
      sessions,
      list,
    } = await load();
    const reconciler = await startRootPlacement("spec", "root", "reconcile", sessions);
    await update("spec", { description: "version three\n" });
    expect(readIssue("spec").placementChain).toMatchObject({ version: 2, step: "reconciler" });
    expect(readIssue("spec").bodyVersion).toBe(3);

    expect(
      await classifyPlacementRun(reconciler.id, { status: "finished" }, sessions),
    ).toBe(true);
    expect(readIssue("spec").placementChain).toMatchObject({ step: "polish", version: 2 });
    const polish = listConversations().find((meta) => meta.outlineRole === "polish");
    expect(polish).toBeDefined();
    const line = readFileSync(transcriptPathOf(polish!.id), "utf8").trim();
    expect(JSON.parse(line).text).toBe(
      outlinePolishSessionMessage({
        outlineId: "spec",
        rootId: "root",
        from: 1,
        version: 2,
      }),
    );

    expect(await classifyPlacementRun(polish!.id, { status: "finished" }, sessions)).toBe(true);
    expect(readIssue("spec").placementChain).toBeUndefined();
    expect(readIssue("root").releasedAt).toEqual(expect.any(String));
    expect(readIssue("root").sourceOutline).toEqual({ outline: "spec", version: 1 });
    expect(list().derived.root?.behind).toBe(true);
    expect(list().derived.spec?.placementLive).toBe(false);
  });
});
