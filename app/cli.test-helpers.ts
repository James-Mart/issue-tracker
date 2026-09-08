import { spawn, spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach } from "vitest";

// Drive the CLI against a throwaway ISSUES_DIR. In-process cases use
// runIssueCli; EPIPE and the --help cold-boot spawn the thin cli.ts shell.
const appDir = dirname(fileURLToPath(import.meta.url));
const tsx = join(appDir, "node_modules", ".bin", "tsx");
const cliPath = join(appDir, "cli.ts");

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

export function seedPlanningSession(
  convId: string,
  ideaId: string,
  projectId: string,
  opts?: { live?: boolean; transcriptLine?: string },
): void {
  const convDir = join(conversationsRoot(), convId);
  mkdirSync(convDir, { recursive: true });
  const now = nextAt();
  writeFileSync(
    join(convDir, "meta.json"),
    JSON.stringify({
      id: convId,
      title: "Plan",
      projectId,
      model: "auto",
      issueId: ideaId,
      channel: "planning",
      createdAt: now,
      updatedAt: now,
    }),
  );
  if (opts?.transcriptLine) {
    writeFileSync(join(convDir, "transcript.jsonl"), `${opts.transcriptLine}\n`);
  }
  if (opts?.live) {
    writeFileSync(
      join(convDir, "run-live.json"),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
  }
}

export function spawnCliColdBoot(
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(tsx, [cliPath, ...args], {
    cwd: appDir,
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

/** Spawn the real CLI and close stdout after the first chunk (broken pipe). */
export function runCliWithEarlyStdoutClose(
  args: string[],
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [cliPath, ...args], {
      cwd: appDir,
      env: {
        ...process.env,
        ISSUES_DIR: dir,
        ISSUE_TRACKER_SKIP_MODEL_SLUG_SYNC: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.stdout?.once("data", () => {
      child.stdout?.destroy();
    });

    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stderr });
    });
  });
}

export function makeGitWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "issue-cli-workspace-"));
  mkdirSync(join(ws, ".git"));
  return ws;
}

export function issueJsonField<T>(id: string, key: string): T {
  const raw = JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  return raw[key];
}

export function blockedByOf(id: string): string[] {
  return issueJsonField(id, "blockedBy");
}

export function mergeBaseOf(id: string): string | undefined {
  return issueJsonField(id, "mergeBase");
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
