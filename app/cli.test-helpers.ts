import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach } from "vitest";

// Drive the CLI against a throwaway ISSUES_DIR. In-process cases use
// runIssueCli; the --help cold-boot spawns the real `issue` bin from outside
// app/, the way agents invoke it from Story worktrees.
const appDir = dirname(fileURLToPath(import.meta.url));
const binPath = join(appDir, "bin", "issue.mjs");

export let dir: string;
let clock = 0;

export function env() {
  return {
    ISSUES_DIR: dir,
    ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1",
  };
}

export function nextAt(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 6, 10, 14, 0, clock)).toISOString();
}

export function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

export function conversationsRoot(): string {
  return join(dirname(dir), "conversations");
}

export function spawnCliColdBoot(
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      ISSUES_DIR: dir,
      ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1",
    },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

export function issueJsonField<T>(id: string, key: string): T {
  const raw = JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  return raw[key];
}

export function blockedByOf(id: string): string[] {
  return issueJsonField(id, "blockedBy");
}

export function useCliTestFixtures(): void {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-cli-"));
    clock = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}
