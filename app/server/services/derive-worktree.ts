import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import type {
  DerivedWorktree,
  Issue,
  ProjectStoryWorktree,
  ProjectWorktreesResponse,
} from "../schemas.js";
import { setupLogPathFor } from "../worktree-constants.js";
import {
  branchUpstream,
  porcelainDirtyPaths,
  readListedWorktrees,
  revListAheadBehind,
  revListCount,
  type ListedWorktree as GitListedWorktree,
} from "./git-read.js";
import { readAll } from "./issues.js";
import { requireProject } from "./require-project.js";
import { projectContaining } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

type LockCache = Map<string, Promise<GitListedWorktree[]>>;

function trunkForStory(story: Story, byId: Map<string, Issue>): string {
  const projectId = projectContaining(story, byId);
  if (!projectId) return "main";
  const project = byId.get(projectId);
  return project?.kind === "project" ? project.trunk : "main";
}

function workspaceFor(
  projectId: string | undefined,
  byId: Map<string, Issue>,
): string | undefined {
  const project = projectId ? byId.get(projectId) : undefined;
  return project?.kind === "project" ? project.workspace : undefined;
}

async function pathIsLocked(
  path: string | undefined,
  gitCheckout: boolean,
  projectId: string | undefined,
  byId: Map<string, Issue>,
  lockCache: LockCache,
): Promise<boolean> {
  if (!path) return false;
  const workspace = workspaceFor(projectId, byId);
  const cwd =
    workspace && existsSync(join(workspace, ".git"))
      ? workspace
      : gitCheckout
        ? path
        : undefined;
  if (!cwd) return false;
  let pending = lockCache.get(cwd);
  if (!pending) {
    pending = readListedWorktrees(cwd);
    lockCache.set(cwd, pending);
  }
  const listed = await pending;
  return listed.some((item) => item.path === path && item.locked);
}

async function setupRecord(
  story: Story,
  projectId: string | undefined,
): Promise<Pick<DerivedWorktree, "setupFailed" | "setupLogPath" | "setupOutput">> {
  if (story.worktreeSetupFailed !== true) return {};
  const recorded: Pick<
    DerivedWorktree,
    "setupFailed" | "setupLogPath" | "setupOutput"
  > = { setupFailed: true };
  if (!projectId) return recorded;
  const logPath = setupLogPathFor(projectId, story.id);
  if (!existsSync(logPath)) return recorded;
  recorded.setupLogPath = logPath;
  recorded.setupOutput = await readFile(logPath, "utf8");
  return recorded;
}

interface BranchDivergence {
  upstream?: string;
  ahead: number;
  behind: number;
  atRisk: number;
}

async function branchDivergence(
  workspace: string,
  branchName: string,
  trunk: string,
): Promise<BranchDivergence> {
  const upstream = await branchUpstream(workspace, branchName);
  const base = upstream ?? trunk;
  const atRiskRevs = [branchName, "--not", trunk];
  if (upstream) atRiskRevs.push(upstream);
  const [divergence, atRisk] = await Promise.all([
    revListAheadBehind(workspace, base, branchName),
    revListCount(workspace, atRiskRevs),
  ]);
  return {
    ...(upstream ? { upstream } : {}),
    ahead: divergence.ahead,
    behind: divergence.behind,
    atRisk,
  };
}

const QUIET_DIVERGENCE: BranchDivergence = { ahead: 0, behind: 0, atRisk: 0 };

/** Derive one Story's worktree. Missing path or vanished directory is absent, not an error. */
export function deriveStoryWorktree(
  story: Story,
  issues: Issue[],
  byId: Map<string, Issue> = new Map(issues.map((issue) => [issue.id, issue])),
): Promise<ProjectStoryWorktree> {
  return deriveStoryWorktreeCached(story, issues, byId, new Map());
}

async function deriveStoryWorktreeCached(
  story: Story,
  issues: Issue[],
  byId: Map<string, Issue>,
  lockCache: LockCache,
): Promise<ProjectStoryWorktree> {
  const path = story.worktreePath;
  const exists = Boolean(path && existsSync(path));
  const gitCheckout = Boolean(path && exists && existsSync(join(path, ".git")));
  const projectId = projectContaining(story, byId);
  const [dirtyPaths, locked, divergence, setup] = await Promise.all([
    gitCheckout && path ? porcelainDirtyPaths(path) : Promise.resolve([]),
    pathIsLocked(path, gitCheckout, projectId, byId, lockCache),
    gitCheckout && path && story.branchName
      ? branchDivergence(path, story.branchName, trunkForStory(story, byId))
      : Promise.resolve(QUIET_DIVERGENCE),
    setupRecord(story, projectId),
  ]);
  return {
    ...(path !== undefined ? { path } : {}),
    exists,
    uncommittedCount: dirtyPaths.length,
    atRiskCommitCount: divergence.atRisk,
    retained: exists && (story.merged || story.archived),
    locked,
    ...setup,
    ...(story.worktreeBlockedReason
      ? { blockedReason: story.worktreeBlockedReason }
      : {}),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    ...(divergence.upstream ? { upstream: divergence.upstream } : {}),
    ahead: divergence.ahead,
    behind: divergence.behind,
  };
}

/** One fresh read of every Story worktree in the project. Callers coalesce. */
export async function loadProjectWorktrees(
  projectId: string,
): Promise<ProjectWorktreesResponse> {
  requireProject(projectId);
  const { issues } = readAll();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const lockCache: LockCache = new Map();
  const stories = issues.filter(
    (issue): issue is Story =>
      issue.kind === "story" && projectContaining(issue, byId) === projectId,
  );
  const entries = await Promise.all(
    stories.map(async (story) => {
      const state = await deriveStoryWorktreeCached(story, issues, byId, lockCache);
      return [story.id, state] as const;
    }),
  );
  return { worktrees: Object.fromEntries(entries) };
}
