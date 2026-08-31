import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshStorePathsFromEnv } from "../config.js";
import { getAttachment } from "./attachments.js";
import {
  commitChanges,
  hasStagedChanges,
  initRepository,
  stageAllChanges,
} from "./git-write.js";
import { list, read, readComments } from "./issues.js";
import {
  BACKUP_IDENTITY_FILENAME,
  ensureBackupIdentity,
  pushMirrorIfAllowed,
  resetCurrentBackupProblemForTests,
} from "./store-backup-identity.js";
import {
  PROJECTS_MANIFEST_FILENAME,
  writeProjectsManifest,
} from "./store-backup-projects-manifest.js";
import {
  RESTORE_RUNBOOK_FILENAME,
  writeRestoreRunbook,
} from "./store-backup-restore-runbook.js";
import {
  createStoreBackupSnapshotDriver,
  formatSnapshotCommitMessage,
  isGitRepository,
  resetStoreBackupSnapshotDriverForTests,
  SNAPSHOT_DEBOUNCE_MS,
  syncIssuesToMirror,
} from "./store-backup-snapshot.js";

const AT = "2026-08-31T00:00:00.000Z";
const PROJECT_ID = "restore-lab";
const ISSUE_ID = "restore-probe";
const COMMENT_BODY = "This comment must come back intact.";
const PROJECT_DESCRIPTION = "Project description for the restore lab.\n";
const ISSUE_DESCRIPTION = "Issue description must survive the round trip.\n";
const ATTACHMENT_NAME = "probe.bin";
const ATTACHMENT_BYTES = Buffer.from([
  0x00, 0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x0a,
]);

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "store-backup-test",
  GIT_AUTHOR_EMAIL: "store-backup-test@example.com",
  GIT_COMMITTER_NAME: "store-backup-test",
  GIT_COMMITTER_EMAIL: "store-backup-test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
} as const;

let tempRoots: string[] = [];
let savedIssuesDir: string | undefined;
const savedGitEnv: Record<string, string | undefined> = {};

afterEach(() => {
  resetStoreBackupSnapshotDriverForTests();
  resetCurrentBackupProblemForTests();
  restoreGitIdentity();
  restoreIssuesDir();
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

function pointIssuesDir(issuesDir: string): void {
  if (savedIssuesDir === undefined) {
    savedIssuesDir = process.env.ISSUES_DIR;
  }
  process.env.ISSUES_DIR = issuesDir;
  refreshStorePathsFromEnv();
}

function restoreIssuesDir(): void {
  if (savedIssuesDir === undefined) {
    delete process.env.ISSUES_DIR;
  } else {
    process.env.ISSUES_DIR = savedIssuesDir;
  }
  savedIssuesDir = undefined;
  refreshStorePathsFromEnv();
}

function applyGitIdentity(): void {
  for (const [key, value] of Object.entries(GIT_IDENTITY)) {
    savedGitEnv[key] = process.env[key];
    process.env[key] = value;
  }
}

function restoreGitIdentity(): void {
  for (const key of Object.keys(GIT_IDENTITY)) {
    const prior = savedGitEnv[key];
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
    delete savedGitEnv[key];
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function initMirrorRepository(workspace: string): Promise<void> {
  await initRepository(workspace);
  git(workspace, ["config", "user.name", GIT_IDENTITY.GIT_AUTHOR_NAME]);
  git(workspace, ["config", "user.email", GIT_IDENTITY.GIT_AUTHOR_EMAIL]);
  git(workspace, ["config", "commit.gpgsign", "false"]);
}

function writeIssue(
  issuesDir: string,
  id: string,
  body: Record<string, unknown>,
  description: string,
): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
  writeFileSync(join(issuesDir, id, "description.md"), description);
}

function seedStore(issuesDir: string): void {
  writeIssue(
    issuesDir,
    PROJECT_ID,
    {
      kind: "project",
      title: "Restore lab",
      trunk: "main",
      labels: [],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    },
    PROJECT_DESCRIPTION,
  );
  writeIssue(
    issuesDir,
    ISSUE_ID,
    {
      kind: "epic",
      title: "Restore probe",
      partOf: PROJECT_ID,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    },
    ISSUE_DESCRIPTION,
  );
  writeFileSync(
    join(issuesDir, ISSUE_ID, "comments.jsonl"),
    `${JSON.stringify({ role: "human", body: COMMENT_BODY, at: AT })}\n`,
  );
  mkdirSync(join(issuesDir, ISSUE_ID, "attachments"), { recursive: true });
  writeFileSync(
    join(issuesDir, ISSUE_ID, "attachments", ATTACHMENT_NAME),
    ATTACHMENT_BYTES,
  );
}

describe("store backup restore round trip", () => {
  it("clones a pushed snapshot as an equivalent store", async () => {
    applyGitIdentity();

    const root = tempDir("store-backup-round-trip-");
    const issuesDir = join(root, "issues");
    const backupMirrorDir = join(root, "backup-mirror");
    const bareRemote = join(root, "remote.git");
    const cloneDir = join(root, "clone");
    mkdirSync(issuesDir, { recursive: true });
    mkdirSync(bareRemote, { recursive: true });
    git(bareRemote, ["init", "--bare", "-b", "main"]);

    seedStore(issuesDir);
    pointIssuesDir(issuesDir);

    const driver = createStoreBackupSnapshotDriver({
      readAppConfig: () => ({
        backup: { remote: bareRemote, enabled: true },
      }),
      issuesDir,
      backupMirrorDir,
      debounceMs: SNAPSHOT_DEBOUNCE_MS,
      setDebounceTimer: setTimeout,
      clearDebounceTimer: clearTimeout,
      createWatcher: () => ({ close: () => {} }),
      syncIssuesToMirror,
      isGitRepository,
      initRepository: initMirrorRepository,
      stageAllChanges,
      hasStagedChanges,
      commitChanges,
      formatCommitMessage: formatSnapshotCommitMessage,
      ensureBackupIdentity,
      writeProjectsManifest,
      writeRestoreRunbook,
      pushIfAllowed: pushMirrorIfAllowed,
    });

    await driver.takeSnapshot();

    git(root, ["clone", bareRemote, cloneDir]);

    expect(existsSync(join(cloneDir, PROJECTS_MANIFEST_FILENAME))).toBe(true);
    expect(existsSync(join(cloneDir, RESTORE_RUNBOOK_FILENAME))).toBe(true);
    expect(existsSync(join(cloneDir, BACKUP_IDENTITY_FILENAME))).toBe(true);

    const cloneIssues = join(cloneDir, "issues");
    const entries = readdirSync(cloneIssues);
    expect(entries.sort()).toEqual([ISSUE_ID, PROJECT_ID].sort());
    for (const name of entries) {
      expect(statSync(join(cloneIssues, name)).isDirectory()).toBe(true);
    }

    pointIssuesDir(cloneIssues);

    expect(list().issues.map((issue) => issue.id).sort()).toEqual(
      [ISSUE_ID, PROJECT_ID].sort(),
    );
    expect(read(PROJECT_ID)).toMatchObject({
      id: PROJECT_ID,
      kind: "project",
      title: "Restore lab",
      description: PROJECT_DESCRIPTION,
    });
    expect(read(ISSUE_ID)).toMatchObject({
      id: ISSUE_ID,
      kind: "epic",
      title: "Restore probe",
      partOf: PROJECT_ID,
      description: ISSUE_DESCRIPTION,
    });
    expect(readComments(ISSUE_ID).messages.map((message) => message.body)).toEqual(
      [COMMENT_BODY],
    );
    const attachment = await getAttachment(ISSUE_ID, ATTACHMENT_NAME);
    expect(attachment.bytes.equals(ATTACHMENT_BYTES)).toBe(true);
  });
});
