import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DerivedWorktree, DerivedState, Issue } from "../schemas.js";
import { setupLogPathFor } from "../worktree-constants.js";
import { atRiskCommitCount, porcelainStatusCount } from "./git-read.js";
import { projectContaining } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

function trunkForStory(story: Story, byId: Map<string, Issue>): string {
  const projectId = projectContaining(story, byId);
  if (!projectId) return "main";
  const project = byId.get(projectId);
  return project?.kind === "project" ? project.trunk : "main";
}

function setupRecord(
  story: Story,
  projectId: string | undefined,
): Pick<DerivedWorktree, "setupFailed" | "setupLogPath" | "setupOutput"> {
  if (story.worktreeSetupFailed !== true) return {};
  const recorded: Pick<
    DerivedWorktree,
    "setupFailed" | "setupLogPath" | "setupOutput"
  > = { setupFailed: true };
  if (!projectId) return recorded;
  const logPath = setupLogPathFor(projectId, story.id);
  if (!existsSync(logPath)) return recorded;
  recorded.setupLogPath = logPath;
  recorded.setupOutput = readFileSync(logPath, "utf8");
  return recorded;
}

/** Derive one Story's worktree. Missing path or vanished directory is absent, not an error. */
export function deriveStoryWorktree(
  story: Story,
  issues: Issue[],
  byId: Map<string, Issue> = new Map(issues.map((issue) => [issue.id, issue])),
): DerivedWorktree {
  const path = story.worktreePath;
  const exists = Boolean(path && existsSync(path));
  const gitCheckout = Boolean(path && exists && existsSync(join(path, ".git")));
  const projectId = projectContaining(story, byId);
  let uncommittedCount = 0;
  let atRisk = 0;
  if (gitCheckout && path) {
    uncommittedCount = porcelainStatusCount(path);
    if (story.branchName) {
      atRisk = atRiskCommitCount(path, story.branchName, trunkForStory(story, byId));
    }
  }
  return {
    ...(path !== undefined ? { path } : {}),
    exists,
    uncommittedCount,
    atRiskCommitCount: atRisk,
    retained: exists && (story.merged || story.archived),
    ...setupRecord(story, projectId),
    ...(story.worktreeBlockedReason
      ? { blockedReason: story.worktreeBlockedReason }
      : {}),
  };
}

/** Attach `derived[storyId].worktree` for every Story. */
export function attachWorktreeDerived(
  issues: Issue[],
  derived: Record<string, DerivedState>,
): void {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  for (const issue of issues) {
    if (issue.kind !== "story") continue;
    const state = derived[issue.id];
    if (!state) continue;
    state.worktree = deriveStoryWorktree(issue, issues, byId);
  }
}
