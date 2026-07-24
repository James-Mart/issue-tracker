import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;
let gitDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

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
  const supportingDocs = await import("./supporting-docs.js");
  const attachments = await import("./attachments.js");
  return { ...supportingDocs, ...attachments };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-supporting-docs-"));
  gitDir = makeGitWorkspace();
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: gitDir,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
  rmSync(gitDir, { recursive: true, force: true });
});

describe("supportingDocs validation", () => {
  it("accepts an attachment ref when the file is attached", async () => {
    const { putAttachment, validateSupportingDocsPatch } = await load();
    await putAttachment("p", "vision.md", Buffer.from("# Vision"));
    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: {
          vision: { type: "attachment", name: "vision.md" },
        },
      }),
    ).not.toThrow();
  });

  it("refuses a missing attachment", async () => {
    const { validateSupportingDocsPatch } = await load();
    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: {
          vision: { type: "attachment", name: "vision.md" },
        },
      }),
    ).toThrow(/not attached/);
  });

  it("accepts a workspace file under the Project workspace", async () => {
    const { validateSupportingDocsPatch } = await load();
    writeFileSync(join(gitDir, "coding-standards.md"), "# Standards");
    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: {
          codingStandards: {
            type: "workspace",
            path: "coding-standards.md",
          },
        },
      }),
    ).not.toThrow();
  });

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

  it("allows clearing with null", async () => {
    const { validateSupportingDocsPatch } = await load();
    expect(() =>
      validateSupportingDocsPatch(project({ workspace: gitDir }), {
        supportingDocs: null,
      }),
    ).not.toThrow();
  });
});

describe("supportingDocs helpers", () => {
  it("exposes well-known attachment basenames", async () => {
    const { WELL_KNOWN_SUPPORTING_DOC_BASENAMES } = await load();
    expect(WELL_KNOWN_SUPPORTING_DOC_BASENAMES).toEqual({
      vision: "vision.md",
      codingStandards: "coding-standards.md",
      designSystem: "design-system.md",
    });
  });

  it("formats a compact view/summary line", async () => {
    const { formatSupportingDocsLine } = await load();
    expect(
      formatSupportingDocsLine({
        vision: { type: "attachment", name: "vision.md" },
        codingStandards: { type: "workspace", path: "docs/cs.md" },
      }),
    ).toBe(
      "vision=attachment:vision.md, codingStandards=workspace:docs/cs.md",
    );
  });
});
