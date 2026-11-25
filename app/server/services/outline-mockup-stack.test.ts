import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const storybook = vi.hoisted(() => ({
  acquireViewerLease: vi.fn(),
  releaseLease: vi.fn(),
}));

vi.mock("./outline-storybook.js", () => storybook);

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeOutline(id: string): void {
  writeIssue(id, {
    kind: "outline",
    title: id,
    partOf: "p",
    bodyVersion: 1,
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeFileSync(join(issuesDir, id, "description.md"), "# O\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-outline-mockup-stack-"));
  issuesDir = join(root, "issues");
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  storybook.acquireViewerLease.mockReset();
  storybook.releaseLease.mockReset();
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeOutline("spec");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it("releases the viewer lease and leaves a capture-only stack live", async () => {
  const { readProcInfo } = await import("./storybook-process.js");
  const { writeLease, writeOutlineStorybookState } = await import("./outline-mockup-store.js");
  const { readOutlineMockupStack, stopOutlineMockupStack } = await import(
    "./outline-mockup-stack.js"
  );
  const info = readProcInfo(process.pid);
  if (!info) throw new Error("expected /proc for this process");
  writeOutlineStorybookState("spec", {
    port: 9,
    pid: process.pid,
    startTime: info.startTime,
    baseUrl: "http://127.0.0.1:9",
    base: "/mockups/agent-mockup/",
    startedAt: AT,
  });
  expect(readOutlineMockupStack("spec").phase).toBe("live");

  await stopOutlineMockupStack("spec");
  expect(storybook.releaseLease).not.toHaveBeenCalled();
  expect(readOutlineMockupStack("spec").phase).toBe("live");

  writeLease("spec", {
    id: "spec.viewer",
    kind: "viewer",
    acquiredAt: AT,
  });
  storybook.releaseLease.mockImplementation(async (leaseId: string) => {
    const { removeLease, removeOutlineStorybookState, leaseOutlineId } = await import(
      "./outline-mockup-store.js"
    );
    const outlineId = leaseOutlineId(leaseId);
    removeLease(outlineId, leaseId);
    removeOutlineStorybookState(outlineId);
  });

  expect(await stopOutlineMockupStack("spec")).toMatchObject({ phase: "stopped" });
  expect(storybook.releaseLease).toHaveBeenCalledWith("spec.viewer");
});
