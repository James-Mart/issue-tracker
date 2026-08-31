import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { Issue } from "../schemas.js";
import {
  buildProjectManifestEntries,
  formatProjectsManifest,
  PROJECTS_MANIFEST_FILENAME,
  writeProjectsManifest,
  type WriteProjectsManifestDeps,
} from "./store-backup-projects-manifest.js";

const AT = "2026-01-01T00:00:00.000Z";

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

function project(
  id: string,
  extra: Partial<Extract<Issue, { kind: "project" }>> = {},
): Extract<Issue, { kind: "project" }> {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    labels: [],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

describe("buildProjectManifestEntries", () => {
  it("records origin for a project whose workspace is a git repository", async () => {
    const workspace = tempDir("manifest-ws-");
    mkdirSync(join(workspace, ".git"), { recursive: true });
    const getOriginRemote = async () => "git@github.com:me/repo.git";

    const entries = await buildProjectManifestEntries(
      [project("with-origin", { workspace, title: "With origin" })],
      { getOriginRemote, isGitRepository: () => true },
    );

    expect(entries).toEqual([
      {
        id: "with-origin",
        title: "With origin",
        workspace,
        trunk: "main",
        remote: "git@github.com:me/repo.git",
      },
    ]);
  });

  it("records null remote when workspace is unset", async () => {
    const getOriginRemote = async () => {
      throw new Error("should not call git for unset workspace");
    };

    const entries = await buildProjectManifestEntries(
      [project("unset-workspace", { title: "No workspace" })],
      { getOriginRemote, isGitRepository: () => true },
    );

    expect(entries).toEqual([
      {
        id: "unset-workspace",
        title: "No workspace",
        workspace: null,
        trunk: "main",
        remote: null,
      },
    ]);
  });

  it("records null remote when workspace is not a git repository", async () => {
    const workspace = tempDir("manifest-non-git-");
    const getOriginRemote = async () => {
      throw new Error("should not call git for non-repository workspace");
    };

    const entries = await buildProjectManifestEntries(
      [project("non-git", { workspace, title: "Not a repo" })],
      { getOriginRemote, isGitRepository: () => false },
    );

    expect(entries).toEqual([
      {
        id: "non-git",
        title: "Not a repo",
        workspace,
        trunk: "main",
        remote: null,
      },
    ]);
  });

  it("includes every project without raising", async () => {
    const gitWorkspace = tempDir("manifest-mixed-git-");
    mkdirSync(join(gitWorkspace, ".git"), { recursive: true });
    const plainDir = tempDir("manifest-mixed-plain-");
    const getOriginRemote = async (workspace: string) =>
      workspace === gitWorkspace ? "git@github.com:me/one.git" : null;

    const entries = await buildProjectManifestEntries(
      [
        project("one", { workspace: gitWorkspace, title: "One" }),
        project("two", { title: "Two" }),
        project("three", { workspace: plainDir, title: "Three" }),
      ],
      {
        getOriginRemote,
        isGitRepository: (workspace) => existsSync(join(workspace, ".git")),
      },
    );

    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.id === "one")?.remote).toBe(
      "git@github.com:me/one.git",
    );
    expect(entries.find((entry) => entry.id === "two")?.remote).toBeNull();
    expect(entries.find((entry) => entry.id === "three")?.remote).toBeNull();
  });
});

describe("writeProjectsManifest", () => {
  it("writes projects.json at the mirror root", async () => {
    const mirrorDir = tempDir("manifest-write-");
    const workspace = tempDir("manifest-write-ws-");
    mkdirSync(join(workspace, ".git"), { recursive: true });
    const fixedNow = new Date("2026-08-30T19:04:11.000Z");
    const deps: WriteProjectsManifestDeps = {
      listProjects: () => [
        project("issue-tracker", {
          title: "issue-tracker",
          workspace,
          trunk: "main",
        }),
      ],
      getOriginRemote: async () => "git@github.com:me/issue-tracker.git",
      isGitRepository: () => true,
      now: () => fixedNow,
    };

    await writeProjectsManifest(mirrorDir, deps);

    const path = join(mirrorDir, PROJECTS_MANIFEST_FILENAME);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      generatedAt: "2026-08-30T19:04:11.000Z",
      projects: [
        {
          id: "issue-tracker",
          title: "issue-tracker",
          workspace,
          trunk: "main",
          remote: "git@github.com:me/issue-tracker.git",
        },
      ],
    });
  });
});

describe("formatProjectsManifest", () => {
  it("pretty-prints JSON with a trailing newline", () => {
    expect(
      formatProjectsManifest({
        generatedAt: "2026-08-30T19:04:11.000Z",
        projects: [],
      }),
    ).toBe('{\n  "generatedAt": "2026-08-30T19:04:11.000Z",\n  "projects": []\n}\n');
  });
});
