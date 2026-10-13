import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname } from "path";
import {
  KIND_LABEL,
  hasWorktree,
  kindCapabilityRefusal,
  type WorktreeIssue,
} from "../kind.js";
import type { Issue, IssuePatch } from "../schemas.js";
import { setupLogPathFor, worktreePathFor } from "../worktree-constants.js";
import { appendOutputTail, killProcessGroup } from "./bounded-process.js";
import { IssueError } from "./errors.js";
import { listedWorktrees } from "./git-read.js";
import { runGitWrite } from "./git-write.js";
import { list, update } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { projectContaining } from "./subtree.js";

type Project = Extract<Issue, { kind: "project" }>;

/**
 * How the checkout is created. Story branch creation uses `new-branch` or
 * `existing-branch`. A review checkout uses `detach`.
 */
export type WorktreeCheckout =
  | { mode: "new-branch"; branch: string; startRef: string }
  | { mode: "existing-branch"; branch: string }
  | { mode: "detach"; commit: string };

export function projectIdOf(issue: Issue, issues: Issue[]): string {
  const byId = new Map(issues.map((item) => [item.id, item]));
  const projectId = projectContaining(issue, byId);
  if (!projectId) {
    throw new IssueError(
      "not_found",
      `no project contains ${issue.kind} "${issue.id}"`,
    );
  }
  return projectId;
}

function projectOf(projectId: string, issues: Issue[]): Project {
  const project = issues.find((issue) => issue.id === projectId);
  if (!project || project.kind !== "project") {
    throw new IssueError("not_found", `project "${projectId}" does not exist`);
  }
  return project;
}

function requireWorktreeIssue(issueId: string, issues: Issue[]): WorktreeIssue {
  const issue = issues.find((item) => item.id === issueId);
  if (!issue) {
    throw new IssueError("not_found", `unknown issue "${issueId}"`);
  }
  if (!hasWorktree(issue)) {
    throw new IssueError(
      "validation",
      kindCapabilityRefusal(issue.kind, "worktree"),
    );
  }
  return issue;
}

/** Refuse when a recorded checkout is still on disk. A missing directory does not count. */
export function assertNoLiveWorktree(issue: WorktreeIssue): void {
  if (issue.worktreePath && existsSync(issue.worktreePath)) {
    throw new IssueError(
      "validation",
      `${KIND_LABEL[issue.kind]} "${issue.id}" already has a worktree at ${issue.worktreePath}`,
    );
  }
}

function worktreeAddArgs(path: string, checkout: WorktreeCheckout): string[] {
  switch (checkout.mode) {
    case "new-branch":
      return ["-b", checkout.branch, path, checkout.startRef];
    case "existing-branch":
      return [path, checkout.branch];
    case "detach":
      return ["--detach", path, checkout.commit];
  }
}

/** Drop this path's Git registration when the directory is already gone. A locked registration stays listed, and other registrations are left alone. */
async function dropUnlockedMissingRegistration(
  workspace: string,
  path: string,
): Promise<void> {
  const porcelain = await runGitWrite(
    ["worktree", "list", "--porcelain"],
    workspace,
  );
  const entry = listedWorktrees(porcelain).find((item) => item.path === path);
  if (!entry || entry.locked) return;
  await runGitWrite(["worktree", "remove", "--force", entry.path], workspace);
}

/** Setup is sometimes legitimately slow. Past this, the process group is killed. */
const WORKTREE_SETUP_TIMEOUT_MINUTES = 10;
const WORKTREE_SETUP_TIMEOUT_MS = WORKTREE_SETUP_TIMEOUT_MINUTES * 60 * 1000;

export const WORKTREE_SETUP_TIMEOUT_LINE =
  `command timed out after ${WORKTREE_SETUP_TIMEOUT_MINUTES} minutes`;

let setupTimeoutMsForTests: number | undefined;

/** Test-only. `undefined` restores `WORKTREE_SETUP_TIMEOUT_MS`. */
export function setWorktreeSetupTimeoutMsForTests(ms: number | undefined): void {
  setupTimeoutMsForTests = ms;
}

function setupTimeoutMs(): number {
  return setupTimeoutMsForTests ?? WORKTREE_SETUP_TIMEOUT_MS;
}

/** Move an existing log aside so a successful run can put it back. */
function parkSetupLog(logPath: string): string | undefined {
  if (!existsSync(logPath)) return undefined;
  const prior = `${logPath}.prior`;
  if (existsSync(prior)) {
    throw new IssueError(
      "conflict",
      `setup log "${logPath}" and "${prior}" both exist`,
    );
  }
  renameSync(logPath, prior);
  return prior;
}

/** A failed run replaces the parked log with the new one. */
function commitSetupLog(prior: string | undefined): void {
  if (prior) unlinkSync(prior);
}

/** A successful run drops its log and restores the parked one. */
function discardSetupLog(logPath: string, prior: string | undefined): void {
  unlinkSync(logPath);
  if (prior) renameSync(prior, logPath);
}

/**
 * Stream combined stdout and stderr to `logPath`. Memory keeps only a bounded
 * tail of that text. The child leads its own process group; at the setup
 * timeout the group is killed and the log ends with the timeout line. Exit 0
 * drops this run's log.
 */
function runSetupCommand(
  cwd: string,
  command: string,
  logPath: string,
): Promise<{ code: number }> {
  mkdirSync(dirname(logPath), { recursive: true });
  const prior = parkSetupLog(logPath);
  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "w");
  } catch (err) {
    if (prior) renameSync(prior, logPath);
    throw err;
  }
  return new Promise((resolve, reject) => {
    let tail = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const closeLog = () => {
      if (logFd === undefined) return;
      closeSync(logFd);
      logFd = undefined;
    };
    const beginSettle = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    };
    const discardRun = () => {
      closeLog();
      discardSetupLog(logPath, prior);
    };
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      if (child.pid !== undefined) killProcessGroup(child.pid);
    }, setupTimeoutMs());
    const onData = (chunk: Buffer | string) => {
      if (settled || logFd === undefined) return;
      try {
        writeSync(logFd, chunk);
      } catch (err) {
        if (!beginSettle()) return;
        if (child.pid !== undefined) killProcessGroup(child.pid);
        discardRun();
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      tail = appendOutputTail(tail, text);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (!beginSettle()) return;
      discardRun();
      reject(new IssueError("validation", err.message));
    });
    child.on("close", (code, signal) => {
      if (!beginSettle()) return;
      const killedOnTimeout = timedOut && signal !== null;
      try {
        if (killedOnTimeout && logFd !== undefined) {
          const breakLine = tail.length > 0 && !tail.endsWith("\n") ? "\n" : "";
          writeSync(logFd, `${breakLine}${WORKTREE_SETUP_TIMEOUT_LINE}\n`);
        }
        closeLog();
        const success = code === 0 && signal === null;
        if (success) discardSetupLog(logPath, prior);
        else commitSetupLog(prior);
        resolve({ code: success ? 0 : (code ?? 1) });
      } catch (err) {
        try {
          discardRun();
        } catch {
          // A second cleanup failure must not escape this close handler.
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

async function recordSetupFailure(
  issue: WorktreeIssue,
  projectId: string,
  code: number,
  extra: IssuePatch,
): Promise<never> {
  const logPath = setupLogPathFor(projectId, issue.id);
  await update(issue.id, { ...extra, worktreeSetupFailed: true });
  throw new IssueError(
    "conflict",
    `setup command failed for ${KIND_LABEL[issue.kind]} "${issue.id}" (exit ${code}); see ${logPath}`,
    { setupLogPath: logPath },
  );
}

async function applySetupCommand(
  issue: WorktreeIssue,
  projectId: string,
  worktreePath: string,
  setupCommand: string | undefined,
  extra: IssuePatch,
): Promise<void> {
  if (!setupCommand) {
    await update(issue.id, { ...extra, worktreeSetupFailed: false });
    return;
  }
  const logPath = setupLogPathFor(projectId, issue.id);
  const { code } = await runSetupCommand(worktreePath, setupCommand, logPath);
  if (code === 0) {
    await update(issue.id, { ...extra, worktreeSetupFailed: false });
    return;
  }
  await recordSetupFailure(issue, projectId, code, extra);
}

/**
 * Git-add a checkout, record `worktreePath`, and run the Project setup command.
 * Callers own guest refusal. Story branch and merge-base rules stay on the Story entry points.
 */
export async function addWorktreeCheckout(
  issueId: string,
  checkout: WorktreeCheckout,
  extra: IssuePatch = {},
): Promise<string> {
  const { issues } = list();
  const issue = requireWorktreeIssue(issueId, issues);
  const projectId = projectIdOf(issue, issues);
  const workspace = requireProjectWorkspace(projectId);
  const path = worktreePathFor(projectId, issueId);
  assertNoLiveWorktree(issue);
  await runGitWrite(["worktree", "add", ...worktreeAddArgs(path, checkout)], workspace);
  await applySetupCommand(
    issue,
    projectId,
    path,
    projectOf(projectId, issues).setupCommand,
    { ...extra, worktreePath: path },
  );
  return path;
}

/**
 * Drop the checkout and clear `worktreePath`. A missing directory drops an
 * unlocked Git registration. Callers own pre-removal safety checks.
 */
export async function removeWorktreeCheckout(issueId: string): Promise<string> {
  const { issues } = list();
  const issue = requireWorktreeIssue(issueId, issues);
  const projectId = projectIdOf(issue, issues);
  const workspace = requireProjectWorkspace(projectId);
  const path = issue.worktreePath;
  if (!path) {
    throw new IssueError(
      "validation",
      `worktree remove requires an existing worktree for ${KIND_LABEL[issue.kind]} "${issueId}"`,
    );
  }
  if (!existsSync(path)) {
    await dropUnlockedMissingRegistration(workspace, path);
    await update(issueId, { worktreePath: null });
    return path;
  }
  await runGitWrite(["worktree", "remove", "--force", path], workspace);
  await update(issueId, { worktreePath: null });
  return path;
}

/** Re-run the Project setup command in the issue's checkout. */
export async function runWorktreeSetup(issueId: string): Promise<string> {
  const { issues } = list();
  const issue = requireWorktreeIssue(issueId, issues);
  const projectId = projectIdOf(issue, issues);
  const setupCommand = projectOf(projectId, issues).setupCommand;
  if (!setupCommand) {
    throw new IssueError(
      "validation",
      `worktree setup requires setupCommand on the Project for ${KIND_LABEL[issue.kind]} "${issueId}"`,
    );
  }
  const path = issue.worktreePath ?? worktreePathFor(projectId, issueId);
  if (!existsSync(path)) {
    throw new IssueError(
      "validation",
      `worktree setup requires an existing worktree for ${KIND_LABEL[issue.kind]} "${issueId}"`,
    );
  }
  await applySetupCommand(issue, projectId, path, setupCommand, {});
  return path;
}
