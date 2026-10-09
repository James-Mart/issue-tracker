import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;
let gitDir: string;

function makeGitWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "issue-supporting-docs-ws-"));
  mkdirSync(join(ws, ".git"));
  return ws;
}

function project(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "p",
    kind: "project",
    title: "P",
    mergePolicy: "manual",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as Issue;
}

async function load() {
  return import("./supporting-docs.js");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-supporting-docs-"));
  gitDir = makeGitWorkspace();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(gitDir, { recursive: true, force: true });
});

describe("supportingDocs validation", () => {
  it("refuses absolute, .., missing file, and unset workspace", async () => {
    const { validateSupportingDocsPatch } = await load();
    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: {
          designSystem: { type: "workspace", path: "/tmp/x.md" },
        },
      }),
    ).toThrow(/relative/);

    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: {
          designSystem: { type: "workspace", path: "../x.md" },
        },
      }),
    ).toThrow(/\.\./);

    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: {
          designSystem: { type: "workspace", path: "missing.md" },
        },
      }),
    ).toThrow(/does not exist/);

    expect(() =>
      validateSupportingDocsPatch(project({ workspace: undefined }), {
        supportingDocs: {
          designSystem: { type: "workspace", path: "x.md" },
        },
      }),
    ).toThrow(/workspace to be set/);
  });
});
