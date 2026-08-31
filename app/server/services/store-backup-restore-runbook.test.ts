import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECTS_MANIFEST_FILENAME } from "./store-backup-projects-manifest.js";
import {
  formatRestoreRunbook,
  RESTORE_RUNBOOK_FILENAME,
  writeRestoreRunbook,
} from "./store-backup-restore-runbook.js";

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe("formatRestoreRunbook", () => {
  it("names the issues subdirectory and restore steps", () => {
    const doc = formatRestoreRunbook({
      generatedAt: "2026-01-01T00:00:00.000Z",
      projects: [],
    });

    expect(doc).toContain("under `issues/`");
    expect(doc).toContain("Clone this mirror repository");
    expect(doc).toContain("`ISSUES_DIR`");
    expect(doc).toContain("`<clone>/issues`");
  });

  it("contains a clone command for a project with a remote", () => {
    const workspace = "/work/my-app";
    const doc = formatRestoreRunbook({
      generatedAt: "2026-01-01T00:00:00.000Z",
      projects: [
        {
          id: "my-app",
          title: "My App",
          workspace,
          trunk: "main",
          remote: "git@github.com:me/my-app.git",
        },
      ],
    });

    expect(doc).toContain("### My App");
    expect(doc).toContain("`/work/my-app`");
    expect(doc).toContain(
      "git clone 'git@github.com:me/my-app.git' '/work/my-app'",
    );
  });

  it("marks a project whose remote is null as unknown", () => {
    const doc = formatRestoreRunbook({
      generatedAt: "2026-01-01T00:00:00.000Z",
      projects: [
        {
          id: "local-only",
          title: "Local only",
          workspace: "/work/local",
          trunk: "main",
          remote: null,
        },
      ],
    });

    expect(doc).toContain("### Local only");
    expect(doc).toContain("**Code location:** unknown");
    expect(doc).not.toContain("git clone");
  });
});

describe("writeRestoreRunbook", () => {
  it("writes RESTORE.md at the mirror root from projects.json", () => {
    const mirrorDir = tempDir("restore-runbook-write-");
    writeFileSync(
      join(mirrorDir, PROJECTS_MANIFEST_FILENAME),
      JSON.stringify({
        generatedAt: "2026-01-01T00:00:00.000Z",
        projects: [
          {
            id: "demo",
            title: "Demo",
            workspace: "/tmp/demo",
            trunk: "main",
            remote: "git@github.com:me/demo.git",
          },
        ],
      }),
    );

    writeRestoreRunbook(mirrorDir);

    const path = join(mirrorDir, RESTORE_RUNBOOK_FILENAME);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("git clone");
  });
});
