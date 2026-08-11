import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { IssueError } from "./errors.js";

const GITHUB_PR_URL =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

/** @internal Test seam for stubbing gh spawn. */
export type GhSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

const defaultGhSpawner: GhSpawner = (command, args, options) =>
  spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });

let ghSpawner: GhSpawner = defaultGhSpawner;

/** @internal Restore default spawn after tests. */
export function setGhSpawnerForTests(next: GhSpawner | null): void {
  ghSpawner = next ?? defaultGhSpawner;
}

function isGhAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("not logged into") ||
    lower.includes("gh_token") ||
    lower.includes("authentication") ||
    lower.includes("401") ||
    lower.includes("invalid token") ||
    lower.includes("no oauth token")
  );
}

export async function runGh(
  args: string[],
  workspace: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = ghSpawner("gh", args, {
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
        reject(new IssueError("gh-missing", "gh binary not found"));
        return;
      }
      reject(new IssueError("gh-failed", err.message));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const errText = stderr.trim() || `gh exited with code ${code}`;
      if (isGhAuthFailure(stderr)) {
        reject(new IssueError("gh-unauthenticated", errText));
        return;
      }
      reject(new IssueError("gh-failed", errText));
    });
  });
}

export function parsePrUrl(prUrl: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = GITHUB_PR_URL.exec(prUrl);
  if (!match) {
    throw new IssueError(
      "not-github-pr-url",
      `not a GitHub pull request URL: ${prUrl}`,
    );
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]!),
  };
}
