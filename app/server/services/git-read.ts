import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { IssueError } from "./errors.js";

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "show",
  "diff",
  "cat-file",
  "rev-list",
  "rev-parse",
  "merge-base",
  "remote",
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
