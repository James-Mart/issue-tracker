import type { Issue, Story } from "../schemas.js";
import { derive } from "./derive.js";
import { IssueError } from "./errors.js";
import { checkIntegrity } from "./integrity.js";
import {
  commitIssueBatch,
  readAll,
  readIssueOrThrow,
  serialize,
} from "./issues.js";
import { ancestorChain, subtreeIds } from "./subtree.js";

/** Derived mergeBase of `finisherId` before the merged write. */
export function landedBaseForMerge(
  finisherId: string,
  issues: Issue[],
): string | undefined {
  return derive(issues).byId[finisherId]?.mergeBase;
}

/**
 * Stories that need `needsRebase` after `finisherId` lands on `landedBase`.
 * Matches finish-branch step 3 / SPEC § Project merge policy "Flag stale children".
 */
export function staleSiblingIds(
  issues: Issue[],
  finisherId: string,
  landedBase: string,
): string[] {
  const prospective = issues.map((issue) =>
    issue.id === finisherId && issue.kind === "story"
      ? { ...issue, merged: true }
      : issue,
  );
  const { byId } = derive(prospective);
  const projectId = ancestorChain(finisherId, issues)[0]!.id;
  const inProject = subtreeIds(prospective, projectId);

  const stale: string[] = [];
  for (const issue of prospective) {
    if (issue.kind !== "story") continue;
    if (issue.id === finisherId) continue;
    if (!inProject.has(issue.id)) continue;
    if (issue.merged) continue;
    if (!issue.branchName) continue;
    const state = byId[issue.id];
    if (!state?.storyStatus || state.storyStatus === "not-started") continue;
    if (state.mergeBase !== landedBase) continue;
    stale.push(issue.id);
  }
  return stale;
}

/** After a successful `gh pr merge`, set `merged` and flag stale siblings. */
export function applyMergeConsequences(finisherId: string): Promise<void> {
  return serialize(() => {
    const detail = readIssueOrThrow(finisherId);
    if (detail.kind !== "story") {
      throw new IssueError(
        "validation",
        `"${finisherId}" is not a Story`,
      );
    }

    const { issues } = readAll();
    const finisher = issues.find((issue) => issue.id === finisherId);
    if (!finisher || finisher.kind !== "story") {
      throw new IssueError("not_found", `unknown issue "${finisherId}"`);
    }

    const landedBase = landedBaseForMerge(finisherId, issues);
    const stale = landedBase
      ? staleSiblingIds(issues, finisherId, landedBase)
      : [];

    const now = new Date().toISOString();
    const finisherWrite: Story = {
      ...finisher,
      merged: true,
      updatedAt: now,
    };

    const writes = [{ issue: finisherWrite as Issue }];
    for (const id of stale) {
      const sibling = issues.find((issue) => issue.id === id);
      if (!sibling || sibling.kind !== "story") continue;
      writes.push({
        issue: {
          ...sibling,
          needsRebase: landedBase,
          updatedAt: now,
        },
      });
    }

    const prospective = new Map(issues.map((issue) => [issue.id, issue]));
    for (const write of writes) {
      prospective.set(write.issue.id, write.issue);
    }
    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((p) => p.message).join("; "),
      );
    }

    commitIssueBatch(writes, []);
  });
}
