import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, vi } from "vitest";

export const AT = "2026-07-09T14:00:00.000Z";

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

/** Temp issues store and the platform/capture seed. */
export function useConversationFixtures(): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-conversations-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
}

export async function loadService() {
  return import("./conversations.js");
}

export async function loadConfig() {
  return import("../config.js");
}
