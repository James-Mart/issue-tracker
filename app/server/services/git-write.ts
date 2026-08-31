import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { IssueError } from "./errors.js";

const WRITE_GIT_SUBCOMMANDS = new Set([
  "init",
  "remote",
  "add",
  "commit",
  "push",
  "status",
]);

/** @internal Test seam for stubbing git spawn. */
export type GitWriteSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

const defaultGitWriteSpawner: GitWriteSpawner = (command, args, options) =>
  spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });

let gitWriteSpawner: GitWriteSpawner = defaultGitWriteSpawner;

/** @internal Restore default spawn after tests. */
export function setGitWriteSpawnerForTests(next: GitWriteSpawner | null): void {
  gitWriteSpawner = next ?? defaultGitWriteSpawner;
}

function assertWriteGitSubcommand(args: string[]): void {
  const subcommand = args[0];
  if (!subcommand || !WRITE_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new IssueError(
      "validation",
      `git subcommand "${subcommand ?? ""}" is not allowed; only mirror write operations are permitted`,
    );
  }
}

export async function runGitWrite(
  args: string[],
  workspace: string,
): Promise<string> {
  assertWriteGitSubcommand(args);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = gitWriteSpawner("git", args, {
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

export async function initRepository(workspace: string): Promise<void> {
  await runGitWrite(["init", "-b", "main"], workspace);
}

export async function setOriginRemote(
  workspace: string,
  url: string,
): Promise<void> {
  await runGitWrite(["remote", "add", "origin", url], workspace);
}

export async function stageAllChanges(workspace: string): Promise<void> {
  await runGitWrite(["add", "-A"], workspace);
}

export async function commitChanges(
  workspace: string,
  message: string,
): Promise<void> {
  await runGitWrite(["commit", "-m", message], workspace);
}

export async function pushMainToOrigin(workspace: string): Promise<void> {
  await runGitWrite(["push", "origin", "main"], workspace);
}

export async function hasStagedChanges(workspace: string): Promise<boolean> {
  const output = await runGitWrite(["status", "--porcelain"], workspace);
  return output
    .split("\n")
    .some((line) => line.length > 0 && line[0] !== " " && line[0] !== "?");
}
