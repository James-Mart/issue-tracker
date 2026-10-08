import {
  spawn,
  spawnSync,
  type ChildProcessByStdio,
} from "node:child_process";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { IssueError } from "./errors.js";

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "show",
  "diff",
  "cat-file",
  "log",
  "rev-list",
  "rev-parse",
  "merge-base",
  "remote",
  "status",
  "ls-files",
  "worktree",
]);

export type GitSpawnStdio = ["ignore", "pipe", "pipe"] | ["pipe", "pipe", "pipe"];

/** @internal Test seam for stubbing git spawn. */
export type GitSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: GitSpawnStdio },
) => ChildProcessByStdio<Writable | null, Readable, Readable>;

const defaultGitSpawner: GitSpawner = (command, args, options) => {
  if (options.stdio?.[0] === "pipe") {
    return spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
};

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
  if (subcommand === "worktree" && args[1] !== "list") {
    throw new IssueError(
      "validation",
      `git subcommand "worktree ${args[1] ?? ""}" is not allowed; only worktree list is permitted`,
    );
  }
}

/** Spawn one long-lived read-only git process with stdin, stdout, and stderr piped. */
export function spawnReadOnlyGit(
  args: string[],
  workspace: string,
): ChildProcessByStdio<Writable, Readable, Readable> {
  assertReadOnlyGitSubcommand(args);
  const child = gitSpawner("git", args, {
    cwd: workspace,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return child as ChildProcessByStdio<Writable, Readable, Readable>;
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

/**
 * Main worktree for `checkout`. Linked worktrees share one common git dir;
 * its parent is the checkout that holds the live store.
 */
export function mainCheckoutRoot(checkout: string): string {
  const common = runGitSync(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    checkout,
  ).trim();
  return dirname(common);
}

/**
 * True when `ancestor` is an ancestor of `descendant`, including when they
 * are the same commit. Exit 1 is "not an ancestor"; any other failure throws.
 */
export function refIsAncestor(
  workspace: string,
  ancestor: string,
  descendant: string,
): boolean {
  const args = ["merge-base", "--is-ancestor", ancestor, descendant];
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
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const errText =
    result.stderr.trim() || `git exited with code ${result.status}`;
  throw new IssueError("git-failed", errText);
}

export type ListedWorktree = { path: string; locked: boolean };

/** Parse `git worktree list --porcelain` into one entry per registered path. */
export function listedWorktrees(porcelain: string): ListedWorktree[] {
  const entries: ListedWorktree[] = [];
  let current: ListedWorktree | undefined;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length), locked: false };
      continue;
    }
    if (current && (line === "locked" || line.startsWith("locked "))) {
      current.locked = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** `git worktree list --porcelain` for `cwd`. */
export async function readListedWorktrees(cwd: string): Promise<ListedWorktree[]> {
  const porcelain = await runGit(["worktree", "list", "--porcelain"], cwd);
  return listedWorktrees(porcelain);
}

function porcelainLinePath(line: string): string {
  const body = line.slice(3);
  const arrow = body.indexOf(" -> ");
  return arrow >= 0 ? body.slice(arrow + 4) : body;
}

async function isGitlink(workspace: string, relPath: string): Promise<boolean> {
  const output = (await runGit(["ls-files", "-s", "--", relPath], workspace)).trim();
  if (output.length === 0) return false;
  return output.split(/\s+/)[0] === "160000";
}

/**
 * Paths from `git status --porcelain` (ignored paths are omitted), one entry
 * per counted change. Submodule paths with inner porcelain expand to those
 * inner paths; when inner porcelain is empty the parent path counts once.
 * The same rule applies at every nested level. `prefix` is the parent
 * submodule path, with a trailing slash, for nested expansion.
 */
export async function porcelainDirtyPaths(
  workspace: string,
  prefix = "",
): Promise<string[]> {
  const output = await runGit(["status", "--porcelain"], workspace);
  if (output.length === 0) return [];
  const lines = output.split("\n").filter((line) => line.length > 0);
  const parts = await Promise.all(
    lines.map(async (line) => {
      const relPath = porcelainLinePath(line);
      if (await isGitlink(workspace, relPath)) {
        const inner = await porcelainDirtyPaths(
          join(workspace, relPath),
          `${prefix}${relPath}/`,
        );
        return inner.length > 0 ? inner : [`${prefix}${relPath}`];
      }
      return [`${prefix}${relPath}`];
    }),
  );
  return parts.flat();
}

/** Abbrev `branch@{upstream}`, or undefined when none is configured. */
export async function branchUpstream(
  workspace: string,
  branchName: string,
): Promise<string | undefined> {
  try {
    const ref = (
      await runGit(
        ["rev-parse", "--abbrev-ref", `${branchName}@{upstream}`],
        workspace,
      )
    ).trim();
    return ref.length > 0 ? ref : undefined;
  } catch (err) {
    if (
      err instanceof IssueError &&
      err.message.includes("no upstream configured")
    ) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Commits on `branchName` not reachable from `base`, and the reverse.
 * `left-right` counts match `rev-list --count branch --not base` and
 * `rev-list --count base --not branch`.
 */
export async function revListAheadBehind(
  workspace: string,
  base: string,
  branchName: string,
): Promise<{ ahead: number; behind: number }> {
  const output = (
    await runGit(
      ["rev-list", "--left-right", "--count", `${base}...${branchName}`],
      workspace,
    )
  ).trim();
  const [left, right] = output.split(/\s+/);
  const behind = Number.parseInt(left ?? "", 10);
  const ahead = Number.parseInt(right ?? "", 10);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    throw new IssueError(
      "git-failed",
      `git rev-list --left-right --count returned ${JSON.stringify(output)}`,
    );
  }
  return { ahead, behind };
}

/** `git rev-list --count` for `revs` (for example `branch --not trunk`). */
export async function revListCount(
  workspace: string,
  revs: string[],
): Promise<number> {
  const output = (await runGit(["rev-list", "--count", ...revs], workspace)).trim();
  const count = Number.parseInt(output, 10);
  if (!Number.isFinite(count)) {
    throw new IssueError(
      "git-failed",
      `git rev-list --count returned ${JSON.stringify(output)}`,
    );
  }
  return count;
}
