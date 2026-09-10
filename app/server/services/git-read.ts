import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { IssueError } from "./errors.js";

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "show",
  "diff",
  "cat-file",
  "rev-list",
  "rev-parse",
  "merge-base",
  "remote",
  "status",
]);

/** @internal Test seam for stubbing git spawn. */
export type GitSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

const defaultGitSpawner: GitSpawner = (command, args, options) =>
  spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });

let gitSpawner: GitSpawner = defaultGitSpawner;

/** @internal Restore default spawn after tests. */
export function setGitSpawnerForTests(next: GitSpawner | null): void {
  gitSpawner = next ?? defaultGitSpawner;
}

function assertReadOnlyGitSubcommand(args: string[]): void {
  const subcommand = args[0];
  if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new IssueError(
      "validation",
      `git subcommand "${subcommand ?? ""}" is not allowed; only read-only history inspection is permitted`,
    );
  }
  if (subcommand === "remote" && args[1] !== "get-url") {
    throw new IssueError(
      "validation",
      `git subcommand "remote ${args[1] ?? ""}" is not allowed; only remote get-url is permitted`,
    );
  }
}

export async function runGit(
  args: string[],
  workspace: string,
): Promise<string> {
  assertReadOnlyGitSubcommand(args);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = gitSpawner("git", args, {
      cwd: workspace,
      env: process.env,
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk;
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new IssueError("git-missing", "git binary not found"));
        return;
      }
      reject(new IssueError("git-failed", err.message));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const errText = stderr.trim() || `git exited with code ${code}`;
      reject(new IssueError("git-failed", errText));
    });
  });
}

/** Return the checked-out branch name in `workspace`, or null when detached. */
export async function currentBranch(workspace: string): Promise<string | null> {
  try {
    const name = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspace)).trim();
    return name === "HEAD" ? null : name;
  } catch {
    return null;
  }
}

/** True when `refs/heads/<branchName>` exists in the repository rooted at `workspace`. */
export async function branchExists(
  workspace: string,
  branchName: string,
): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], workspace);
    return true;
  } catch {
    return false;
  }
}

/** Return the workspace's `origin` URL, or null when it has no origin. */
export async function getOriginRemoteUrl(
  workspace: string,
): Promise<string | null> {
  try {
    const url = (await runGit(["remote", "get-url", "origin"], workspace)).trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

function runGitSync(args: string[], workspace: string): string {
  assertReadOnlyGitSubcommand(args);
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new IssueError("git-missing", "git binary not found");
    }
    throw new IssueError("git-failed", err.message);
  }
  if (result.status === 0) {
    return result.stdout;
  }
  const errText = result.stderr.trim() || `git exited with code ${result.status}`;
  throw new IssueError("git-failed", errText);
}

/** Lines from `git status --porcelain` (ignored paths are omitted). */
export function porcelainStatusCount(workspace: string): number {
  const output = runGitSync(["status", "--porcelain"], workspace);
  if (output.length === 0) return 0;
  return output.split("\n").filter((line) => line.length > 0).length;
}

/**
 * Commits on `branchName` reachable from neither `trunk` nor the branch's
 * upstream, when one exists.
 */
export function atRiskCommitCount(
  workspace: string,
  branchName: string,
  trunk: string,
): number {
  let upstream: string | undefined;
  try {
    const ref = runGitSync(
      ["rev-parse", "--abbrev-ref", `${branchName}@{upstream}`],
      workspace,
    ).trim();
    if (ref.length > 0) upstream = ref;
  } catch {
    // No upstream configured — exclude only trunk.
  }
  const args = ["rev-list", "--count", branchName, "--not", trunk];
  if (upstream) args.push(upstream);
  const output = runGitSync(args, workspace).trim();
  const count = Number.parseInt(output, 10);
  if (!Number.isFinite(count)) {
    throw new IssueError(
      "git-failed",
      `git rev-list --count returned ${JSON.stringify(output)}`,
    );
  }
  return count;
}
